"""HTTP triggers for scheduled maintenance tasks (cron-job.org free tier).

Security model (no arbitrary command execution; each endpoint is one fixed op):
- POST only — anything else returns 405.
- Two accepted credential modes, both compared in constant time:
  1. Shared secret: `Authorization: Bearer <CRON_SECRET_KEY>` — the mode for
     static-header schedulers such as cron-job.org. The key must be 32+ random
     characters; it never appears in logs or responses.
  2. HMAC (for schedulers that can sign per run): `X-Cron-Signature` =
     hex(HMAC_SHA256(secret, "<epoch-ts>\n<operation>")) with `X-Cron-Timestamp`.
     Signatures older than 5 minutes are rejected (replay protection).
- Rate limited via the "cron" throttle scope.
- Results are logged without secrets; failures return 403 with no detail
  beyond "invalid cron credentials".
"""

import hashlib
import hmac
import time

from django.conf import settings
from django.core.management import call_command
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from accounts import otp

SIGNATURE_MAX_AGE_SECONDS = 300


class CronPermission:
    """HMAC or shared-secret credential check."""

    message = "Invalid cron credentials."

    def has_permission(self, request, view) -> bool:
        secret = getattr(settings, "CRON_SECRET_KEY", "")
        if not secret or len(secret) < 32:
            return False  # no strong secret configured -> endpoints stay closed

        # Mode 1: shared secret (cron-job.org static headers).
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer ") and hmac.compare_digest(auth[7:].strip(), secret):
            return True

        # Mode 2: HMAC over (timestamp, operation) for signing schedulers.
        signature = request.headers.get("X-Cron-Signature", "")
        timestamp = request.headers.get("X-Cron-Timestamp", "")
        operation = getattr(view, "cron_operation", "")
        if signature and timestamp and operation:
            try:
                age = abs(time.time() - float(timestamp))
            except (TypeError, ValueError):
                return False
            if age <= SIGNATURE_MAX_AGE_SECONDS:
                expected = hmac.new(
                    secret.encode(), f"{timestamp}\n{operation}".encode(), hashlib.sha256
                ).hexdigest()
                if hmac.compare_digest(expected, signature):
                    return True
        return False


def _cron_response(operation: str, result: str) -> Response:
    # No secrets in logs or body: only the operation name and its count-style result.
    print(f"[cron] {operation}: {result}", flush=True)
    return Response({"operation": operation, "result": result})


class CronExpireListingsView(APIView):
    """POST /api/v1/cron/expire-listings/ -- materialize expired listings and
    settle no-show claims (the cron replacement for `expire_listings`)."""

    cron_operation = "expire-listings"
    # No JWT/Session authenticators: the Bearer header carries the cron shared
    # secret, which JWTAuthentication would otherwise reject with 401 before
    # CronPermission can evaluate it.
    authentication_classes = []
    permission_classes = [CronPermission]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "cron"

    def post(self, request):
        call_command("expire_listings")
        return _cron_response(self.cron_operation, "completed")


class CronProcessOutboxView(APIView):
    """POST /api/v1/cron/process-email-outbox/ -- retry pending/failed emails
    in the durable outbox (batch of 25)."""

    cron_operation = "process-email-outbox"
    authentication_classes = []
    permission_classes = [CronPermission]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "cron"

    def post(self, request):
        processed = otp.process_pending_emails(batch_size=25)
        return _cron_response(self.cron_operation, f"processed={processed}")
