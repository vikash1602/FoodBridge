"""Phase 5 tests: reports, admin console (users, suspend), verification queue."""

from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Organization, User
from claims.models import Claim, Report
from listings.models import Listing

pytestmark = pytest.mark.django_db

REPORTS = "/api/v1/reports/"
ADMIN_USERS = "/api/v1/admin/users/"


@pytest.fixture
def donor_org_verified(donor):
    org = Organization.objects.create(
        owner=donor, name="Anand Bhavan", type="restaurant",
        address="12 MG Road", lat=18.5204, lng=73.8567,
        verification_status=Organization.VerificationStatus.APPROVED,
    )
    donor.is_verified = True
    donor.save(update_fields=["is_verified"])
    return donor, org


def make_listing(donor, org):
    return Listing.objects.create(
        donor=donor, organization=org, title="Curry", quantity_value=8,
        pickup_address="12 MG Road", lat=18.5204, lng=73.8567,
        ready_from=timezone.now(),
        safe_until=timezone.now() + timedelta(hours=2),
    )


# -- reports ------------------------------------------------------------------

def test_report_listing_flow(api, donor, donor_org_verified, admin_user):
    donor, org = donor_org_verified
    listing = make_listing(donor, org)
    api.force_authenticate(api_user := User.objects.create_user("rep1", "rep1@t.in", "StrongPass123!"))

    resp = api.post(REPORTS, {"listing": listing.id, "reason": "Food already spoiled", "details": "Smelled bad"}, format="json")
    assert resp.status_code == 201
    assert resp.data["status"] == Report.Status.OPEN

    # reporter sees own; others see none
    other = User.objects.create_user("rep2", "rep2@t.in", "StrongPass123!")
    api2 = APIClient()
    api2.force_authenticate(other)
    assert api2.get(REPORTS).data["count"] == 0

    # admin resolves with upheld -> donor trust -5
    api.force_authenticate(admin_user)
    donor.refresh_from_db()
    before = donor.trust_score
    resp = api.post(f"{REPORTS}{resp.data['id']}/resolve/", {"upheld": True, "admin_note": "Verified"}, format="json")
    assert resp.status_code == 200
    donor.refresh_from_db()
    assert donor.trust_score == before - 5

    # queue filter empties
    assert api.get(REPORTS + "?status=open").data["count"] == 0


def test_report_requires_target(api, volunteer):
    api.force_authenticate(volunteer)
    resp = api.post(REPORTS, {"reason": "nothing"}, format="json")
    assert resp.status_code == 400


def test_report_user_penalizes_on_uphold(api, volunteer, admin_user):
    api.force_authenticate(admin_user)
    target = User.objects.create_user("bad", "bad@t.in", "StrongPass123!")
    rid = api.post(REPORTS, {"reported_user": target.id, "reason": "No-show twice"}, format="json").data["id"]
    api.force_authenticate(admin_user)
    resp = api.post(f"{REPORTS}{rid}/resolve/", {"upheld": True}, format="json")
    target.refresh_from_db()
    assert target.trust_score == 45

    # not upheld: no penalty
    api.force_authenticate(admin_user)
    rid2 = api.post(REPORTS, {"reported_user": target.id, "reason": "petty"}, format="json").data["id"]
    api.post(f"{REPORTS}{rid2}/resolve/", {"upheld": False}, format="json")
    target.refresh_from_db()
    assert target.trust_score == 45


def test_volunteer_cannot_resolve(api, volunteer):
    api.force_authenticate(volunteer)
    target = User.objects.create_user("t2", "t2@t.in", "StrongPass123!")
    rid = api.post(REPORTS, {"reported_user": target.id, "reason": "x"}, format="json").data["id"]
    resp = api.post(f"{REPORTS}{rid}/resolve/", {"upheld": True}, format="json")
    assert resp.status_code == 403


# -- admin console ---------------------------------------------------------------

def test_admin_user_list_and_suspend(api, admin_user, donor, volunteer):
    api.force_authenticate(admin_user)
    data = api.get(ADMIN_USERS).data
    assert data["count"] >= 3

    donor_id = donor.id
    resp = api.post(f"{ADMIN_USERS}{donor_id}/suspend/", format="json")
    assert resp.status_code == 200 and resp.data["is_suspended"] is True

    # suspended donor cannot create listings
    api_d = APIClient()
    api_d.force_authenticate(donor)
    now = timezone.now()
    resp = api_d.post(
        "/api/v1/listings/",
        {"title": "x", "quantity_value": 1, "pickup_address": "y", "lat": 18.5, "lng": 73.8,
         "ready_from": now.isoformat(), "safe_until": (now + timedelta(hours=1)).isoformat()},
        format="json",
    )
    assert resp.status_code == 403

    resp = api.post(f"{ADMIN_USERS}{donor_id}/unsuspend/", format="json")
    assert resp.data["is_suspended"] is False


def test_admin_users_forbidden_for_others(api, donor):
    api.force_authenticate(donor)
    assert api.get(ADMIN_USERS).status_code == 403


def test_admin_filters_and_search(api, admin_user, donor, volunteer):
    api.force_authenticate(admin_user)
    assert api.get(ADMIN_USERS + "?role=donor").data["count"] == 1
    assert api.get(ADMIN_USERS + "?search=vol").data["count"] == 1


def test_verification_queue_listing(api, admin_user, donor):
    Organization.objects.create(
        owner=donor, name="Pending Dhaba", type="caterer", address="x", lat=18.5, lng=73.8
    )
    api.force_authenticate(admin_user)
    pending = api.get("/api/v1/organizations/?verification_status=pending").data
    assert pending["count"] == 1
    assert pending["results"][0]["name"] == "Pending Dhaba"
