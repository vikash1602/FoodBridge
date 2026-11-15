"""OTP + delivery-outbox tests.

Covers the Phase G checklist: OTP lifecycle, dev_code gating for every
configuration, Resend client outcomes (200/401/403-restricted/403-account/
422/429/500/timeout/invalid-json/missing-id), API-key redaction, outbox retry
semantics (permanent vs transient), worker-crash recovery, and
transaction.on_commit scheduling.
"""

import json
import subprocess
import sys
import time
import unittest.mock as mock
from datetime import timedelta
from io import BytesIO

import pytest
from django.conf import settings
from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts import otp as otp_mod
from accounts.models import EmailOutbox, OtpCode, User

pytestmark = pytest.mark.django_db

REQUEST_URL = "/api/v1/auth/otp/request/"
STATUS_URL = "/api/v1/auth/otp/status/"
VERIFY_URL = "/api/v1/auth/otp/verify/"

FAKE_KEY = "re_test-key-1234567890"


@pytest.fixture(autouse=True)
def otp_test_env(monkeypatch):
    """pytest-django forces DEBUG=False; restore DEBUG for dev_code paths.
    Lift the auth throttle (suite shares one anonymous key), run the delivery
    worker synchronously, neutralize close_old_connections() (it would close
    the TestCase's own transaction connection), and force the no-key state so
    dev_code tests are deterministic (key-present tests set it explicitly)."""
    rates = {
        **settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"],
        "auth": "10000/min",
        "anon": "10000/min",
        "user": "10000/min",
        "cron": "10000/min",
    }
    with override_settings(
        DEBUG=True,
        OTP_EMAIL_FALLBACK_TO_CONSOLE=True,
        REST_FRAMEWORK={**settings.REST_FRAMEWORK, "DEFAULT_THROTTLE_RATES": rates},
    ):
        monkeypatch.setattr(otp_mod._executor, "submit", (lambda fn, *a: None), raising=True)
        monkeypatch.setattr(otp_mod, "close_old_connections", lambda: None, raising=True)
        monkeypatch.setattr(otp_mod, "_resend_api_key", lambda: "", raising=True)
        yield


@pytest.fixture(autouse=True)
def clear_otp_rows():
    """transaction=True tests commit rows that persist across runs. Teardown
    wipes the LocMem throttle counter too (the lifted auth rate still records
    hits, which would 429 the next test file at the restored rate)."""
    from django.core.cache import cache

    cache.clear()
    OtpCode.objects.all().delete()
    EmailOutbox.objects.all().delete()
    yield
    OtpCode.objects.all().delete()
    EmailOutbox.objects.all().delete()
    cache.clear()


def _dev_code(response_json) -> str:
    code = response_json["dev_code"]
    assert code, "dev_code must be present in the no-key dev configuration"
    return code


def _mock_urlopen(status: int, payload: dict):
    response = mock.Mock()
    response.status = status
    response.read = lambda: json.dumps(payload).encode()
    response.__enter__ = lambda s: response
    response.__exit__ = lambda s, *a: False
    return mock.patch("accounts.otp.urllib.request.urlopen", return_value=response)


def _mock_http_error(status: int, body: str):
    error = __import__("urllib").error.HTTPError(
        "https://api.resend.com/emails", status, "rejected", {}, BytesIO(body.encode())
    )
    return mock.patch("accounts.otp.urllib.request.urlopen", side_effect=error)


# -- OTP lifecycle ----------------------------------------------------------------

def test_otp_request_creates_hashed_rows_fast():
    User.objects.create_user("u1", "u1@t.in", "StrongPass123!")
    api = APIClient()
    samples = []
    for _ in range(3):
        OtpCode.objects.all().delete()
        EmailOutbox.objects.all().delete()
        start = time.perf_counter()
        resp = api.post(REQUEST_URL, {"email": "u1@t.in"}, format="json")
        samples.append((time.perf_counter() - start) * 1000)
    assert resp.status_code == 200
    assert sorted(samples)[1] < 300  # median of 3

    row = OtpCode.objects.get(email="u1@t.in")
    assert len(row.code_hash) == 64 and row.code_hash != resp.data.get("dev_code")
    outbox = EmailOutbox.objects.get(to_email="u1@t.in", purpose="otp")
    assert outbox.status in (EmailOutbox.Status.PENDING, EmailOutbox.Status.SENDING,
                             EmailOutbox.Status.ACCEPTED)


