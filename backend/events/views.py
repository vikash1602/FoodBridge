"""SSE stream backed by the Event table.

Protocol:
- Clients POST /api/v1/stream/ticket/ (authenticated) to get a short-lived,
  SINGLE-USE stream ticket — safer than a long-lived JWT in the URL, which
  proxies and history can retain. (Browser EventSource cannot set headers.)
- Connect to /api/v1/stream/?ticket=…: on connect we replay anything newer than
  `Last-Event-ID` (or the last 30s) so reconnects never miss events.
- Then we poll the Event table every 2s for rows addressed to the caller
  (audience 'all', 'user:<id>' or 'role:<name>'), with a ping every ~16s.

Implemented as a plain Django view (NOT DRF APIView) on purpose: DRF content
negotiation answers EventSource's `Accept: text/event-stream` with HTTP 406.
Auth is resolved manually (ticket or Bearer header); ORM calls in the async
body run through sync_to_async so the event loop never blocks.
"""

import asyncio
import json
import secrets

from asgiref.sync import sync_to_async
from django.conf import settings
from django.core.cache import cache
from django.http import HttpRequest, HttpResponse, StreamingHttpResponse
from django.utils import timezone
from django.views import View
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError

from .models import Event

POLL_INTERVAL_SECONDS = 2.0
REPLAY_WINDOW = timezone.timedelta(seconds=30)
HEARTBEAT_EVERY_N_POLLS = 8  # ~16s

TICKET_PREFIX = "fb-sse-ticket:"


def _consume_ticket(ticket: str) -> int | None:
    """Single-use ticket -> user_id. Second read always misses."""
    key = TICKET_PREFIX + ticket
    user_id = cache.get(key)
    if user_id is not None:
        cache.delete(key)
    try:
        return int(user_id)
    except (TypeError, ValueError):
        return None


class StreamTicketView(APIView):
    """POST /api/v1/stream/ticket/ — issue a 60-second single-use stream ticket."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        ticket = secrets.token_urlsafe(24)
        cache.set(TICKET_PREFIX + ticket, request.user.id, settings.SSE_TICKET_TTL_SECONDS)
        return Response({"ticket": ticket, "expires_in": settings.SSE_TICKET_TTL_SECONDS})


def _initial_last_id(request: HttpRequest) -> int:
    """Reconnect support: honour Last-Event-ID header, else ?last_event_id, else replay the recent window."""
    raw = request.headers.get("Last-Event-ID") or request.GET.get("last_event_id")
    if raw:
        try:
            return max(0, int(raw))
        except (TypeError, ValueError):
            pass
    cutoff = timezone.now() - REPLAY_WINDOW
    ids = list(Event.objects.filter(created_at__gte=cutoff).order_by("id").values_list("id", flat=True))
    return ids[-1] if ids else 0


def _audiences_for_user(user) -> tuple:
    return ("all", f"user:{user.id}", f"role:{user.role}")


def _resolve_audiences(request: HttpRequest) -> tuple:
    """Sync context (plain Django view thread) — plain ORM access is legal here."""
    from accounts.models import User
    from rest_framework_simplejwt.authentication import JWTAuthentication
    from rest_framework_simplejwt.exceptions import InvalidToken, TokenError

    # 1) Bearer header (fetch-based clients).
    header = request.headers.get("Authorization", "")
    if header.startswith("Bearer "):
        try:
            authenticator = JWTAuthentication()
            token = authenticator.get_validated_token(header[7:].strip())
            target = authenticator.get_user(token)
            if target is not None and target.is_active:
                return _audiences_for_user(target)
        except (InvalidToken, TokenError, AuthenticationFailed):
            pass

    # 2) Single-use stream ticket (browser EventSource).
    ticket = request.GET.get("ticket")
    if ticket:
        user_id = _consume_ticket(ticket)
        if user_id is not None:
            target = User.objects.filter(id=user_id, is_active=True).first()
            if target is not None:
                return _audiences_for_user(target)

    return ("all",)


@sync_to_async
def _fetch_events(last_id: int, audiences: tuple) -> list:
    """ORM access runs in the sync executor — required under ASGI."""
    return list(Event.objects.filter(id__gt=last_id, audience__in=audiences).order_by("id"))


def _sse_frame(event: Event) -> str:
    return (
        f"id: {event.id}\n"
        f"event: {event.type}\n"
        f"data: {json.dumps({'type': event.type, 'payload': event.payload, 'created_at': event.created_at.isoformat()})}\n\n"
    )


class SSEStreamView(View):
    """GET /api/v1/stream/ — text/event-stream, auth via ticket or Bearer."""

    def get(self, request: HttpRequest, *args, **kwargs) -> HttpResponse:
        audiences = _resolve_audiences(request)
        last_id = _initial_last_id(request)
        max_lifetime = settings.SSE_MAX_LIFETIME_SECONDS

        async def stream():
            nonlocal last_id
            started_at = timezone.now()
            polls = 0
            # Replay backlog immediately, then tail the table.
            for event in await _fetch_events(last_id, audiences):
                last_id = event.id
                yield _sse_frame(event)
            yield ": connected\n\n"
            while True:
                await asyncio.sleep(POLL_INTERVAL_SECONDS)
                polls += 1
                for event in await _fetch_events(last_id, audiences):
                    last_id = event.id
                    yield _sse_frame(event)
                if polls % HEARTBEAT_EVERY_N_POLLS == 0:
                    yield f": ping {int(timezone.now().timestamp())}\n\n"
                if max_lifetime and (timezone.now() - started_at).total_seconds() > max_lifetime:
                    # Ask the browser to reconnect (EventSource does this automatically).
                    yield "event: reconnect\ndata: {}\n\n"
                    return

        response = StreamingHttpResponse(stream(), content_type="text/event-stream")
        response.headers["Cache-Control"] = "no-cache"
        response.headers["X-Accel-Buffering"] = "no"
        return response
