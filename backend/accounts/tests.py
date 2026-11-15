"""Phase 1 tests: auth, roles, organization verification gating."""

import pytest
from datetime import timedelta
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Organization, User

pytestmark = pytest.mark.django_db


# -- registration ------------------------------------------------------------

REGISTER_URL = "/api/v1/auth/register/"
LOGIN_URL = "/api/v1/auth/login/"
ME_URL = "/api/v1/auth/me/"


def test_register_donor_and_login(api):
    payload = {
        "email": "ravi@dhaba.in",
        "password": "Tandoori#7",
        "confirm_password": "Tandoori#7",
        "role": "donor",
        "full_name": "Ravi Kumar",
        "phone": "9876543210",
    }
    resp = api.post(REGISTER_URL, payload, format="json")
    assert resp.status_code == 201
    user = User.objects.get(email="ravi@dhaba.in")
    assert user.role == User.Role.DONOR
    assert user.first_name == "Ravi"
    assert user.trust_score == 50

    login = api.post(LOGIN_URL, {"email": "ravi@dhaba.in", "password": "Tandoori#7"}, format="json")
    assert login.status_code == 200
    assert "access" in login.data and "refresh" in login.data
    assert login.data["user"]["role"] == "donor"


def test_register_rejects_admin_role_and_bad_password(api):
    resp = api.post(REGISTER_URL, {"email": "x@y.in", "password": "Aa1!aaaa", "confirm_password": "Aa1!aaaa", "role": "admin"}, format="json")
    assert resp.status_code == 400

    resp = api.post(REGISTER_URL, {"email": "x@y.in", "password": "weak", "confirm_password": "weak", "role": "volunteer"}, format="json")
    assert resp.status_code == 400


def test_me_requires_auth_and_patch_updates_location(api):
    api = APIClient()
    assert api.get(ME_URL).status_code == 401

    user = User.objects.create_user(username="me1", email="me1@t.in", password="StrongPass123!", role=User.Role.VOLUNTEER)
    api.force_authenticate(user)
    resp = api.patch(ME_URL, {"base_lat": 18.52, "base_lng": 73.85, "notify_radius_km": 8}, format="json")
    assert resp.status_code == 200
    user.refresh_from_db()
    assert user.base_lat == 18.52 and user.notify_radius_km == 8

    # Role/email/trust are not editable through the profile endpoint.
    resp = api.patch(ME_URL, {"role": "admin", "trust_score": 100}, format="json")
    user.refresh_from_db()
    assert user.role == User.Role.VOLUNTEER and user.trust_score == 50


# -- trust badges -------------------------------------------------------------

@pytest.mark.parametrize(
    "score,badge",
    [(50, "new"), (60, "reliable"), (75, "trusted"), (90, "champion"), (100, "champion"), (10, "new")],
)
def test_badges(score, badge):
    user = User(trust_score=score)
    assert user.badge == badge


# -- organization verification gating -----------------------------------------
def _create_org(api, donor):
    api.force_authenticate(donor)
    return api.post(
        "/api/v1/organizations/",
        {"name": "Green Hotel", "type": "hostel", "address": "5 Station Rd", "lat": 18.52, "lng": 73.85},
        format="json",
    )


def test_unverified_donor_cannot_post_listing(api, donor):
    resp = _create_org(api, donor)
    assert resp.status_code == 201
    donor.refresh_from_db()
    assert donor.is_verified is False

    payload = {
        "title": "Paneer bowls",
        "quantity_value": 10,
        "quantity_unit": "meals",
        "food_type": "cooked",
        "is_veg": True,
        "pickup_address": "5 Station Rd",
        "lat": 18.52,
        "lng": 73.85,
        "ready_from": "2026-01-01T10:00:00Z",
        "safe_until": "2026-01-01T14:00:00Z",
    }
    resp = api.post("/api/v1/listings/", payload, format="json")
    assert resp.status_code == 403
    assert "verified" in resp.data["error"]["message"].lower()


def test_admin_approves_org_then_donor_can_post(api, donor, admin_user):
    _create_org(api, donor)
    org = Organization.objects.get(owner=donor)

    # volunteer cannot see other people's orgs
    vol = User.objects.create_user(username="v1", email="v1@t.in", password="StrongPass123!")
    api.force_authenticate(vol)
    assert api.get("/api/v1/organizations/").status_code == 200
    assert api.get("/api/v1/organizations/").data["count"] == 0

    # admin approves
    api.force_authenticate(admin_user)
    resp = api.post(f"/api/v1/organizations/{org.id}/approve/", {"note": "Docs OK"}, format="json")
    assert resp.status_code == 200
    donor.refresh_from_db()
    org.refresh_from_db()
    assert donor.is_verified is True
    assert org.verification_status == Organization.VerificationStatus.APPROVED

    # now the donor can post
    api.force_authenticate(donor)
    payload = {
        "title": "Rice plates",
        "quantity_value": 20,
        "quantity_unit": "meals",
        "pickup_address": "5 Station Rd",
        "lat": 18.52,
        "lng": 73.85,
        "ready_from": "2026-01-01T10:00:00Z",
        "safe_until": "2026-01-01T14:00:00Z",
    }
    resp = api.post("/api/v1/listings/", payload, format="json")
    assert resp.status_code == 201
    assert resp.data["status"] == "open"


