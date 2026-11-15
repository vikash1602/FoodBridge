"""Phase 3 tests: claim flow, pickup codes, delivery, cancellation, ratings."""

from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Organization, User
from accounts.trust import TrustAdjustment
from claims.models import Claim, Rating
from listings.models import Listing

pytestmark = pytest.mark.django_db

CLAIM_URL = "/api/v1/listings/{id}/claim/"


def hours_ahead(h):
    return timezone.now() + timedelta(hours=h)


def make_listing(donor, org, hours_left=2, status=Listing.Status.OPEN):
    safe_until = hours_ahead(hours_left)
    listing = Listing.objects.create(
        donor=donor,
        organization=org,
        title="Rice bowls",
        food_type=Listing.FoodType.COOKED,
        is_veg=True,
        quantity_value=10,
        quantity_unit=Listing.QuantityUnit.MEALS,
        pickup_address="12 MG Road, Pune",
        lat=18.5204,
        lng=73.8567,
        ready_from=min(timezone.now(), safe_until - timedelta(hours=2)),
        safe_until=safe_until,
        status=status,
    )
    return listing


@pytest.fixture
def verified_donor(donor):
    org = Organization.objects.create(
        owner=donor, name="Anand Bhavan", type=Organization.OrgType.RESTAURANT,
        address="12 MG Road", lat=18.5204, lng=73.8567,
        verification_status=Organization.VerificationStatus.APPROVED,
    )
    donor.is_verified = True
    donor.save(update_fields=["is_verified"])
    return donor, org


def claim(api, listing):
    return api.post(CLAIM_URL.format(id=listing.id), format="json")


# -- happy path -----------------------------------------------------------------

def test_claim_sets_listing_and_generates_code(api, volunteer, verified_donor):
    donor, org = verified_donor
    listing = make_listing(donor, org)
    api.force_authenticate(volunteer)
    resp = claim(api, listing)
    assert resp.status_code == 201, resp.data
    listing.refresh_from_db()
    assert listing.status == Listing.Status.CLAIMED
    assert resp.data["status"] == Claim.Status.ACTIVE

    # exactly one occupying claim
    assert Claim.objects.filter(listing=listing, status__in=Claim.OCCUPYING_STATUSES).count() == 1


def test_second_volunteer_gets_friendly_409(api, volunteer, verified_donor):
    donor, org = verified_donor
    listing = make_listing(donor, org)
    v2 = User.objects.create_user(username="v2", email="v2@t.in", password="StrongPass123!")
    api.force_authenticate(volunteer)
    assert claim(api, listing).status_code == 201
    api.force_authenticate(v2)
    resp = claim(api, listing)
    assert resp.status_code == 409
    assert "someone just claimed" in resp.data["error"]["message"].lower()


def test_donor_sees_code_volunteer_does_not(api, volunteer, verified_donor):
    donor, org = verified_donor
    listing = make_listing(donor, org)
    api.force_authenticate(volunteer)
    claim_id = claim(api, listing).data["id"]

    # volunteer's view: masked
    api_vol = APIClient()
    api_vol.force_authenticate(volunteer)
    assert api_vol.get(f"/api/v1/claims/{claim_id}/").data["pickup_code"] is None

    # donor's view: visible
    api_don = APIClient()
    api_don.force_authenticate(donor)
    assert api_don.get(f"/api/v1/claims/{claim_id}/").data["pickup_code"].isdigit()


def test_max_two_active_claims(api, volunteer, verified_donor):
    donor, org = verified_donor
    api.force_authenticate(volunteer)
    for _ in range(2):
        assert claim(api, make_listing(donor, org)).status_code == 201
    resp = claim(api, make_listing(donor, org))
    assert resp.status_code == 409
    assert "the limit is 2" in resp.data["error"]["message"]


# -- pickup & delivery ------------------------------------------------------------

