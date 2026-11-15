"""Shared fixtures."""

import pytest
from rest_framework.test import APIClient

from accounts.models import Organization, User


@pytest.fixture
def api():
    return APIClient()


def make_user(email, role=User.Role.VOLUNTEER, password="StrongPass123!", **extra):
    base = email.split("@")[0]
    return User.objects.create_user(
        username=base, email=email, password=password, role=role, **extra
    )


@pytest.fixture
def donor(db):
    return make_user("donor@test.com", User.Role.DONOR, first_name="Don", last_name="Or")


@pytest.fixture
def volunteer(db):
    return make_user("volunteer@test.com", User.Role.VOLUNTEER, first_name="Vol", last_name="Un")


@pytest.fixture
def admin_user(db):
    return make_user("admin@test.com", User.Role.ADMIN, is_staff=True, is_superuser=True)


@pytest.fixture
def approved_org(donor):
    return Organization.objects.create(
        owner=donor,
        name="Anand Bhavan",
        type=Organization.OrgType.RESTAURANT,
        address="12 MG Road, Pune",
        lat=18.5204,
        lng=73.8567,
        verification_status=Organization.VerificationStatus.APPROVED,
    )


def auth(api, user):
    """Attach a JWT access token for `user` to the client."""
    from rest_framework_simplejwt.tokens import RefreshToken

    api.force_authenticate(user)
    return api
