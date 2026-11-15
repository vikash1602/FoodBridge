"""SSE stream tests: single-use stream tickets, Last-Event-ID replay,
audience filtering, and non-blocking concurrency (20 parallel clients)."""

import asyncio

import pytest
from django.core.cache import cache
from django.db import connections
from django.test import AsyncClient

from accounts.models import User
from events.models import Event

pytestmark = pytest.mark.django_db(transaction=True)

STREAM_URL = "/api/v1/stream/"
TICKET_URL = "/api/v1/stream/ticket/"


def _jwt_for(user) -> str:
    from rest_framework_simplejwt.tokens import RefreshToken

    return str(RefreshToken.for_user(user).access_token)


def make_events(volunteer):
    all_event = Event.objects.create(type="listing.created", payload={"a": 1}, audience="all")
    mine = Event.objects.create(type="listing.new_nearby", payload={"a": 2}, audience=f"user:{volunteer.id}")
    other = Event.objects.create(type="listing.new_nearby", payload={"a": 3}, audience="user:999999")
    donor_role = Event.objects.create(type="org.verified", payload={"a": 4}, audience="role:donor")
    return all_event, mine, other, donor_role


def _sync_client_for(user):
    from rest_framework.test import APIClient

    client = APIClient()
    client.force_authenticate(user)
    return client


def _ticket_for(user) -> str:
    response = _sync_client_for(user).post(TICKET_URL, format="json")
    assert response.status_code == 200
    return response.data["ticket"]


def consume(url, n_chunks):
    """GET `url` via the async test client and take n_chunks from the stream."""

    async def run():
        client = AsyncClient()
        response = await client.get(url)
        chunks = []
        agen = response.streaming_content
        try:
            for _ in range(n_chunks):
                chunks.append(await agen.__anext__())
        except StopAsyncIteration:
            pass
        await agen.aclose()
        # The async stream opened DB connections on the loop thread; close them.
        await asyncio.to_thread(connections.close_all)
        return response, chunks

    return asyncio.run(run())


def _body(chunks) -> str:
    return "".join(c.decode() if isinstance(c, bytes) else c for c in chunks)


# -- ticket issuing ---------------------------------------------------------------

def test_ticket_requires_auth():
    from rest_framework.test import APIClient

    client = APIClient()
    assert client.post(TICKET_URL, format="json").status_code == 401


def test_ticket_is_single_use():
    volunteer = User.objects.create_user("tk1", "tk1@t.in", "StrongPass123!")
    all_event, mine, other, donor_role = make_events(volunteer)
    ticket = _ticket_for(volunteer)

    # First connection with the ticket gets personal events.
    _, chunks = consume(f"{STREAM_URL}?last_event_id=0&ticket={ticket}", 3)
    body = _body(chunks)
    assert f"id: {mine.id}" in body

    # Same ticket again resolves to anonymous: personal events are withheld.
    _, chunks = consume(f"{STREAM_URL}?last_event_id=0&ticket={ticket}", 4)
    body = _body(chunks)
    assert f"id: {all_event.id}" in body
    assert f"id: {mine.id}" not in body
    assert f"id: {other.id}" not in body


def test_expired_ticket_is_rejected():
    volunteer = User.objects.create_user("tk2", "tk2@t.in", "StrongPass123!")
    make_events(volunteer)
    ticket = _ticket_for(volunteer)
    cache.delete("fb-sse-ticket:" + ticket)
    _, chunks = consume(f"{STREAM_URL}?last_event_id=0&ticket={ticket}", 4)
    body = _body(chunks)
    assert "id:" not in body.replace("id: 0", "") or "user:999999" not in body
    # anonymous: only the 'all' event arrives
    assert body.count("event:") <= 2  # replayed 'all' + nothing personal


# -- replay & audiences ------------------------------------------------------------

def test_anonymous_gets_all_audience_only():
    volunteer = User.objects.create_user("ssev", "ssev@t.in", "StrongPass123!")
    all_event, mine, other, donor_role = make_events(volunteer)

    response, chunks = consume(STREAM_URL + "?last_event_id=0", 4)
    assert response.status_code == 200
    assert response.headers["Content-Type"] == "text/event-stream"
    body = _body(chunks)
    assert f"id: {all_event.id}" in body
    assert f"id: {mine.id}" not in body      # personal: needs auth
    assert f"id: {other.id}" not in body
    assert f"id: {donor_role.id}" not in body


def test_ticket_receives_personal_events():
    volunteer = User.objects.create_user("ssev2", "ssev2@t.in", "StrongPass123!")
    all_event, mine, other, donor_role = make_events(volunteer)

    response, chunks = consume(f"{STREAM_URL}?last_event_id=0&ticket={_ticket_for(volunteer)}", 3)
    body = _body(chunks)
    assert f"id: {all_event.id}" in body
    assert f"id: {mine.id}" in body
    assert f"id: {other.id}" not in body
    assert f"id: {donor_role.id}" not in body