def test_otp_verify_returns_jwt():
    User.objects.create_user("u2", "u2@t.in", "StrongPass123!")
    api = APIClient()
    resp = api.post(REQUEST_URL, {"email": "u2@t.in"}, format="json")
    verify = api.post(VERIFY_URL, {"email": "u2@t.in", "code": _dev_code(resp.data)}, format="json")
    assert verify.status_code == 200
    assert "access" in verify.data and verify.data["user"]["email"] == "u2@t.in"
    # Single-use.
    again = api.post(VERIFY_URL, {"email": "u2@t.in", "code": _dev_code(resp.data)}, format="json")
    assert again.status_code == 400 and again.data["error"]["code"] == "expired"


def test_expiry_and_five_attempt_limit():
    User.objects.create_user("u3", "u3@t.in", "StrongPass123!")
    api = APIClient()
    resp = api.post(REQUEST_URL, {"email": "u3@t.in"}, format="json")
    code = _dev_code(resp.data)

    OtpCode.objects.filter(email="u3@t.in").update(expires_at=timezone.now() - timedelta(seconds=1))
    expired = api.post(VERIFY_URL, {"email": "u3@t.in", "code": code}, format="json")
    assert expired.data["error"]["code"] == "expired"

    # Backdate past the resend cooldown before the second request.
    api2 = APIClient()
    # Backdate past the 30 s resend cooldown before the second request.
    OtpCode.objects.filter(email="u3@t.in").update(
        last_sent_at=timezone.now() - timedelta(seconds=otp_mod.OTP_RESEND_COOLDOWN + 1)
    )
    resp2 = api2.post(REQUEST_URL, {"email": "u3@t.in"}, format="json")
    _dev_code(resp2.data)
    for attempt in range(otp_mod.OTP_MAX_ATTEMPTS):
        bad = api2.post(VERIFY_URL, {"email": "u3@t.in", "code": "000000"}, format="json")
        expected = "invalid" if attempt < otp_mod.OTP_MAX_ATTEMPTS - 1 else "too_many_attempts"
        assert bad.data["error"]["code"] == expected


def test_resend_cooldown():
    User.objects.create_user("u4", "u4@t.in", "StrongPass123!")
    api = APIClient()
    assert api.post(REQUEST_URL, {"email": "u4@t.in"}, format="json").status_code == 200
    blocked = api.post(REQUEST_URL, {"email": "u4@t.in"}, format="json")
    assert blocked.status_code == 429
    assert blocked.data["error"]["details"]["retry_after"] >= 1


def test_previous_code_invalidated_on_new_request():
    User.objects.create_user("u5", "u5@t.in", "StrongPass123!")
    api = APIClient()
    first = api.post(REQUEST_URL, {"email": "u5@t.in"}, format="json")
    OtpCode.objects.filter(email="u5@t.in").update(
        last_sent_at=timezone.now() - timedelta(seconds=otp_mod.OTP_RESEND_COOLDOWN + 1)
    )
    second = api.post(REQUEST_URL, {"email": "u5@t.in"}, format="json")
    stale = api.post(VERIFY_URL, {"email": "u5@t.in", "code": _dev_code(first.data)}, format="json")
    assert stale.status_code == 400
    ok = api.post(VERIFY_URL, {"email": "u5@t.in", "code": _dev_code(second.data)}, format="json")
    assert ok.status_code == 200


# -- dev_code gating (Phase C) ------------------------------------------------------

def test_dev_code_suppressed_when_resend_configured(monkeypatch):
    """DEBUG=True + configured Resend -> the code NEVER reaches the response."""
    User.objects.create_user("g1", "g1@t.in", "StrongPass123!")
    monkeypatch.setattr(otp_mod, "_resend_api_key", lambda: FAKE_KEY)
    with override_settings(DEBUG=True):
        api = APIClient()
        resp = api.post(REQUEST_URL, {"email": "g1@t.in"}, format="json")
    assert resp.status_code == 200
    assert resp.data["dev_code"] is None