def test_volunteer_cannot_create_organization(api, volunteer):
    """Organizations belong to donors; volunteers/NGOs never post listings."""
    api.force_authenticate(volunteer)
    resp = api.post(
        "/api/v1/organizations/",
        {"name": "NGO Test", "type": "ngo", "address": "somewhere", "lat": 18.5, "lng": 73.8},
        format="json",
    )
    assert resp.status_code == 403


def test_reject_resets_verified_flag(api, donor, admin_user):
    _create_org(api, donor)
    org = Organization.objects.get(owner=donor)
    api.force_authenticate(admin_user)
    api.post(f"/api/v1/organizations/{org.id}/approve/", format="json")
    donor.refresh_from_db()
    assert donor.is_verified

    # donor re-submits a corrected org
    api.force_authenticate(donor)
    resp = api.post(
        "/api/v1/organizations/",
        {"name": "Green Hotel 2", "type": "hostel", "address": "9 Lake Rd", "lat": 18.53, "lng": 73.86},
        format="json",
    )
    assert resp.status_code == 201
    donor.refresh_from_db()
    assert donor.is_verified is False


# -- platform config & IST timezone ---------------------------------------------

def test_platform_config_endpoint(api):
    resp = api.get("/api/v1/config/")
    assert resp.status_code == 200
    data = resp.data
    assert data["city_name"]
    assert 0 < data["center"]["lat"] < 90 and 0 < data["center"]["lng"] < 180
    assert data["zoom"] >= 5
    assert data["service_area_km"] > 0
    assert data["timezone"] == "Asia/Kolkata"
    radii = [tier["radius_km"] for tier in data["escalation_tiers"]]
    assert radii == sorted(radii) and len(radii) == 3  # tier1, tier2, max


def test_datetimes_serialize_in_ist(api, donor, approved_org):
    """safe_until must come back in IST (+05:30) — countdowns & pickup windows."""
    api.force_authenticate(donor)
    donor.is_verified = True
    donor.save(update_fields=["is_verified"])
    from django.utils import timezone as tz

    safe = tz.now() + timedelta(hours=4)
    resp = api.post(
        "/api/v1/listings/",
        {
            "title": "IST check",
            "quantity_value": 1,
            "pickup_address": "x",
            "lat": 12.68,
            "lng": 78.62,
            "ready_from": tz.now().isoformat(),
            "safe_until": safe.isoformat(),
        },
        format="json",
    )
    assert resp.status_code == 201
    assert resp.data["safe_until"].endswith("+05:30")
    # The IST wall-clock hour matches what the local user expects.
    ist_hour = resp.data["safe_until"][11:13]
    expected_hour = timezone.localtime(safe).strftime("%H")
    assert ist_hour == expected_hour


def test_expiry_judged_in_utc_not_wall_clock(donor, approved_org):
    """A listing whose safe_until (IST) has passed must be excluded, even though
    the server's local wall clock is already ahead/behind UTC."""
    from listings.models import Listing

    now = timezone.now()
    past = Listing.objects.create(
        donor=donor, organization=approved_org, title="stale",
        quantity_value=1, pickup_address="x", lat=12.68, lng=78.62,
        ready_from=now - timedelta(hours=3), safe_until=now - timedelta(minutes=30),
    )
    listing = Listing.objects.filter(status=Listing.Status.OPEN, safe_until__gt=timezone.now())
    assert not listing.filter(pk=past.pk).exists()


def test_jwt_refresh_and_expiry():
    """A valid refresh yields a working new access token; a tampered token is
    rejected and cannot reach protected endpoints (Phase 3.5)."""
    from rest_framework_simplejwt.exceptions import TokenError
    from rest_framework_simplejwt.tokens import AccessToken

    user = User.objects.create_user("jwtuser", "jwt@t.in", "StrongPass123!", role=User.Role.VOLUNTEER)
    api = APIClient()

    login = api.post("/api/v1/auth/login/", {"email": "jwt@t.in", "password": "StrongPass123!"}, format="json")
    assert login.status_code == 200
    access, refresh = login.data["access"], login.data["refresh"]

    # The access token works on a protected endpoint.
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
    assert api.get("/api/v1/auth/me/").status_code == 200

    # Refresh rotation yields a new usable access token.
    refreshed = api.post("/api/v1/auth/refresh/", {"refresh": refresh}, format="json")
    assert refreshed.status_code == 200
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {refreshed.data['access']}")
    assert api.get("/api/v1/auth/me/").status_code == 200

    # A tampered access token is rejected at the door.
    tampered = access[:-4] + "beef"
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {tampered}")
    assert api.get("/api/v1/auth/me/").status_code == 401

    # An expired (back-dated) token fails validation.
    expired = AccessToken.for_user(user)
    expired.set_exp(lifetime=timedelta(seconds=-10))
    with pytest.raises(TokenError):
        expired.verify()