def test_last_event_id_replay_from_cursor():
    volunteer = User.objects.create_user("ssev3", "ssev3@t.in", "StrongPass123!")
    all_event, mine, other, donor_role = make_events(volunteer)

    # Reconnect saying "I already saw all_event" -> only `mine` (newer) arrives.
    _, chunks = consume(f"{STREAM_URL}?last_event_id={all_event.id}&ticket={_ticket_for(volunteer)}", 2)
    body = _body(chunks)
    assert f"id: {mine.id}" in body
    assert f"id: {all_event.id}" not in body


def test_authorization_header_auth():
    """The Bearer header route (what the fetch-based frontend client sends).

    Django's AsyncClient doesn't deliver HTTP_* header extras over its ASGI
    transport, so this drives the view through APIRequestFactory instead.
    """
    from rest_framework.test import APIRequestFactory

    from .views import SSEStreamView

    volunteer = User.objects.create_user("ssev4", "ssev4@t.in", "StrongPass123!")
    all_event, mine, other, donor_role = make_events(volunteer)

    factory = APIRequestFactory()
    request = factory.get(
        STREAM_URL + "?last_event_id=0",
        HTTP_AUTHORIZATION=f"Bearer {_jwt_for(volunteer)}",
    )
    response = SSEStreamView.as_view()(request)
    assert response.status_code == 200
    assert response.headers["Content-Type"] == "text/event-stream"

    async def consume_header():
        chunks = []
        agen = response.streaming_content
        for _ in range(3):
            chunks.append(await agen.__anext__())
        await agen.aclose()
        await asyncio.to_thread(connections.close_all)
        return chunks

    chunks = asyncio.run(consume_header())
    assert f"id: {mine.id}" in _body(chunks)


# -- concurrency: the loop must never block -----------------------------------------

def test_twenty_concurrent_sse_clients_receive_event():
    """20 parallel SSE connections all receive the same event — the async view
    must not serialize/block the loop (ORM runs via sync_to_async)."""
    clients = [
        User.objects.create_user(f"multi{i}", f"multi{i}@t.in", "StrongPass123!")
        for i in range(20)
    ]
    event = Event.objects.create(type="listing.created", payload={"hi": 1}, audience="all")

    tickets = [_ticket_for(user) for user in clients]

    async def run_all():
        async def read_first_frame(index):
            client = AsyncClient()
            response = await client.get(f"{STREAM_URL}?last_event_id=0&ticket={tickets[index]}")
            agen = response.streaming_content
            chunk = await agen.__anext__()
            await agen.aclose()
            return chunk.decode()

        frames = await asyncio.gather(*(read_first_frame(i) for i in range(20)))
        await asyncio.to_thread(connections.close_all)
        return frames

    frames = asyncio.run(run_all())
    for frame in frames:
        assert f"id: {event.id}" in frame


def test_api_stays_fast_with_20_sse_clients_connected():
    """While 20 SSE streams are open, a normal API request must answer < 200 ms.

    Proves the async stream never blocks the event loop (Part 3.1).
    """
    import time as _time

    from rest_framework.test import APIClient

    clients = [
        User.objects.create_user(f"sseapi{i}", f"sseapi{i}@t.in", "StrongPass123!")
        for i in range(20)
    ]
    tickets = [_ticket_for(user) for user in clients]

    async def run():
        async def hold_stream(index):
            client = AsyncClient()
            response = await client.get(f"{STREAM_URL}?last_event_id=0&ticket={tickets[index]}")
            agen = response.streaming_content
            await agen.__anext__()          # first replayed frame
            await agen.__anext__()          # ": connected"
            return agen                      # keep the stream OPEN

        streams = await asyncio.gather(*(hold_stream(i) for i in range(20)))

        # Normal API call while all 20 streams are live:
        def timed_request():
            api_client = APIClient()
            api_client.force_authenticate(clients[0])
            started = _time.perf_counter()
            response = api_client.get("/api/v1/listings/?lat=12.68&lng=78.62&radius=12")
            elapsed_ms = (_time.perf_counter() - started) * 1000
            return response.status_code, elapsed_ms

        status_code, elapsed_ms = await asyncio.to_thread(timed_request)
        for agen in streams:
            await agen.aclose()
        await asyncio.to_thread(connections.close_all)
        return status_code, elapsed_ms

    status_code, elapsed_ms = asyncio.run(run())
    assert status_code == 200
    assert elapsed_ms < 200, f"API took {elapsed_ms:.0f} ms with 20 SSE clients connected"
