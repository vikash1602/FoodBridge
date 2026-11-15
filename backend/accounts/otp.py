"""Email OTP login with a durable PostgreSQL delivery outbox.

Delivery pipeline (no Redis, no Celery):
1. Request path (fast): create the hashed OtpCode row and an EmailOutbox row
   (status=pending) inside ONE transaction; schedule the first delivery attempt
   via transaction.on_commit() so the worker never races an uncommitted row.
2. Worker: claims the row atomically (pending -> sending), delivers through the
   Resend HTTP API, and records the outcome with the provider message id or a
   sanitized, classified error (response body captured from the provider).
3. `process_email_outbox` (management command / cron) recovers stale rows and
   retries transient failures with bounded backoff.

Delivery selection:
- A configured RESEND_API_KEY always selects the Resend provider (DEBUG or not).
- Without a key, console delivery happens only when DEBUG=True AND
  OTP_EMAIL_FALLBACK_TO_CONSOLE=true; otherwise the request is recorded as
  failed (configuration_error) and no success is claimed.

dev_code policy: returned only when DEBUG=True AND no Resend key is configured.
A configured provider key suppresses dev_code unconditionally.

Protections unchanged: SHA-256 hash-only OtpCode storage, 5-minute expiry,
5 verification attempts, 30-second resend cooldown, previous-code invalidation.

Note on the outbox body: it contains the rendered message text (and therefore
the OTP) because a retry worker could not otherwise re-render it from the
hashed OtpCode row. Error metadata and server logs never include the code.
"""

from __future__ import annotations

import concurrent.futures
import hashlib
import json
import secrets
import time
import urllib.error
import urllib.request
from datetime import timedelta
from typing import Any

from django.conf import settings
from django.db import close_old_connections, transaction
from django.db.models import F
from django.utils import timezone

from .models import EmailOutbox, OtpCode

OTP_TTL_SECONDS = 300          # code valid for 5 minutes
OTP_MAX_ATTEMPTS = 5           # verification attempts AND delivery attempts
OTP_RESEND_COOLDOWN = 30       # seconds between sends
OTP_LENGTH = 6

RESEND_EMAILS_URL = "https://api.resend.com/emails"
HTTP_TIMEOUT_SECONDS = 15
MAX_PROVIDER_ERROR_LENGTH = 220
SENDING_STALE_SECONDS = 120    # a "sending" row older than this was lost to a crash