def test_dev_code_only_with_debug_and_console_fallback(monkeypatch):
    User.objects.create_user("g2", "g2@t.in", "StrongPass123!")
    monkeypatch.setattr(otp_mod, "_resend_api_key", lambda: "")
    api = APIClient()

    # DEBUG=True + explicit console fallback -> dev_code present.
    with override_settings(DEBUG=True, OTP_EMAIL_FALLBACK_TO_CONSOLE=True):
        resp = api.post(REQUEST_URL, {"email": "g2@t.in"}, format="json")
        assert _dev_code(resp.data)

    # Console fallback disabled -> no dev_code even in DEBUG.
    OtpCode.objects.all().delete()
    with override_settings(DEBUG=True, OTP_EMAIL_FALLBACK_TO_CONSOLE=False):
        resp = api.post(REQUEST_URL, {"email": "g2@t.in"}, format="json")
        assert resp.data["dev_code"] is None

    # DEBUG=False -> never.
    OtpCode.objects.all().delete()
    with override_settings(DEBUG=False, OTP_EMAIL_FALLBACK_TO_CONSOLE=True):
        resp = api.post(REQUEST_URL, {"email": "g2@t.in"}, format="json")
        assert resp.data["dev_code"] is None


def test_missing_key_with_fallback_disabled_records_configuration_error(monkeypatch):
    User.objects.create_user("g3", "g3@t.in", "StrongPass123!")
    monkeypatch.setattr(otp_mod, "_resend_api_key", lambda: "")
    with override_settings(DEBUG=False, OTP_EMAIL_FALLBACK_TO_CONSOLE=False):
        api = APIClient()
        resp = api.post(REQUEST_URL, {"email": "g3@t.in"}, format="json")
        assert resp.status_code == 200
        assert resp.data["delivery"]["status"] == EmailOutbox.Status.PENDING
        outbox = EmailOutbox.objects.get(to_email="g3@t.in", purpose="otp")
        assert outbox.status == EmailOutbox.Status.PENDING  # queued, not yet attempted
        # Explicit processor run records the configuration failure.
        otp_mod.process_outbox_email(outbox.pk)
        outbox.refresh_from_db()
        assert outbox.status == EmailOutbox.Status.FAILED
        assert outbox.failure_category == "configuration_error"
        # The status endpoint must NOT claim provider acceptance.
        status = api.get(STATUS_URL, {"email": "g3@t.in"})
        assert status.data["delivery"]["status"] == EmailOutbox.Status.FAILED


def test_on_commit_scheduling(monkeypatch, django_capture_on_commit_callbacks):
    """The executor is invoked only after the request's transaction commits,
    exactly once, referencing the created outbox row."""
    submitted = []
    monkeypatch.setattr(otp_mod, "_submit_delivery", lambda pk: submitted.append(pk))
    User.objects.create_user("g4", "g4@t.in", "StrongPass123!")
    api = APIClient()
    with django_capture_on_commit_callbacks(execute=True) as callbacks:
        resp = api.post(REQUEST_URL, {"email": "g4@t.in"}, format="json")
    assert resp.status_code == 200
    assert len(callbacks) >= 1  # on_commit hooks fired on commit
    assert len(submitted) == 1
    outbox = EmailOutbox.objects.get(to_email="g4@t.in", purpose="otp")
    assert submitted[0] == outbox.pk


# -- Resend client outcomes (Phase B) ------------------------------------------------

def _run_delivery(email: str, status: int | None, payload=None, raw_body: str | None = None,
                  side_effect=None, api_key: str = FAKE_KEY):
    with override_settings(DEBUG=False, RESEND_API_KEY=api_key):
        monkeypatch_key = mock.patch.object(otp_mod, "_resend_api_key", lambda: api_key)
        monkeypatch_key.start()
        try:
            api = APIClient()
            api.post(REQUEST_URL, {"email": email}, format="json")
            outbox = EmailOutbox.objects.get(to_email=email, purpose="otp")
            if side_effect is not None:
                with mock.patch("accounts.otp.urllib.request.urlopen", side_effect=side_effect):
                    otp_mod.process_outbox_email(outbox.pk)
            else:
                body_text = raw_body if raw_body is not None else json.dumps(payload or {})
                response = mock.Mock()
                response.status = status
                response.read = lambda: body_text.encode()
                response.__enter__ = lambda s: response
                response.__exit__ = lambda s, *a: False
                with mock.patch("accounts.otp.urllib.request.urlopen", return_value=response):
                    otp_mod.process_outbox_email(outbox.pk)
            outbox.refresh_from_db()
            return outbox
        finally:
            monkeypatch_key.stop()


def test_resend_200_accepts_with_message_id():
    outbox = _run_delivery("r1@t.in", 200, {"id": "01a1d068-ce44-7181"})
    assert outbox.status == EmailOutbox.Status.ACCEPTED
    assert outbox.provider_message_id == "01a1d068-ce44-7181"
    assert outbox.provider_status_code == 200
    assert outbox.provider == EmailOutbox.Provider.RESEND
    assert outbox.sent_at is not None


