"""Phase 2 tests: geo feed, escalation, expiry, listing permissions."""

from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Organization, User
from listings import services
from listings.models import Listing

pytestmark = pytest.mark.django_db

PUNE = (18.5204, 73.8567)  # test fixture city — coords are arbitrary for logic tests

LIST_URL = "/api/v1/listings/"
MINE_URL = "/api/v1/listings/mine/"


def make_listing(donor, org=None, hours_left=2, minutes_ago=0, lat=None, lng=None, **overrides):
    now = timezone.now()
    safe_until = now + timedelta(hours=hours_left)
    # Keep ready_from <= safe_until even for already-expired fixtures.
    ready_from = min(now, safe_until - timedelta(hours=2))
    defaults = dict(
        title="Rice bowls",
        food_type=Listing.FoodType.COOKED,
        is_veg=True,
        quantity_value=10,
        quantity_unit=Listing.QuantityUnit.MEALS,
        pickup_address="12 MG Road, Pune",
        lat=PUNE[0] + (lat or 0),
        lng=PUNE[1] + (lng or 0),
        ready_from=ready_from,
        safe_until=safe_until,
        status=Listing.Status.OPEN,
    )
    defaults.update(overrides)
    if minutes_ago:
        # create then backdate created_at
        obj = Listing.objects.create(donor=donor, organization=org, **defaults)
        Listing.objects.filter(pk=obj.pk).update(created_at=now - timedelta(minutes=minutes_ago))
        obj.refresh_from_db()
        return obj
    return Listing.objects.create(donor=donor, organization=org, **defaults)


@pytest.fixture
def donor_org(donor):
    org = Organization.objects.create(
        owner=donor,
        name="Anand Bhavan",
        type=Organization.OrgType.RESTAURANT,
        address="12 MG Road, Pune",
        lat=PUNE[0],
        lng=PUNE[1],
        verification_status=Organization.VerificationStatus.APPROVED,
    )
    donor.is_verified = True
    donor.save(update_fields=["is_verified"])
    return org


@pytest.fixture
def api_v(volunteer):
    api = APIClient()
    api.force_authenticate(volunteer)
    return api


# -- escalation tiers ----------------------------------------------------------

def test_escalation_radius_tiers():
    """Tiers come from settings (default 3/6/12 for Vaniyambadi deployment)."""
    assert services.escalation_radius_km(0) == 3.0
    assert services.escalation_radius_km(10) == 3.0
    assert services.escalation_radius_km(20) == 6.0   # at the 20-min boundary
    assert services.escalation_radius_km(35) == 6.0
    assert services.escalation_radius_km(40) == 12.0  # at the 40-min boundary
    assert services.escalation_radius_km(120) == 12.0


def test_escalation_computed_at_query_time(donor, donor_org, api_v):
    """No scheduler: a 30-min-old listing shows the 6 km ring without cron."""
    make_listing(donor, donor_org, minutes_ago=30)
    resp = api_v.get(f"{LIST_URL}?lat={PUNE[0]}&lng={PUNE[1]}&radius=8")
    assert resp.status_code == 200
    row = resp.data["results"][0]
    assert row["minutes_open"] >= 30
    assert row["escalation_radius_km"] == 6.0


# -- geo feed -------------------------------------------------------------------

def test_feed_distance_ordering_and_filtering(donor, donor_org, api_v):
    near = make_listing(donor, donor_org, lat=0.005, lng=0.005)      # ~700 m
    far = make_listing(donor, donor_org, lat=0.05, lng=0.05)          # ~7 km
    resp = api_v.get(f"{LIST_URL}?lat={PUNE[0]}&lng={PUNE[1]}&radius=10")
    results = resp.data["results"]
    assert len(results) == 2
    assert results[0]["distance_km"] < results[1]["distance_km"]
    assert results[0]["id"] == near.id

    resp = api_v.get(f"{LIST_URL}?lat={PUNE[0]}&lng={PUNE[1]}&radius=3")
    assert resp.data["count"] == 1  # only the near one inside 3 km