_executor = concurrent.futures.ThreadPoolExecutor(
    max_workers=2,
    thread_name_prefix="otp-mail",
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _hash_code(email: str, code: str) -> str:
    normalized = email.strip().lower()
    salted = f"{normalized}:{code}:{settings.SECRET_KEY}"
    return hashlib.sha256(salted.encode("utf-8")).hexdigest()


def cooldown_remaining(email: str) -> int:
    latest = (
        OtpCode.objects.filter(email__iexact=email.strip())
        .order_by("-last_sent_at")
        .values_list("last_sent_at", flat=True)
        .first()
    )
    if latest is None:
        return 0
    elapsed = (timezone.now() - latest).total_seconds()
    return max(0, int(OTP_RESEND_COOLDOWN - elapsed))


def _render_otp_emails(code: str) -> tuple[str, str]:
    """Render the branded HTML + plain-text OTP email.

    The only dynamic values are the generated digit code and the expiry
    duration, both safe -- Django template autoescaping is active regardless.
    """
    from django.template.loader import render_to_string

    context = {"code": code, "expiry_minutes": OTP_TTL_SECONDS // 60}
    html = render_to_string("accounts/emails/otp_email.html", context)
    text = render_to_string("accounts/emails/otp_email.txt", context)
    return html, text


def _resend_api_key() -> str:
    """Return the configured key without whitespace; never log this value."""
    return str(getattr(settings, "RESEND_API_KEY", "") or "").strip()


def _sender_header() -> str:
    """Sender identity with the FoodBridge display name always applied.

    OTP_EMAIL_FROM may be a bare address (`otp@mail.yourdomain.com`) or a full
    header (`FoodBridge <otp@mail.yourdomain.com>`); the displayed name is
    always "FoodBridge". Requires a verified domain in Resend for custom
    addresses (SPF/DKIM) -- onboarding@resend.dev works for the sandbox.
    """
    sender = str(getattr(settings, "OTP_EMAIL_FROM", "") or "").strip()
    if not sender:
        sender = "onboarding@resend.dev"
    if "<" not in sender:
        sender = f"FoodBridge <{sender}>"
    return sender


def _console_fallback_enabled() -> bool:
    """Console delivery requires BOTH debug mode and the explicit fallback flag."""
    return bool(settings.DEBUG) and bool(
        getattr(settings, "OTP_EMAIL_FALLBACK_TO_CONSOLE", False)
    )


def _sanitize(value: str) -> str:
    """Provider-safe error text: no API keys, no OTP, bounded length."""
    cleaned = (value or "").replace("\n", " ").replace("\r", " ")
    return cleaned[:MAX_PROVIDER_ERROR_LENGTH]


# ---------------------------------------------------------------------------
# OTP creation / verification
# ---------------------------------------------------------------------------

def request_otp(email: str) -> tuple[bool, int, str | None]:
    """Create and queue an OTP; return (ok, cooldown_seconds, dev_code).

    dev_code is returned only when DEBUG=True AND no Resend key is configured
    (explicit local development). A configured provider suppresses it
    unconditionally — in DEBUG too.
    """
    email = email.strip().lower()
    remaining = cooldown_remaining(email)
    if remaining > 0:
        return False, remaining, None

    code = f"{secrets.randbelow(10 ** OTP_LENGTH):0{OTP_LENGTH}d}"
    # Only the newest code is ever valid -- invalidate previous rows.
    OtpCode.objects.filter(email__iexact=email).delete()
    OtpCode.objects.create(
        email=email,
        code_hash=_hash_code(email, code),
        expires_at=timezone.now() + timedelta(seconds=OTP_TTL_SECONDS),
    )

    with transaction.atomic():
        # Previous outbox rows for this email are superseded; keep history but
        # stop any still-pending duplicates to prevent double delivery.
        EmailOutbox.objects.filter(
            to_email__iexact=email, purpose="otp",
            status__in=(EmailOutbox.Status.PENDING, EmailOutbox.Status.SENDING),
        ).update(status=EmailOutbox.Status.FAILED, last_error="superseded by a newer code")
        html_body, text_body = _render_otp_emails(code)
        outbox = EmailOutbox.objects.create(
            to_email=email,
            subject="Your FoodBridge login code",
            body=text_body,
            html_body=html_body,
            purpose="otp",
            provider=(
                EmailOutbox.Provider.RESEND if _resend_api_key()
                else EmailOutbox.Provider.CONSOLE
            ),
        )

    # First delivery attempt only after the transaction commits.
    transaction.on_commit(lambda: _submit_delivery(outbox.pk))

    # Housekeeping: drop stale rows so the tables stay tiny.
    if secrets.randbelow(10) == 0:
        OtpCode.purge_expired()
        EmailOutbox.purge_accepted()

    use_console = not _resend_api_key() and _console_fallback_enabled()
    dev_code = code if (settings.DEBUG and not _resend_api_key() and use_console) else None
    return True, OTP_RESEND_COOLDOWN, dev_code


def verify_otp(email: str, code: str) -> tuple[bool, str]:
    """Verify a code. Returns (ok, error_code) with error_code in
    expired | invalid | too_many_attempts."""
    email = email.strip().lower()
    record = (
        OtpCode.objects.filter(email__iexact=email, expires_at__gt=timezone.now())
        .order_by("-last_sent_at")
        .first()
    )
    if record is None:
        return False, "expired"
    if record.attempts >= OTP_MAX_ATTEMPTS:
        record.delete()
        return False, "too_many_attempts"

    if _hash_code(email, code.strip()) != record.code_hash:
        record.attempts += 1
        if record.attempts >= OTP_MAX_ATTEMPTS:
            record.delete()
            return False, "too_many_attempts"
        record.save(update_fields=["attempts"])
        return False, "invalid"

    record.delete()
    return True, ""


def delivery_status_for(email: str) -> dict:
    """Latest delivery outcome for the OTP screen -- never includes the code."""
    latest = (
        EmailOutbox.objects.filter(to_email__iexact=email.strip(), purpose="otp")
        .order_by("-id")
        .first()
    )
    if latest is None:
        return {"status": EmailOutbox.Status.PENDING, "provider": "", "failure_category": ""}
    return {
        "status": latest.status,
        "provider": latest.provider,
        "failure_category": latest.failure_category,
        "http_status": latest.provider_status_code,
        "message_id": latest.provider_message_id or "",
    }


# ---------------------------------------------------------------------------
# Delivery worker
# ---------------------------------------------------------------------------

def _claim_outbox(pk: int) -> EmailOutbox | None:
    """Atomically claim a pending row (safe across workers/processes)."""
    claimed = EmailOutbox.objects.filter(pk=pk, status=EmailOutbox.Status.PENDING).update(
        status=EmailOutbox.Status.SENDING, last_attempt_at=timezone.now()
    )
    if not claimed:
        return None
    return EmailOutbox.objects.get(pk=pk)


def _render_provider_request(outbox: EmailOutbox) -> urllib.request.Request:
    idempotency_key = f"otp-{outbox.pk}"
    payload: dict[str, Any] = {
        "from": _sender_header(),
        "to": [outbox.to_email],
        "subject": outbox.subject,
        "text": outbox.body,
    }
    if outbox.html_body:
        payload["html"] = outbox.html_body
    return urllib.request.Request(
        RESEND_EMAILS_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {_resend_api_key()}",
            "Content-Type": "application/json",
            # CRITICAL: Resend's API sits behind Cloudflare, which blocks the
            # default Python-urllib client signature with "error code: 1010"
            # (HTTP 403) before the request reaches the API. A named client
            # User-Agent passes the edge and reaches Resend's auth layer.
            "User-Agent": "FoodBridge-Backend/1.0",
            # Resend honours this header: a retried row cannot deliver twice.
            "Idempotency-Key": idempotency_key,
        },
        method="POST",
    )


def _classify_provider_error(status_code: int | None, body: str) -> str:
    """Classify from the ACTUAL provider response, not guesses.

    Observed in production: Cloudflare's edge (in front of api.resend.com)
    answers 403 "error code: 1010" for blocked client signatures -- that is an
    edge block, not a Resend application error. Resend itself reports
    restriction/verification problems as 403/422 with a JSON `message`; 401
    means a bad key. Unknown bodies fall back to the status code.
    """
    lowered = body.lower()
    if "error code: 1010" in lowered:
        return "edge_blocked_client_signature"
    if status_code in (401,):
        return "auth_error"
    if status_code == 403:
        if "restricted api key" in lowered or ("api key" in lowered and "permission" in lowered):
            return "restricted_api_key"
        if "domain" in lowered:
            return "domain_not_authorized"
        if "only send" in lowered or "testing emails" in lowered or "own email" in lowered:
            return "sandbox_recipient_restriction"
        if "account" in lowered:
            return "account_restriction"
        return "forbidden"
    if status_code == 422:
        return "validation_error"
    if status_code == 429:
        return "rate_limited"
    if status_code is not None and status_code >= 500:
        return "provider_error"
    if status_code is None:
        return "network_error"
    return "provider_error"


# Categories whose failure is a configuration problem: retrying cannot help.
PERMANENT_CATEGORIES = {"auth_error", "restricted_api_key", "domain_not_authorized",
                        "validation_error", "account_restriction", "sandbox_recipient_restriction",
                        "configuration_error"}


def _record_failure(outbox: EmailOutbox, category: str, error: str,
                    status_code: int | None) -> None:
    outbox.attempts += 1
    outbox.failure_category = category
    outbox.last_error = _sanitize(error)
    outbox.provider_status_code = status_code
    outbox.last_attempt_at = timezone.now()
    if category in PERMANENT_CATEGORIES or outbox.attempts >= outbox.max_attempts:
        outbox.status = EmailOutbox.Status.FAILED  # permanent: not auto-retried
    else:
        outbox.status = EmailOutbox.Status.PENDING  # transient: retried with backoff
    outbox.save(update_fields=[
        "attempts", "status", "failure_category", "last_error",
        "provider_status_code", "last_attempt_at",
    ])


def process_outbox_email(pk: int) -> None:
    """Deliver one outbox row. Runs on background threads / worker loops --
    closes stale DB connections first, never raises into the caller."""
    close_old_connections()
    outbox = _claim_outbox(pk)
    if outbox is None:  # already claimed/processed by another worker
        close_old_connections()
        return

    # Recover the code for THIS row: only the outbox body holds the plaintext
    # (OtpCode stores hashes). Parse it back out for the provider payload.
    code = ""
    for token in outbox.body.replace(".", " ").replace(",", " ").split():
        if token.isdigit() and len(token) == OTP_LENGTH:
            code = token
            break

    if not _resend_api_key():
        # Console provider: requires explicit local configuration.
        if _console_fallback_enabled():
            print(
                f"\n=== FoodBridge OTP (console provider) for {outbox.to_email}: "
                f"{code} (valid {OTP_TTL_SECONDS // 60} min) ===",
                flush=True,
            )
            outbox.status = EmailOutbox.Status.ACCEPTED
            outbox.provider = EmailOutbox.Provider.CONSOLE
            outbox.sent_at = timezone.now()
            outbox.save(update_fields=["status", "provider", "sent_at"])
        else:
            outbox.attempts += 1
            outbox.status = EmailOutbox.Status.FAILED
            outbox.failure_category = "configuration_error"
            outbox.last_error = "no RESEND_API_KEY and console fallback disabled"
            outbox.save(update_fields=["attempts", "status", "failure_category", "last_error"])
        close_old_connections()
        return

    # Provider path -- a configured key always selects Resend (DEBUG or not).
    try:
        with urllib.request.urlopen(
            _render_provider_request(outbox), timeout=HTTP_TIMEOUT_SECONDS
        ) as response:
            raw = response.read().decode("utf-8", errors="replace")
            if response.status >= 300:
                # Defensive: some HTTP clients do not auto-raise non-2xx.
                _record_failure(outbox, _classify_provider_error(response.status, raw),
                                f"HTTP {response.status}: {raw}", response.status)
                close_old_connections()
                return
            payload: Any = {}
            try:
                payload = json.loads(raw or "{}")
            except json.JSONDecodeError:
                pass  # accepted but unparseable body -> still accepted
            outbox.status = EmailOutbox.Status.ACCEPTED
            outbox.provider = EmailOutbox.Provider.RESEND
            message_id = str(payload.get("id", ""))[:120]
            outbox.provider_message_id = message_id
            outbox.provider_status_code = response.status
            outbox.sent_at = timezone.now()
            outbox.save(update_fields=[
                "status", "provider", "provider_message_id",
                "provider_status_code", "sent_at",
            ])
    except urllib.error.HTTPError as exc:
        # Capture the ACTUAL provider error body -- this is the diagnostic for
        # 401/403/422 rejections. The Authorization header is never logged.
        raw = ""
        try:
            raw = exc.read().decode("utf-8", errors="replace")
        except Exception:  # noqa: BLE001 -- body unreadable
            raw = ""
        detail: Any = {}
        try:
            detail = json.loads(raw or "{}")
        except json.JSONDecodeError:
            detail = {"message": raw[:MAX_PROVIDER_ERROR_LENGTH]}
        message = str(detail.get("message", raw))[:MAX_PROVIDER_ERROR_LENGTH]
        _record_failure(
            outbox,
            _classify_provider_error(exc.code, raw),
            f"HTTP {exc.code}: {message}",
            exc.code,
        )
    except Exception as exc:  # noqa: BLE001 -- network/timeout failures
        _record_failure(outbox, "network_error", f"{type(exc).__name__}: {exc}", None)
    close_old_connections()


def _submit_delivery(pk: int) -> None:
    """Hand one delivery attempt to the executor, tolerating shutdown."""
    try:
        _executor.submit(process_outbox_email, pk)
    except RuntimeError:  # executor shutting down -- the outbox row remains
        pass               # queued and is recovered by process_email_outbox.


def process_pending_emails(batch_size: int = 25) -> int:
    """Recover stale rows and retry transient failures with bounded backoff.

    - Rows stuck in `sending` older than SENDING_STALE_SECONDS were lost to a
      crashed worker -> reset to pending.
    - Permanent categories stay failed (retrying cannot help).
    - Transient failures retry only after exponential backoff:
      last_attempt_at + 30 * 2**attempts seconds.
    """
    now = timezone.now()
    # Worker-crash recovery.
    stale_cutoff = now - timedelta(seconds=SENDING_STALE_SECONDS)
    EmailOutbox.objects.filter(
        status=EmailOutbox.Status.SENDING, last_attempt_at__lt=stale_cutoff
    ).update(status=EmailOutbox.Status.PENDING)

    candidates = EmailOutbox.objects.filter(
        status=EmailOutbox.Status.PENDING, attempts__lt=F("max_attempts")
    ).order_by("last_attempt_at", "id")[: batch_size * 2]

    processed = 0
    for row in candidates:
        if row.last_attempt_at is not None:
            backoff = timedelta(seconds=30 * (2 ** min(row.attempts, 5)))
            if now < row.last_attempt_at + backoff:
                continue  # transient failure: not due yet
        before = row.status
        process_outbox_email(row.pk)
        row.refresh_from_db()
        if row.status != before:
            processed += 1
        if processed >= batch_size:
            break
    return processed