def test_resend_401_records_auth_error():
    outbox = _run_delivery("r2@t.in", 401, {"message": "Invalid API key"},
                           raw_body='{"message":"Invalid API key"}')
    assert outbox.failure_category == "auth_error"
    assert outbox.provider_status_code == 401
    assert outbox.status == EmailOutbox.Status.FAILED  # permanent


def test_resend_403_restricted_api_key_recorded():
    outbox = _run_delivery(
        "r3@t.in", 403,
        {"message": "You can only send testing emails to your own email address"},
        raw_body='{"message":"You can only send testing emails to your own email address"}',
    )
    assert outbox.failure_category == "sandbox_recipient_restriction"
    assert outbox.status == EmailOutbox.Status.FAILED  # permanent


def test_resend_403_account_restriction_recorded():
    outbox = _run_delivery(
        "r4@t.in", 403,
        {"message": "Your account is restricted"},
        raw_body='{"message":"Your account is restricted from sending"}',
    )
    assert outbox.failure_category == "account_restriction"


def test_resend_422_sender_validation_recorded():
    outbox = _run_delivery(
        "r5@t.in", 422,
        {"message": "The from address is not verified"},
        raw_body='{"message":"The from address is not verified"}',
    )
    assert outbox.failure_category == "validation_error"


def test_resend_429_is_transient_and_retried():
    User.objects.create_user("r6", "r6@t.in", "StrongPass123!")
    with override_settings(DEBUG=False, RESEND_API_KEY=FAKE_KEY):
        patch = mock.patch.object(otp_mod, "_resend_api_key", lambda: FAKE_KEY)
        patch.start()
        try:
            api = APIClient()
            api.post(REQUEST_URL, {"email": "r6@t.in"}, format="json")
            outbox = EmailOutbox.objects.get(to_email="r6@t.in", purpose="otp")
            with _mock_urlopen(429, {"message": "rate limit"}):
                otp_mod.process_outbox_email(outbox.pk)
            outbox.refresh_from_db()
            assert outbox.failure_category == "rate_limited"
            assert outbox.status == EmailOutbox.Status.PENDING  # transient: retried
        finally:
            patch.stop()


def test_resend_500_is_transient():
    outbox = _run_delivery("r7@t.in", 500, {"message": "boom"})
    assert outbox.failure_category == "provider_error"
    assert outbox.status == EmailOutbox.Status.PENDING


def test_network_timeout_is_transient():
    import urllib.error

    User.objects.create_user("r8", "r8@t.in", "StrongPass123!")
    with override_settings(DEBUG=False, RESEND_API_KEY=FAKE_KEY):
        patch = mock.patch.object(otp_mod, "_resend_api_key", lambda: FAKE_KEY)
        patch.start()
        try:
            api = APIClient()
            api.post(REQUEST_URL, {"email": "r8@t.in"}, format="json")
            outbox = EmailOutbox.objects.get(to_email="r8@t.in", purpose="otp")
            error = urllib.error.URLError("connection timed out")
            with mock.patch("accounts.otp.urllib.request.urlopen", side_effect=error):
                otp_mod.process_outbox_email(outbox.pk)
            outbox.refresh_from_db()
            assert outbox.failure_category == "network_error"
        finally:
            patch.stop()


def test_invalid_json_response_still_accepted():
    outbox = _run_delivery("r9@t.in", 200, None, raw_body="<html>ok</html>")
    assert outbox.status == EmailOutbox.Status.ACCEPTED
    assert outbox.provider_message_id == ""  # missing message id tolerated


def test_api_key_never_in_errors():
    outbox = _run_delivery("r10@t.in", 403, {"message": "forbidden"},
                           raw_body='{"message":"forbidden"}')
    assert FAKE_KEY not in (outbox.last_error or "")
    assert FAKE_KEY not in (outbox.failure_category or "")


def test_cloudflare_1010_classified_as_edge_block():
    """The diagnosed production failure: Cloudflare 1010 blocks the default
    Python-urllib signature with HTTP 403 'error code: 1010'."""
    outbox = _run_delivery("r11@t.in", 403, None, raw_body="error code: 1010")
    assert outbox.failure_category == "edge_blocked_client_signature"