def test_feed_veg_and_type_filters(donor, donor_org, api_v):
    make_listing(donor, donor_org)
    make_listing(donor, donor_org, title="Chicken", is_veg=False)
    make_listing(donor, donor_org, title="Bread", food_type=Listing.FoodType.BAKERY)

    veg = api_v.get(f"{LIST_URL}?lat={PUNE[0]}&lng={PUNE[1]}&veg=true").data
    assert veg["count"] == 2
    bakery = api_v.get(f"{LIST_URL}?lat={PUNE[0]}&lng={PUNE[1]}&type=bakery").data
    assert bakery["count"] == 1 and bakery["results"][0]["title"] == "Bread"


def test_feed_urgency_beats_distance(donor, donor_org, api_v):
    """A farther listing about to spoil outranks a close one with hours left."""
    far_urgent = make_listing(donor, donor_org, lat=0.03, lng=0.03, hours_left=0.2)   # ~4.5 km, 12 min left
    close_leisurely = make_listing(donor, donor_org, lat=0.002, lng=0.002, hours_left=6)  # ~300 m, 6 h left
    results = api_v.get(f"{LIST_URL}?lat={PUNE[0]}&lng={PUNE[1]}&radius=10").data["results"]
    assert results[0]["id"] == far_urgent.id
    assert results[1]["id"] == close_leisurely.id


def test_feed_never_returns_expired(donor, donor_org, api_v):
    make_listing(donor, donor_org, hours_left=-1)  # already past safe_until
    data = api_v.get(f"{LIST_URL}?lat={PUNE[0]}&lng={PUNE[1]}").data
    assert data["count"] == 0


def test_feed_no_n_plus_one(donor, donor_org, api_v, django_assert_num_queries):
    for i in range(8):
        make_listing(donor, donor_org, title=f"L{i}", lat=0.001 * i, lng=0.001 * i)
    # constant count: 1 count query + 1 page query — no per-row lookups
    with django_assert_num_queries(2):
        resp = api_v.get(f"{LIST_URL}?lat={PUNE[0]}&lng={PUNE[1]}&radius=10")
    assert resp.data["count"] == 8


# -- donor CRUD ------------------------------------------------------------------

def test_donor_create_edit_cancel_roundtrip(api, donor, donor_org):
    api.force_authenticate(donor)
    now = timezone.now()
    payload = {
        "title": "Sweets",
        "quantity_value": 5,
        "quantity_unit": "boxes",
        "food_type": "bakery",
        "pickup_address": "12 MG Road",
        "lat": PUNE[0],
        "lng": PUNE[1],
        "ready_from": now.isoformat(),
        "safe_until": (now + timedelta(hours=4)).isoformat(),
        "organization": donor_org.id,
    }
    resp = api.post(LIST_URL, payload, format="json")
    assert resp.status_code == 201, resp.data
    lid = resp.data["id"]

    resp = api.patch(f"{LIST_URL}{lid}/", {"title": "Diwali sweets"}, format="json")
    assert resp.status_code == 200 and resp.data["title"] == "Diwali sweets"

    resp = api.post(f"{LIST_URL}{lid}/cancel/", format="json")
    assert resp.status_code == 200 and resp.data["status"] == "cancelled"

    # cancelled listing cannot be edited again
    resp = api.patch(f"{LIST_URL}{lid}/", {"title": "x"}, format="json")
    assert resp.status_code == 409


def test_donor_cannot_edit_someone_elses_listing(api, donor, volunteer, donor_org):
    other = User.objects.create_user(username="d2", email="d2@t.in", password="StrongPass123!", role=User.Role.DONOR)
    listing = make_listing(other)
    api.force_authenticate(donor)
    resp = api.patch(f"{LIST_URL}{listing.id}/", {"title": "hijack"}, format="json")
    assert resp.status_code == 403


def test_mine_lists_all_statuses(donor, donor_org):
    api = APIClient()
    api.force_authenticate(donor)
    make_listing(donor, donor_org)
    make_listing(donor, donor_org, title="old", hours_left=-2)
    data = api.get(MINE_URL).data
    assert data["count"] == 2


def test_unverified_donor_blocked(api, donor):
    """Phase-1 gating still holds on the real create path."""
    api.force_authenticate(donor)
    now = timezone.now()
    payload = {
        "title": "Food",
        "quantity_value": 1,
        "pickup_address": "x",
        "lat": PUNE[0],
        "lng": PUNE[1],
        "ready_from": now.isoformat(),
        "safe_until": (now + timedelta(hours=2)).isoformat(),
    }
    resp = api.post(LIST_URL, payload, format="json")
    assert resp.status_code == 403


