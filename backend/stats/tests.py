"""Stats endpoint tests: caching behaviour + query-count locks (Part 3)."""

from datetime import timedelta

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Organization, User
from claims.models import Claim
from listings.models import Listing

pytestmark = pytest.mark.django_db

STATS_URL = "/api/v1/stats/"


@pytest.fixture(autouse=True)
def clear_stats_cache():
    cache.clear()
    yield
    cache.clear()


def _rescue_complete(donor, org, volunteer, title="T"):
    listing = Listing.objects.create(
        donor=donor, organization=org, title=title, quantity_value=10,
        quantity_unit=Listing.QuantityUnit.MEALS, pickup_address="x",
        lat=12.68, lng=78.62, ready_from=timezone.now(),
        safe_until=timezone.now() + timedelta(hours=2),
    )
    claim = Claim.objects.create(listing=listing, volunteer=volunteer)
    claim.status = Claim.Status.DELIVERED
    claim.save(update_fields=["status"])
    listing.status = Listing.Status.DELIVERED
    listing.save(update_fields=["status"])
    return listing, claim


@pytest.fixture
def world(donor):
    org = Organization.objects.create(
        owner=donor, name="O", type="restaurant", address="a", lat=12.68, lng=78.62,
        verification_status=Organization.VerificationStatus.APPROVED,
    )
    volunteer = User.objects.create_user("sv", "sv@t.in", "StrongPass123!")
    _rescue_complete(donor, org, volunteer)
    return donor, org, volunteer


def test_personal_stats_shape(api, world):
    donor, org, volunteer = world
    api.force_authenticate(donor)
    resp = api.get(STATS_URL + "?scope=me")
    assert resp.status_code == 200
    assert resp.data["rescued"]["delivered_as_donor"] == 1
    assert resp.data["rescued"]["meals_equivalent"] == 10
    assert resp.data["badge"] in ("new", "reliable", "trusted", "champion")


def test_stats_me_cached_second_call_is_cheap(api, world, django_assert_max_num_queries):
    donor, org, volunteer = world
    api.force_authenticate(donor)
    api.get(STATS_URL + "?scope=me")
    # Second call is a cache hit: at most 2 queries (session/auth).
    with django_assert_max_num_queries(2):
        resp = api.get(STATS_URL + "?scope=me")
    assert resp.status_code == 200


def test_leaderboard_cached_and_ranked(api, world):
    donor, org, volunteer = world
    api.force_authenticate(volunteer)
    first = api.get(STATS_URL + "?metric=leaderboard")
    assert first.status_code == 200
    assert first.data["volunteers"][0]["deliveries"] == 1


def test_leaderboard_second_call_fully_cached(api, world, django_assert_max_num_queries):
    donor, org, volunteer = world
    api.force_authenticate(volunteer)
    api.get(STATS_URL + "?metric=leaderboard")
    with django_assert_max_num_queries(2):
        second = api.get(STATS_URL + "?metric=leaderboard")
    assert second.data["donors"][0]["deliveries"] == 1


def test_platform_stats_admin_only(api, world, admin_user):
    donor, org, volunteer = world
    api.force_authenticate(volunteer)
    assert api.get(STATS_URL + "?scope=platform").status_code == 403
    api.force_authenticate(admin_user)
    resp = api.get(STATS_URL + "?scope=platform")
    assert resp.data["rescued"]["delivered"] == 1
    assert resp.data["users"]["active_volunteers"] == 1