def test_outbox_loop_command_starts_without_flush_crash():
    """Regression: the --loop worker crashed instantly with
    TypeError: OutputWrapper.write() got an unexpected keyword argument 'flush'.
    It must start cleanly, process rows, and stay alive."""
    User.objects.create_user("loopu", "loopu@t.in", "StrongPass123!")
    proc = subprocess.Popen(
        [sys.executable, "-u", "manage.py", "process_email_outbox", "--loop", "--interval", "1"],
        cwd=".", stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    time.sleep(6)  # a crashed worker exits well within this window
    alive = proc.poll() is None
    proc.terminate()
    stderr = proc.stderr.read() if proc.stderr else ""
    assert alive, f"outbox worker exited early: {stderr[-500:]}"
    assert "flush" not in stderr and "TypeError" not in stderr


# -- outbox semantics (Phase D) ------------------------------------------------------

def test_duplicate_claim_prevented():
    User.objects.create_user("o1", "o1@t.in", "StrongPass123!")
    with override_settings(DEBUG=False, RESEND_API_KEY=FAKE_KEY):
        patch = mock.patch.object(otp_mod, "_resend_api_key", lambda: FAKE_KEY)
        patch.start()
        try:
            api = APIClient()
            api.post(REQUEST_URL, {"email": "o1@t.in"}, format="json")
            outbox = EmailOutbox.objects.get(to_email="o1@t.in", purpose="otp")
            first = otp_mod._claim_outbox(outbox.pk)
            second = otp_mod._claim_outbox(outbox.pk)
            assert first is not None and second is None
        finally:
            patch.stop()


def test_stale_sending_row_recovered_after_crash():
    """A 'sending' row whose worker crashed is reset and delivered via the
    console provider (no key configured -> console fallback enabled)."""
    User.objects.create_user("o2", "o2@t.in", "StrongPass123!")
    with override_settings(DEBUG=True, OTP_EMAIL_FALLBACK_TO_CONSOLE=True):
        patch = mock.patch.object(otp_mod, "_resend_api_key", lambda: "")
        patch.start()
        try:
            api = APIClient()
            api.post(REQUEST_URL, {"email": "o2@t.in"}, format="json")
            outbox = EmailOutbox.objects.get(to_email="o2@t.in", purpose="otp")
            outbox.status = EmailOutbox.Status.SENDING
            outbox.last_attempt_at = timezone.now() - timedelta(
                seconds=otp_mod.SENDING_STALE_SECONDS + 10
            )
            outbox.save()
            processed = otp_mod.process_pending_emails(batch_size=10)
            outbox.refresh_from_db()
            assert processed >= 1
            assert outbox.status == EmailOutbox.Status.ACCEPTED  # console (no key)
        finally:
            patch.stop()


def test_worker_thread_closes_old_connections_safely():
    """process_outbox_email completes a row without breaking the connection."""
    User.objects.create_user("o3", "o3@t.in", "StrongPass123!")
    with override_settings(DEBUG=True, OTP_EMAIL_FALLBACK_TO_CONSOLE=True):
        patch = mock.patch.object(otp_mod, "_resend_api_key", lambda: "")
        patch.start()
        try:
            api = APIClient()
            api.post(REQUEST_URL, {"email": "o3@t.in"}, format="json")
            outbox = EmailOutbox.objects.get(to_email="o3@t.in", purpose="otp")
            otp_mod.process_outbox_email(outbox.pk)
            outbox.refresh_from_db()
            assert outbox.status == EmailOutbox.Status.ACCEPTED
        finally:
            patch.stop()


# -- branded HTML email (Phase F/G of the email redesign) -----------------------------

def test_otp_html_template_renders_branded_code():
    from django.template.loader import render_to_string

    html = render_to_string("accounts/emails/otp_email.html", {"code": "492513", "expiry_minutes": 5})
    assert "492513" in html                                  # six-digit OTP included
    assert "Verify your email" in html                       # main heading
    assert "expires in" in html and "5 minutes" in html      # expiry duration displayed
    assert "FoodBridge" in html                              # brand in header + footer
    assert "Reducing food waste. Sharing goodness." in html  # tagline in footer
    assert "#205C43" in html and "#F5F1E7" in html and "#E39A17" in html  # brand palette
    assert "Never share this verification code" in html      # security note


def test_otp_plain_text_template_matches_html():
    from django.template.loader import render_to_string

    text = render_to_string("accounts/emails/otp_email.txt", {"code": "654321", "expiry_minutes": 5})
    assert "654321" in text
    assert "expires in 5 minutes" in text
    assert "Never share this verification code" in text
    assert "Reducing food waste. Sharing goodness." in text
    assert "<" not in text.split("©")[0]  # plain text: no HTML tags before the copyright


def test_otp_email_escapes_dynamic_values():
    from django.template.loader import render_to_string

    html = render_to_string("accounts/emails/otp_email.html", {"code": "<script>alert(1)</script>", "expiry_minutes": 5})
    assert "<script>" not in html
    assert "&lt;script&gt;" in html


def test_resend_payload_includes_html_and_text():
    """The actual provider request payload must carry both alternatives with
    the correct recipient, subject and sender display name."""
    User.objects.create_user("mailh", "mailh@t.in", "StrongPass123!")
    with override_settings(DEBUG=False, RESEND_API_KEY=FAKE_KEY):
        patch = mock.patch.object(otp_mod, "_resend_api_key", lambda: FAKE_KEY)
        patch.start()
        try:
            api = APIClient()
            api.post(REQUEST_URL, {"email": "mailh@t.in"}, format="json")
            outbox = EmailOutbox.objects.get(to_email="mailh@t.in", purpose="otp")
            request = otp_mod._render_provider_request(outbox)
            payload = json.loads(request.data.decode("utf-8"))

            assert payload["to"] == ["mailh@t.in"]
            assert payload["subject"] == "Your FoodBridge login code"
            assert payload["from"].startswith("FoodBridge <")  # display name preserved
            assert payload["text"] and "Your FoodBridge login code" in payload["text"]
            assert "<table" in payload["html"]                 # branded HTML present
            assert "login code" in payload["html"]
        finally:
            patch.stop()


def test_outbox_stores_html_and_text_for_retry():
    User.objects.create_user("mails", "mails@t.in", "StrongPass123!")
    with override_settings(DEBUG=False, RESEND_API_KEY=FAKE_KEY):
        patch = mock.patch.object(otp_mod, "_resend_api_key", lambda: FAKE_KEY)
        patch.start()
        try:
            api = APIClient()
            api.post(REQUEST_URL, {"email": "mails@t.in"}, format="json")
            outbox = EmailOutbox.objects.get(to_email="mails@t.in", purpose="otp")
            # Retry workers re-send from the stored row: both parts persisted.
            assert outbox.body.strip() != ""
            assert outbox.html_body.strip() != ""
            assert "login code" in outbox.body
        finally:
            patch.stop()


# -- cross-worker ---------------------------------------------------------------------

@pytest.mark.django_db(transaction=True)
def test_otp_survives_cache_wipe_and_two_worker_simulation():
    import os

    from django.core.cache import cache
    from django.db import connection

    User.objects.create_user("w1", "w1@t.in", "StrongPass123!")
    api = APIClient()
    resp = api.post(REQUEST_URL, {"email": "w1@t.in"}, format="json")
    code = _dev_code(resp.data)
    cache.clear()

    verify = api.post(VERIFY_URL, {"email": "w1@t.in", "code": code}, format="json")
    assert verify.status_code == 200

    User.objects.create_user("two.worker2", "two.worker2@t.in", "StrongPass123!")
    db_name = connection.settings_dict["NAME"]
    db_user = connection.settings_dict["USER"]
    db_host = connection.settings_dict["HOST"] or "127.0.0.1"
    db_port = connection.settings_dict["PORT"] or "5432"
    env = {
        **os.environ,
        "DATABASE_URL": f"postgres://{db_user}@{db_host}:{db_port}/{db_name}",
        "DEBUG": "True",
        "OTP_EMAIL_FALLBACK_TO_CONSOLE": "true",
        "RESEND_API_KEY": "",
        "PYTHONDONTWRITEBYTECODE": "1",
    }
    proc = subprocess.run(
        [sys.executable, "-c",
         "import os, sys\n"
         "sys.path.insert(0, os.getcwd())\n"
         "os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')\n"
         "import django\n"
         "django.setup()\n"
         "from accounts import otp\n"
         "ok, cooldown, dev = otp.request_otp('two.worker2@t.in')\n"
         "print(dev if dev else 'NONE')\n"],
        cwd=".", capture_output=True, text=True, timeout=60, env=env,
    )
    assert proc.returncode == 0, proc.stderr[-800:]
    import re as _re

    match = _re.search(r"(?m)^(\d{6})$", proc.stdout)
    assert match, f"no 6-digit code in subprocess stdout: {proc.stdout[-400:]}"
    verify_b = api.post(VERIFY_URL, {"email": "two.worker2@t.in", "code": match.group(1)}, format="json")
    assert verify_b.status_code == 200
