"""Cron endpoint security tests (Part C5).

Covers: shared-secret auth, HMAC mode, replay rejection, wrong-method
rejection, closed-when-unconfigured, and actual task execution."""

import hashlib
import hmac
import time

import pytest
from django.core.cache import cache
from django.test import override_settings
from rest_framework.test import APIClient

from accounts.models import EmailOutbox

pytestmark = pytest.mark.django_db

SECRET = "cron-secret-that-is-definitely-long-enough-32chars"
EXPIRE_URL = "/api/v1/cron/expire-listings/"
OUTBOX_URL = "/api/v1/cron/process-email-outbox/"


@pytest.fixture(autouse=True)
def cron_settings():
    rates = {**{"user": "120/min", "anon": "30/min", "auth": "20/min", "claim": "12/min",
                "listing_create": "20/hour", "report": "10/hour", "cron": "10000/min"}}
    with override_settings(CRON_SECRET_KEY=SECRET, REST_FRAMEWORK={"DEFAULT_THROTTLE_RATES": rates}):
        cache.clear()
        yield
    cache.clear()


def _auth_header():
    return {"HTTP_AUTHORIZATION": f"Bearer {SECRET}"}


def _hmac_headers(operation: str, timestamp: float | None = None):
    ts = str(timestamp if timestamp is not None else time.time())
    sig = hmac.new(SECRET.encode(), f"{ts}\n{operation}".encode(), hashlib.sha256).hexdigest()
    return {"HTTP_X_CRON_SIGNATURE": sig, "HTTP_X_CRON_TIMESTAMP": ts}


def test_cron_endpoints_closed_without_secret():
    """No CRON_SECRET_KEY configured -> endpoints stay closed even for anon."""
    from django.test import override_settings as _os

    api = APIClient()
    with _os(CRON_SECRET_KEY=""):
        assert api.post(EXPIRE_URL, format="json").status_code == 403
        assert api.post(OUTBOX_URL, format="json").status_code == 403


def test_shared_secret_runs_expire_listings():
    api = APIClient()
    resp = api.post(EXPIRE_URL, format="json", **_auth_header())
    assert resp.status_code == 200
    assert resp.data["operation"] == "expire-listings"
    assert resp.data["result"] == "completed"


def test_shared_secret_runs_outbox_processing(monkeypatch):
    from accounts import otp as otp_mod
    from django.utils import timezone

    from accounts.models import User

    user = User.objects.create_user("cronmail", "cronmail@t.in", "StrongPass123!")
    EmailOutbox.objects.create(
        to_email=user.email, subject="s", body="body 123456", purpose="otp",
        status=EmailOutbox.Status.PENDING,
    )
    # The cron view runs the worker inside the server process; neutralize
    # close_old_connections() so the TestCase's transaction connection survives.
    monkeypatch.setattr(otp_mod, "close_old_connections", lambda: None, raising=True)
    # Force the console provider so the test doesn't hit the real Resend API.
    with override_settings(RESEND_API_KEY="", DEBUG=True, OTP_EMAIL_FALLBACK_TO_CONSOLE=True):
        api = APIClient()
        resp = api.post(OUTBOX_URL, format="json", **_auth_header())
        assert resp.status_code == 200
        assert "processed=1" in resp.data["result"]
        outbox_row = EmailOutbox.objects.get(to_email=user.email, purpose="otp")
        assert outbox_row.status == EmailOutbox.Status.ACCEPTED  # console provider (no key)


def test_missing_or_wrong_secret_rejected():
    api = APIClient()
    assert api.post(EXPIRE_URL, format="json").status_code == 403
    assert api.post(EXPIRE_URL, format="json", **{"HTTP_AUTHORIZATION": "Bearer wrong-secret-that-is-long"}).status_code == 403


def test_hmac_mode_accepted():
    api = APIClient()
    resp = api.post(EXPIRE_URL, format="json", **_hmac_headers("expire-listings"))
    assert resp.status_code == 200


def test_replayed_or_stale_hmac_rejected():
    api = APIClient()
    stale_ts = time.time() - 3600  # one hour old — beyond the 5-minute window
    resp = api.post(EXPIRE_URL, format="json", **_hmac_headers("expire-listings", stale_ts))
    assert resp.status_code == 403


def test_get_method_rejected():
    api = APIClient()
    assert api.get(EXPIRE_URL, **_auth_header()).status_code == 405
    assert api.get(OUTBOX_URL, **_auth_header()).status_code == 405
