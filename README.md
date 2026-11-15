# 🍲 FoodBridge — a live surplus-food rescue network

**Good food has a countdown. We race it.**

> 📍 **Now live in Vaniyambadi, Tamil Nadu** — and nearby towns (Ambur, Jolarpettai, Tirupattur, Alangayam).
> The whole deployment is city-configurable via env vars (see [Running locally](#running-locally)) — point it at any town.

Restaurants, hostels and caterers throw away good food that spoils within hours, while nearby NGOs and volunteers need it. FoodBridge lets a donor post surplus in 30 seconds, alerts nearby volunteers **live** (SSE), and lets **exactly one** volunteer claim, pick up and deliver it — race-free.

---

## Table of contents

1. [Problem](#problem)
2. [Features](#features)
3. [Architecture](#architecture)
4. [The race-free claim (row locking)](#the-race-free-claim)
5. [Why SSE + an Event table (not Redis)](#why-sse--an-event-table-not-redis)
6. [Why escalation & expiry are computed at query time](#why-escalation--expiry-are-computed-at-query-time)
7. [Trust score](#trust-score)
8. [API map](#api-map)
9. [Project structure](#project-structure)
10. [Running locally](#running-locally)
11. [Testing](#testing) — incl. the 50-thread concurrency test
12. [Deployment (no Docker)](#deployment)
13. [Screenshots](#screenshots)
14. [What I would change at 100x scale](#what-i-would-change-at-100x-scale)

---

## Problem

| Who | Pain today | With FoodBridge |
| --- | --- | --- |
| Donor (restaurant/hostel/caterer) | Surplus goes in the bin at closing time; donating is paperwork | Post in a 3-step wizard (<30 s), cancel/edit anytime while open |
| Volunteer / NGO | Finding surplus is luck + phone calls | Live map feed sorted by urgency × distance, one-tap claim |
| Everyone | No trust, no proof of handoff | 4-digit pickup codes, ratings, trust scores, admin verification |

## Features

- **Auth & onboarding** — JWT login/refresh, role selection (donor / volunteer), profile with map-pin base location and per-user notify radius.
- **Organization verification** — donors register organizations; admins approve/reject; **unverified donors cannot post**.
- **Post a listing** — 3-step wizard (what → quantity & safety → where & when), map pin picker, "safe for 2h/4h/6h" selector, allergens, veg flag, photo.
- **Live nearby feed** — bounding-box prefilter → Haversine distance → ranked by urgency × proximity (trust tie-break). Filters: radius, veg, food type, min quantity. Split list + Leaflet map with urgency-colored plate markers and escalation rings.
- **Race-free claiming** — `select_for_update()` + re-check inside `transaction.atomic()`; losers get a friendly **HTTP 409**. Max 2 active claims per volunteer.
- **Pickup & delivery** — volunteer enters the donor's 4-digit code to verify pickup; deliver with note/photo; stepper progress tracker on both sides; volunteer cancel reopens the listing (small trust penalty).
- **Escalation** — searching radius grows at query time: **2 km (0-20 min) → 5 km (20-40 min) → 10 km (40+ min)**, drawn as animated rings.
- **Expiry** — expired listings never appear as open (query-time check) and `expire_listings` materializes the status + settles no-show penalties (cron).
- **Trust score** — starts at 50, bounded 0-100, badge tiers (New / Reliable / Trusted / Champion), full audit trail in `TrustAdjustment`.
- **Ratings & reports** — one rating per side per claim; reports on listings/users with admin resolution (+ trust penalty when upheld).
- **Notifications** — in-app bell with unread count, toasts on live events, optional browser Notification API alerts for new food within your radius.
- **Impact dashboard & leaderboard** — meals rescued, active volunteers, avg time-to-claim, animated charts, podium with trust badges.
- **Admin console (React)** — verification queue, report queue, user table with suspend/unsuspend.
- **Live everything** — SSE stream (`/api/v1/stream/`) with single-use stream tickets (`POST /stream/ticket/`, 60 s TTL), `Last-Event-ID` reconnect replay, and automatic 10-second polling fallback.
- **City-configurable deployment** — `GET /api/v1/config/` drives map center/zoom, service area, escalation tiers and city name from env alone; **English/தமிழ் toggle** for main labels; Nominatim place search (IN-bounded, debounced, attributed) + reverse geocoding in the pin picker.
- **Location privacy** — public feed/detail coordinates fuzzed ~300 m, street address withheld until someone claims; exact data only for donor / admin / claim-holding volunteer.

## Architecture

```mermaid
flowchart LR
    subgraph Client ["React 18 + TS + Vite (Vercel)"]
        UI[Pages & tickets UI]
        Q[TanStack Query cache]
        ES[EventSource /api/v1/stream/]
        POLL["10s polling fallback"]
    end

    subgraph Server ["Django 5 + DRF (Render, uvicorn worker)"]
        API["ViewSets /api/v1/*"]
        CLAIM["claim: atomic + select_for_update"]
        PUB[publish()]
        SSE["SSEStreamView (async, sync_to_async DB tail)"]
        CRON["expire_listings (cron)"]
        WN[WhiteNoise static]
    end

    DB[(PostgreSQL 16<br/>listings · claims · events<br/>notifications · ratings)]

    UI --> Q --> API
    API --> CLAIM --> DB
    API --> PUB --> DB
    ES --> SSE --> DB
    API --> DB
    CRON --> DB
    ES -. replay from Last-Event-ID .-> DB
    UI -. fallback .-> POLL --> API
```

Data model: `User (AbstractUser + role/trust/base location)`, `Organization`, `Listing`, `Claim` (partial unique: one occupying claim per listing), `Rating`, `Report`, `Notification`, `Event` (SSE source), `TrustAdjustment` (audit).

Composite indexes: `(status, lat, lng)` and `(safe_until)` (+ `(status, safe_until)`).

## The race-free claim

```python
with transaction.atomic():
    listing = Listing.objects.select_for_update().get(pk=pk)   # row lock
    if listing.status != Listing.Status.OPEN or expired: 409
    if volunteer.active_claims >= 2: 409
    claim = Claim.objects.create(listing=listing, volunteer=volunteer)
    listing.status = CLAIMED
```

1. The first request reaches PostgreSQL and takes a **row lock** on the listing.
2. Every other concurrent claim **blocks** on that lock.
3. When each loser's turn comes, it re-reads `status != open` → **409 "Someone just claimed this."**
4. A DB-level partial `UniqueConstraint(status in [active, picked_up, delivered])` is the safety net under the application check.

Proven by `claims/test_concurrency.py`: **50 threads fire simultaneously → exactly 1 × 201, 49 × 409, exactly 1 Claim row.**

## Why SSE + an Event table (not Redis)

- **Zero extra infrastructure** — the constraint list bans Redis/brokers. The `Event` table *is* the pub/sub: producers insert one row; every SSE connection tails `WHERE id > last_seen` using an indexed BigAutoField.
- **Replay for free** — reconnecting clients send `Last-Event-ID`; the stream replays everything they missed. Redis pub/sub is fire-and-forget: a reconnecting client silently loses messages.
- **Auditability** — events are queryable history, useful for debugging and future analytics.
- **Async where it counts** — the stream is an `async` generator under uvicorn; DB polling runs through `sync_to_async` so connections stay healthy. One table poll per 2 s per client is trivially cheap at this scale (indexed range scan).
- The frontend still has a **10 s polling fallback** if SSE fails twice.

## Why escalation & expiry are computed at query time

There is **no scheduler** running against live traffic:

- **Expiry** is `safe_until > now()` inside every feed query — an expired listing can never be served as open, even if cron hasn't run in an hour. The `expire_listings` management command (cron, every 5 min) only *materializes* the status and settles penalties.
- **Escalation** is a SQL `CASE` on `now - created_at` annotated per row — a listing's radius is always correct at read time, identical for every viewer, and needs zero background workers. The same tiers power the animated rings on the map.

## Trust score

Starts at **50**, clamped to **0-100**; every change is recorded in `TrustAdjustment` (user, delta, reason, reference).

| Event | Δ | Who |
| --- | --- | --- |
| Delivery completed | **+8** | volunteer **and** donor |
| 5★ rating received | **+2** | ratee |
| 4★ rating received | **+1** | ratee |
| No-show (never picked up before safe_until) | **−10** | volunteer |
| Cancellation after claiming | **−6** | volunteer |
| Report upheld by admin | **−5** | offender |

Badges: **≥90 Champion 🏆 · ≥75 Trusted ⭐ · ≥60 Reliable 🤝 · else New 🌱**. Feed ranking includes a small trust tie-break (5% weight); leaderboard ties break on trust.

## API map (`/api/v1/`, OpenAPI at `/api/docs/`)

| Area | Endpoints |
| --- | --- |
| Auth | `POST /auth/register/` · `POST /auth/login/` · `POST /auth/refresh/` · `GET|PATCH /auth/me/` |
| Organizations | CRUD + `POST /organizations/{id}/approve/` · `/reject/` (admin) |
| Listings | `GET /listings/` (geo feed: `?lat&lng&radius&veg&type&min_quantity`) · `GET /listings/mine/` · create/edit · `POST /listings/{id}/cancel/` · **`POST /listings/{id}/claim/`** |
| Claims | `GET /claims/` · `POST /claims/{id}/verify-pickup/` · `/deliver/` · `/cancel/` |
| Ratings | `POST /ratings/` (one per rater per claim) |
| Reports | `POST /reports/` · `POST /reports/{id}/resolve/` (admin) |
| Notifications | `GET /notifications/` · `POST /notifications/{id}/read/` · `/read-all/` |
| Stats | `GET /stats/?scope=me|platform` · `?metric=leaderboard` |
| Admin | `GET /admin/users/` · `POST /admin/users/{id}/suspend/` · `/unsuspend/` |
| Live | `GET /stream/` (SSE, `?token=` for EventSource, `Last-Event-ID` replay) |

Throttling: claims `12/min`, listing creation `20/h`, reports `10/h`, auth `20/min`. Errors are always `{"error": {code, message, details}}`.

## Project structure

```
foodbridge/
├── backend/
│   ├── config/          # settings, urls, api_urls, asgi, exceptions, pagination
│   ├── accounts/        # User, Organization, permissions, trust engine, admin API
│   ├── listings/        # Listing, geo services, feed, expire_listings, seed_demo
│   ├── claims/          # Claim, Rating, Report, claim locking, serializers
│   ├── notifications/   # bell store + fan-out
│   ├── events/          # Event table, SSE view, publish()
│   ├── stats/           # impact / platform / leaderboard
│   └── tests (in apps)  # 53 tests incl. concurrency + query-count
├── frontend/
│   └── src/{api,components,hooks,lib,pages}
└── .github/workflows/ci.yml
```

## Running locally

**Prereqs:** Python 3.11+, Node 22+, PostgreSQL 16.

```bash
# 1. Database
psql -U postgres -c "CREATE ROLE foodbridge LOGIN PASSWORD 'foodbridge' CREATEDB;"
psql -U postgres -c "CREATE DATABASE foodbridge OWNER foodbridge;"

# 2. Backend
cd backend
python -m venv .venv && .venv\Scripts\activate      # or source .venv/bin/activate
pip install -r requirements-dev.txt
copy .env.example .env                               # then edit if needed
python manage.py migrate
python manage.py seed_demo                           # Vaniyambadi demo region + accounts below
python manage.py runserver                           # or: uvicorn config.asgi:application --port 8000

# 3. Frontend
cd ../frontend
npm install
npm run dev                                          # http://localhost:5173
```

**Vaniyambadi setup** — the defaults already point the app at Vaniyambadi (center 12.6819 N, 78.6200 E; zoom 13; escalation 3 → 6 → 12 km so Ambur and Jolarpettai corridor listings surface as listings age; service area 25 km; all times IST). To run the same code in another city, set in `backend/.env`:

```env
DEFAULT_CITY_NAME=Hosur
DEFAULT_CENTER_LAT=12.7409
DEFAULT_CENTER_LNG=77.8253
DEFAULT_ZOOM=13
SERVICE_AREA_KM=20
ESCALATION_TIERS=20:3,40:6
ESCALATION_MAX_RADIUS_KM=10
```

…and reseed (`python manage.py seed_demo --force` after clearing data). The frontend reads `GET /api/v1/config/` for all of it — no frontend rebuild needed.

Demo accounts (password `DemoPass123!`): `admin@foodbridge.dev`, donor `rukmini@demo.fb` (Ambur biryani house), volunteer `priya@demo.fb` (Vaniyambadi). All business names in the seed are fictional; town anchors verified against OpenStreetMap.

> Windows note: if Smart App Control blocks the psycopg v3 DLL, Django transparently falls back to `psycopg2-binary` (already in requirements-dev).

## Testing

```bash
cd backend && python -m pytest -q             # 64 tests against real PostgreSQL
cd frontend && npm run lint && npm run build  # strict tsc + eslint (0 warnings)
cd frontend && npx playwright test            # 2 end-to-end flows in a real Chrome
```

Latest full runs on this machine:

```
backend  : 64 passed in 258s
frontend : build ✓ · eslint 0 problems ✓
e2e      : 2 passed (full rescue lifecycle 41s · double-claim 409 race 21s)
```

**The concurrency test** (`claims/test_concurrency.py`, `TransactionTestCase` + `threading.Barrier`): 50 volunteers, 50 simultaneous `POST /listings/{id}/claim/` against real PostgreSQL →

```
assert successes == 1          # exactly one 201
assert conflicts == 49         # 49 × 409
assert Claim.objects.count() == 1
```

**Privacy tests**: public feed/detail coordinates are fuzzed ~120-300 m (deterministic per listing) and `pickup_address` is withheld; exact location goes only to the donor, the admin, and the volunteer holding the occupying claim — verified for the feed, `mine`, detail, and the nested claim payload.

**SSE tests**: single-use stream tickets (reuse/expiry rejected), `Last-Event-ID` replay, audience filtering, and **20 concurrent SSE clients** all receiving the same event over the async view.

Also covered: permission matrices per role, escalation tiers (3/6/12 km), urgency-beats-distance ordering, expiry exclusion (IST-aware), N+1 feed test (`django_assert_num_queries(2)`), expire command penalties, pickup-code masking, double-rating rejection, upheld-report penalties, suspension gating.

## Deployment

**Backend → Render / Railway** (no Docker):

- Build: `pip install -r requirements.txt` · Start: `gunicorn config.asgi:application -k uvicorn.workers.UvicornWorker -w 2 --threads 4` (see `backend/Procfile`)
- Env: `SECRET_KEY`, `DATABASE_URL` (Neon/Supabase Postgres), `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, `FRONTEND_URL`, `DEBUG=False`, plus the city block (`DEFAULT_CITY_NAME`, `DEFAULT_CENTER_LAT/LNG`, `DEFAULT_ZOOM`, `SERVICE_AREA_KM`, `ESCALATION_TIERS`, `ESCALATION_MAX_RADIUS_KM`)
- **Cron job** (Render Cron Job or crontab): `*/5 * * * * python manage.py expire_listings`
- Migrations: `python manage.py migrate` (release command)
- **Photo uploads are ephemeral**: listing/delivery photos and org documents are stored on the instance's local disk (`MEDIA_ROOT`), which Render/Railway wipe on every deploy/restart. This is a documented limitation — for real deployments, swap `STORAGES["default"]` to django-storages + S3/Cloudinary (one setting change; the file fields already use standard storage APIs).
- **One Postgres driver everywhere**: `requirements.txt` ships `psycopg[binary]` (v3). `requirements-dev.txt` additionally carries `psycopg2-binary` only as a Windows dev fallback for machines whose Smart App Control blocks the v3 DLL — Django auto-falls-back. Deployed images never install it, so production runs a single driver.

**Frontend → Vercel / Netlify:**

- Build `npm run build`, output `dist/`, env `VITE_API_URL=https://<your-backend>`; SPA rewrite configured in `frontend/vercel.json`.

## Screenshots

> Placeholders — drop images into `docs/screenshots/`. (All screenshots below were captured from the running app during development; add your own here.)

| Page | File | Shown |
| --- | --- | --- |
| Landing — Vaniyambadi badge + live counters | `docs/screenshots/landing.png` | light + dark, EN/தமிழ் toggle |
| Volunteer feed + map (dark) | `docs/screenshots/feed-map.png` | urgency dials, plate markers, escalation rings |
| Post wizard — map pin picker + Nominatim search | `docs/screenshots/post-wizard.png` | zoom-16 picker, custom safe-hours |
| Listing detail + tracker | `docs/screenshots/listing-detail.png` | progress stepper |
| Donor pickup-code ticket | `docs/screenshots/pickup-code.png` | large-digit code display |
| Delivery confetti | `docs/screenshots/delivered.png` | toast + confetti burst |
| Impact dashboard | `docs/screenshots/impact.png` | animated charts |
| Admin console | `docs/screenshots/admin.png` | verifications / reports / users |
| Mobile bottom dock | `docs/screenshots/mobile.png` | 360 px layout |

## Live demo

When deployed, add links here:

- **Frontend**: `https://<your-app>.vercel.app` — seeded Vaniyambadi region, log in as `priya@demo.fb` / `DemoPass123!` (volunteer) or `rukmini@demo.fb` / `DemoPass123!` (donor)
- **API docs**: `https://<your-backend>.onrender.com/api/docs/` (OpenAPI schema at `/api/schema/`)
- **Admin (Django)**: `https://<your-backend>/admin/` — superuser via `python manage.py createsuperuser`

## What I would change at 100x scale

1. **Spatial index / PostGIS** — swap the bounding-box + Haversine for GiST-indexed geography columns and `KNN` ordering; the Python prefilter becomes unnecessary and feed latency drops with table size.
2. **A real queue (Celery/SQS/RQ)** — notification fan-out, photo processing, email/push dispatch move off the request path; the claim transaction stays lean while workers handle the rest.
3. **A pub/sub layer (Redis Streams / NATS)** — replace per-client DB tailing with broadcast channels; the Event table stays as the durable log, subscribers stream from memory instead of polling rows.
4. **Read replicas + CDN** — the feed is read-mostly: route reads to replicas, serve listing photos and map tiles via CDN, cache hot bbox queries.
5. **Partitioning + TTL** — partition `events_notifications` by month with retention, so the SSE tail index stays small forever.
6. **WebSockets/long-poll hybrid per city shard**, plus a dedicated presence service for "volunteers currently online" targeting.
7. **Observability** — OpenTelemetry traces on claim latency, pgBouncer for connection storms, structured logs for pickup-code failure rates.

---

Built with Django 5 · DRF · SimpleJWT · PostgreSQL 16 · React 18 · TypeScript · Vite · Tailwind · TanStack Query · react-leaflet · Framer Motion · Recharts · SSE. No Docker, no Redis, no Celery — proof that discipline beats infrastructure.
