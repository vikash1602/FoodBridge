"""Notification tests: nearby fan-out on new listings, read state."""

from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Organization, User
from listings.models import Listing

pytestmark = pytest.mark.django_db

LIST_URL = "/api/v1/listings/"
NOTIF_URL = "/api/v1/notifications/"


def test_new_listing_notifies_nearby_volunteers(api, volunteer, donor):
    org = Organization.objects.create(
        owner=donor, name="O", type="restaurant", address="a", lat=18.5204, lng=73.8567,
        verification_status=Organization.VerificationStatus.APPROVED,
    )
    donor.is_verified = True
    donor.save(update_fields=["is_verified"])

    # Volunteer sits ~300 m from the listing.
    volunteer.base_lat = 18.5220
    volunteer.base_lng = 73.8580
    volunteer.notify_radius_km = 5
    volunteer.save(update_fields=["base_lat", "base_lng", "notify_radius_km"])

    far_vol = User.objects.create_user("far", "far@t.in", "StrongPass123!", base_lat=19.9, base_lng=74.9)

    api.force_authenticate(donor)
    resp = api.post(
        LIST_URL,
        {
            "title": "Soup", "quantity_value": 4, "quantity_unit": "meals",
            "pickup_address": "a", "lat": 18.5204, "lng": 73.8567,
            "ready_from": timezone.now().isoformat(),
            "safe_until": (timezone.now() + timedelta(hours=2)).isoformat(),
            "organization": org.id,
        },
        format="json",
    )
    assert resp.status_code == 201, resp.data

    api_v = APIClient()
    api_v.force_authenticate(volunteer)
    data = api_v.get(NOTIF_URL).data
    assert data["unread_count"] == 1
    assert "Soup" in data["results"][0]["message"]

    api_f = APIClient()
    api_f.force_authenticate(far_vol)
    assert api_f.get(NOTIF_URL).data["unread_count"] == 0

    # SSE event targeted at the volunteer exists too
    from events.models import Event

    assert Event.objects.filter(audience=f"user:{volunteer.id}", type="listing.new_nearby").exists()


def test_mark_read_and_read_all(api, volunteer):
    from notifications.models import Notification

    n1 = Notification.objects.create(user=volunteer, type="listing_new", message="m1")
    n2 = Notification.objects.create(user=volunteer, type="listing_claimed", message="m2")

    api.force_authenticate(volunteer)
    resp = api.post(f"{NOTIF_URL}{n1.id}/read/", format="json")
    assert resp.status_code == 200 and resp.data["is_read"] is True

    data = api.get(NOTIF_URL + "?unread=true").data
    assert data["count"] == 1

    resp = api.post(f"{NOTIF_URL}read-all/", format="json")
    assert resp.data["marked_read"] == 1
    data = api.get(NOTIF_URL).data
    assert data["unread_count"] == 0


def test_cannot_read_others_notification(api, volunteer):
    from notifications.models import Notification

    other = User.objects.create_user("o", "o@t.in", "StrongPass123!")
    n = Notification.objects.create(user=other, type="listing_new", message="private")
    api.force_authenticate(volunteer)
    resp = api.post(f"{NOTIF_URL}{n.id}/read/", format="json")
    assert resp.status_code == 404