def full_claim_to_picked_up(api, volunteer, donor, org):
    """Volunteer claims; the DONOR then reads the code (as in real life)."""
    listing = make_listing(donor, org)
    api.force_authenticate(volunteer)
    resp = claim(api, listing)
    claim_id = resp.data["id"]
    api_don = APIClient()
    api_don.force_authenticate(donor)
    code = api_don.get(f"/api/v1/claims/{claim_id}/").data["pickup_code"]
    return listing, claim_id, code


def test_verify_pickup_wrong_then_right_code(api, volunteer, verified_donor):
    donor, org = verified_donor
    listing, claim_id, code = full_claim_to_picked_up(api, volunteer, donor, org)

    bad = api.post(f"/api/v1/claims/{claim_id}/verify-pickup/", {"code": "0000"}, format="json")
    assert bad.status_code == 400

    good = api.post(f"/api/v1/claims/{claim_id}/verify-pickup/", {"code": code}, format="json")
    assert good.status_code == 200
    listing.refresh_from_db()
    assert listing.status == Listing.Status.PICKED_UP
    assert good.data["status"] == Claim.Status.PICKED_UP


def test_deliver_rewards_trust_both_sides(api, volunteer, verified_donor):
    donor, org = verified_donor
    listing, claim_id, code = full_claim_to_picked_up(api, volunteer, donor, org)
    api.post(f"/api/v1/claims/{claim_id}/verify-pickup/", {"code": code}, format="json")

    resp = api.post(f"/api/v1/claims/{claim_id}/deliver/", {"delivery_note": "Left at gate"}, format="json")
    assert resp.status_code == 200
    listing.refresh_from_db()
    donor.refresh_from_db()
    volunteer.refresh_from_db()
    assert listing.status == Listing.Status.DELIVERED
    assert donor.trust_score == 58 and volunteer.trust_score == 58
    assert TrustAdjustment.objects.filter(reason="delivered").count() == 2


def test_deliver_requires_pickup_first(api, volunteer, verified_donor):
    donor, org = verified_donor
    listing = make_listing(donor, org)
    api.force_authenticate(volunteer)
    claim_id = claim(api, listing).data["id"]
    resp = api.post(f"/api/v1/claims/{claim_id}/deliver/", format="json")
    assert resp.status_code == 409


# -- cancellation -----------------------------------------------------------------

def test_cancel_reopens_listing_and_penalizes(api, volunteer, verified_donor):
    donor, org = verified_donor
    listing = make_listing(donor, org)
    api.force_authenticate(volunteer)
    claim_id = claim(api, listing).data["id"]

    resp = api.post(f"/api/v1/claims/{claim_id}/cancel/", {"reason": "Stuck in traffic"}, format="json")
    assert resp.status_code == 200
    listing.refresh_from_db()
    volunteer.refresh_from_db()
    assert listing.status == Listing.Status.OPEN
    assert volunteer.trust_score == 44  # 50 - 6 late_cancel

    # someone else can now claim the reopened listing
    v2 = User.objects.create_user(username="v2", email="v2@t.in", password="StrongPass123!")
    api.force_authenticate(v2)
    assert claim(api, listing).status_code == 201


def test_expired_listing_cannot_be_claimed(api, volunteer, verified_donor):
    donor, org = verified_donor
    listing = make_listing(donor, org, hours_left=-1)
    api.force_authenticate(volunteer)
    resp = claim(api, listing)
    assert resp.status_code == 409
    assert "expired" in resp.data["error"]["message"].lower()


def test_donor_cannot_claim(api, donor, verified_donor):
    donor2, org = verified_donor
    listing = make_listing(donor2, org)
    api.force_authenticate(donor)
    resp = claim(api, listing)
    assert resp.status_code == 403