# -- location privacy (fuzzing) ----------------------------------------------------

def test_public_feed_fuzzes_location_and_hides_address(donor, donor_org, api_v):
    listing = make_listing(donor, donor_org, pickup_address="12/3 MG Road, near the temple")
    resp = api_v.get(f"{LIST_URL}?lat={PUNE[0]}&lng={PUNE[1]}&radius=10")
    row = next(row for row in resp.data["results"] if row["id"] == listing.id)
    assert row["pickup_address"] == "Shared with the assigned volunteer after claiming"
    # Fuzzed: not exact, but within ~300 m
    from listings.serializers import fuzzed_coords
    expected_lat, expected_lng = fuzzed_coords(listing.id, listing.lat, listing.lng)
    assert row["lat"] == expected_lat and row["lng"] == expected_lng
    # Full displacement (both axes) is between 120 m and ~300 m.
    dy = (row["lat"] - listing.lat) * 111_320
    dx = (row["lng"] - listing.lng) * 111_320 * 0.98
    offset_m = (dy * dy + dx * dx) ** 0.5
    assert 100 < offset_m < 320


def test_donor_sees_exact_location_in_mine(api, donor, donor_org):
    listing = make_listing(donor, donor_org, pickup_address="12/3 MG Road, near the temple")
    api.force_authenticate(donor)
    resp = api.get("/api/v1/listings/mine/")
    row = next(row for row in resp.data["results"] if row["id"] == listing.id)
    assert row["pickup_address"] == "12/3 MG Road, near the temple"
    assert row["lat"] == listing.lat and row["lng"] == listing.lng


def test_claim_holder_sees_exact_location(api, volunteer, donor, donor_org):
    from claims.models import Claim

    listing = make_listing(donor, donor_org, pickup_address="12/3 MG Road, near the temple")
    api.force_authenticate(volunteer)
    resp = api.post(f"{LIST_URL}{listing.id}/claim/", format="json")
    assert resp.status_code == 201
    claim_id = resp.data["id"]

    # Detail endpoint: exact coords + address for the claim holder
    resp = api.get(f"{LIST_URL}{listing.id}/")
    assert resp.data["pickup_address"] == "12/3 MG Road, near the temple"
    assert resp.data["lat"] == listing.lat and resp.data["lng"] == listing.lng

    # Nested inside the claim payload too
    resp = api.get(f"/api/v1/claims/{claim_id}/")
    assert resp.data["listing"]["pickup_address"] == "12/3 MG Road, near the temple"
    assert resp.data["listing"]["lat"] == listing.lat


def test_other_volunteers_still_see_fuzzed_after_someone_claims(api, volunteer, donor, donor_org):
    other = User.objects.create_user("vother", "vother@t.in", "StrongPass123!")
    listing = make_listing(donor, donor_org)
    api.force_authenticate(volunteer)
    assert api.post(f"{LIST_URL}{listing.id}/claim/", format="json").status_code == 201

    api2 = APIClient()
    api2.force_authenticate(other)
    resp = api2.get(f"{LIST_URL}{listing.id}/")
    assert resp.data["pickup_address"] != listing.pickup_address
    assert resp.data["lat"] != listing.lat


# -- expire_listings command -------------------------------------------------------

def test_expire_command_expires_and_penalizes(donor, donor_org, volunteer):
    from django.core.management import call_command

    from claims.models import Claim

    stale_listing = make_listing(donor, donor_org, hours_left=-1)
    claimed_listing = make_listing(donor, donor_org, title="claimed stale", hours_left=-0.5)
    claim = Claim.objects.create(listing=claimed_listing, volunteer=volunteer)
    claimed_listing.status = Listing.Status.CLAIMED
    claimed_listing.save(update_fields=["status"])
    fresh = make_listing(donor, donor_org, title="fresh", hours_left=2)

    call_command("expire_listings")

    stale_listing.refresh_from_db()
    claimed_listing.refresh_from_db()
    fresh.refresh_from_db()
    claim.refresh_from_db()
    volunteer.refresh_from_db()

    assert stale_listing.status == Listing.Status.EXPIRED
    assert claimed_listing.status == Listing.Status.EXPIRED
    assert fresh.status == Listing.Status.OPEN
    assert claim.status == Claim.Status.NO_SHOW
    assert volunteer.trust_score == 50 - 10  # no-show penalty