def test_anonymous_user_cannot_claim_or_manage(api, verified_donor):
    """Unauthenticated callers: no claims, no edits, no cancels (Phase 3.6)."""
    donor, org = verified_donor
    listing = make_listing(donor, org)
    anon = APIClient()

    assert anon.post(f"/api/v1/listings/{listing.id}/claim/", format="json").status_code == 401
    assert anon.patch(f"/api/v1/listings/{listing.id}/", {"title": "x"}, format="json").status_code == 401
    assert anon.post(f"/api/v1/listings/{listing.id}/cancel/", format="json").status_code == 401
    assert anon.post("/api/v1/claims/1/verify-pickup/", {"code": "1234"}, format="json").status_code == 401


# -- ratings ----------------------------------------------------------------------

def _make_delivered_claim(api, volunteer, donor, org):
    """Run a claim through pickup+delivery; the DONOR reads the pickup code."""
    listing = make_listing(donor, org)
    api.force_authenticate(volunteer)
    resp = claim(api, listing)
    claim_id = resp.data["id"]
    api_don = APIClient()
    api_don.force_authenticate(donor)
    code = api_don.get(f"/api/v1/claims/{claim_id}/").data["pickup_code"]
    assert api.post(f"/api/v1/claims/{claim_id}/verify-pickup/", {"code": code}, format="json").status_code == 200
    assert api.post(f"/api/v1/claims/{claim_id}/deliver/", format="json").status_code == 200
    return claim_id


def test_both_sides_rate_once(api, volunteer, verified_donor):
    donor, org = verified_donor
    claim_id = _make_delivered_claim(api, volunteer, donor, org)

    resp = api.post("/api/v1/ratings/", {"claim": claim_id, "stars": 5, "comment": "Speedy!"}, format="json")
    assert resp.status_code == 201
    donor.refresh_from_db()
    assert donor.trust_score == 60  # 50 + 8 delivered + 2 five-star received

    api_don = APIClient()
    api_don.force_authenticate(donor)
    resp = api_don.post("/api/v1/ratings/", {"claim": claim_id, "stars": 3}, format="json")
    assert resp.status_code == 201
    volunteer.refresh_from_db()
    assert volunteer.trust_score == 58  # +8 delivered; no rating bonus for 3 stars

    # double rating blocked by unique constraint -> serializer must reject
    resp = api.post("/api/v1/ratings/", {"claim": claim_id, "stars": 4}, format="json")
    assert resp.status_code == 400

    # only claim participants can rate
    outsider = User.objects.create_user(username="out", email="out@t.in", password="StrongPass123!")
    api_out = APIClient()
    api_out.force_authenticate(outsider)
    claim2 = _make_delivered_claim(api, volunteer, donor, org)
    resp = api_out.post("/api/v1/ratings/", {"claim": claim2, "stars": 1}, format="json")
    assert resp.status_code == 400


def test_cannot_rate_before_delivery(api, volunteer, verified_donor):
    donor, org = verified_donor
    listing = make_listing(donor, org)
    api.force_authenticate(volunteer)
    claim_id = claim(api, listing).data["id"]
    resp = api.post("/api/v1/ratings/", {"claim": claim_id, "stars": 5}, format="json")
    assert resp.status_code == 400


# -- query-count locks (Part 3.2: no N+1 as data grows) ----------------------------

def test_claims_list_constant_queries(api, volunteer, verified_donor, django_assert_max_num_queries):
    donor, org = verified_donor
    api.force_authenticate(volunteer)
    for _ in range(6):
        listing = make_listing(donor, org)
        resp = claim(api, listing)
        assert resp.status_code == 201
        claim_id = resp.data["id"]
        # deliver so the 2-active-claims cap never trips
        real_code = Claim.objects.get(pk=claim_id).pickup_code
        api.post(f"/api/v1/claims/{claim_id}/verify-pickup/", {"code": real_code}, format="json")
        api.post(f"/api/v1/claims/{claim_id}/deliver/", format="json")
    # 6 claims serialize with nested listings; the count must NOT scale with rows.
    with django_assert_max_num_queries(8):
        resp = api.get("/api/v1/claims/?page_size=50")
    assert resp.data["count"] == 6
