# FoodBridge — Zero-Cost Staging Deployment Guide

Target: **$0/month within providers' published free allowances.** No paid plans, no trials-as-permanent, no auto-upgrades, **no payment method attached anywhere**. Free tiers have limits — the audit table below states each and what happens when it is exhausted (graceful suspension/degradation, never an invoice). **This guide prepares the repository; deployment itself is manual.**

## Architecture

| Component | Provider (free tier) | Notes |
| --- | --- | --- |
| Frontend (React/Vite SPA) | **Vercel Hobby** | `*.vercel.app` domain, SPA rewrites via `frontend/vercel.json` |
| Backend (Django 5 + Uvicorn) | **Render Free Web Service** | 512 MB RAM, 1 worker, spins down after ~15 min idle (cold start ~50 s) |
| PostgreSQL 16 | **Neon Free** | ~1 GB database storage, 100 CU-hrs/month, always available (no 30-day expiry) |
| Photo storage | **Neon Object Storage** (included with Neon Free) | 5 GB per project, S3-compatible (SigV4, path-style), private bucket + presigned GETs |
| Email (OTP) | **Resend Free** | 3,000 emails/mo, 100/day; sandbox delivers only to the account owner |
| Scheduled jobs | **cron-job.org Free** | Two secure HTTP endpoints (shared-secret Bearer) |

Explicitly **not** used: Render paid Cron jobs (paid feature — replaced by cron-job.org), a second always-on Render worker (would push the shared 750 instance-hours past the limit — see §2), Cloudflare R2 (replaced by Neon Object Storage), Render PostgreSQL (expires after 30 days on free), any custom domain.

Repository artifacts prepared for this stack: **`render.yaml`** (Render Blueprint — web service only, free plan, `sync:false` secrets) and **`frontend/vercel.json`** (SPA rewrite + security headers).

---

## 1. Neon — PostgreSQL **and** photo storage

1. Create an account at neon.tech → **New project** (free plan; pick region `aws-us-east-2` or the nearest available).
2. **Database**: copy the **pooled** connection string (`…-pooler…/neondb?sslmode=require`) → this is `DATABASE_URL` at runtime. For the one-off migration use the **direct** (non-pooler) string: pooled connections route through PgBouncer, which interferes with `select_for_update` in rare contention; Django migrations connect directly.
3. **Object Storage** (per the Neon docs, *Storage* section):
   - Buckets are created per project/branch; each branch gets an isolated namespace (free plan: **5 GB per project**).
   - Create a bucket (e.g. `foodbridge-media`) — it is **private by default** (public access block managed by Neon).
   - Create a **storage credential** scoped `storage:write` (Console → Connect → Storage, or Settings → Credentials). Neon maps it to S3 keys directly: `token_id` → Access Key ID (`nak_live_…`), `s3_secret_access_key` → Secret Access Key (`nsk_live_…`). **No AWS account, no IAM, no payment method.**
   - The S3 endpoint is branch-specific: `https://<branch-id>.storage.c-1.us-east-2.aws.neon.tech`, region `us-east-2`.

**Compatibility with the existing django-storages/boto3 abstraction — verified against Neon's S3-compatibility documentation:**

| Required workflow | Neon support | How this repo uses it |
| --- | --- | --- |
| Private bucket | ✅ private by default; public access block managed | no ACL parameters are sent |
| Upload (PutObject) | ✅ (Content-Type/Disposition/Cache-Control/meta supported) | listing photo upload via the existing API path |
| Download/signing | ✅ **presigned GET/PUT, SigV4 only**, expiry via `X-Amz-Expires` | `querystring_auth: true` → short-lived signed read URLs |
| Delete | ✅ DeleteObject (soft-deletes on the branch) | Django storage delete on listing removal |
| Image URL generation | ✅ presigned GETs point at the Neon endpoint | `custom_domain` stays **unset** (required) |
| EXIF removal | ✅ unaffected — Pillow re-encodes **before** upload (server-side) | `validate_and_strip_exif` (existing tests cover it) |
| Upload persistence | ✅ objects persist on the branch; branch-aware copy-on-write | — |
| Addressing | ⚠️ **path-style only** (virtual-hosted unsupported) | selection code sets `addressing_style: "path"` automatically when an endpoint URL is present |
| ACL writes | ⚠️ `PutObjectAcl`/`PutBucketPolicy` return **501** | selection code sends **no ACL parameter** to S3-compatible endpoints (`AWS_S3_DEFAULT_ACL` can override) |

Verdict: **compatible — no feature of the existing photo workflow is blocked.** One code adaptation was required and is implemented + tested (see §7): path-style addressing and empty ACL for S3-compatible endpoints; AWS defaults unchanged.

Environment variables (backend web service):

| Variable | Value |
| --- | --- |
| `AWS_STORAGE_BUCKET_NAME` | your Neon bucket name |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Neon storage credential (`storage:write` scope) |
| `AWS_S3_REGION_NAME` | `us-east-2` (match the project region) |
| `AWS_S3_ENDPOINT_URL` | the branch-specific endpoint from the console |
| `AWS_S3_QUERYSTRING_AUTH` | `true` (default) — private bucket, signed reads |

Also set in `backend/.env.example` (documented) and selectable per-deployment via `AWS_S3_DEFAULT_ACL` / `AWS_S3_ADDRESSING_STYLE` if a provider ever needs different behavior.

## 2. Render backend (Free Web Service)

1. Render Dashboard → **New → Blueprint** → connect the repository → Render reads **`render.yaml`** (web service, free plan, `backend/` root). Or create manually: New → Web Service, root directory `backend`.
2. Build command (from `render.yaml`) runs migrations **explicitly against the direct Neon connection** — Render Free has no Shell and no one-off jobs, so migrations run in the build:

   ```
   pip install -r requirements.txt
   if [ -z "$MIGRATION_DATABASE_URL" ]; then
     echo "ERROR: MIGRATION_DATABASE_URL is not set (Neon DIRECT connection string, e.g. postgresql://…/neondb?sslmode=require)."
     exit 1
   fi
   DATABASE_URL="$MIGRATION_DATABASE_URL" python manage.py migrate --no-input
   ```

   The guard fails the build loudly if `MIGRATION_DATABASE_URL` is missing — migrations can never silently run through PgBouncer.
3. Start command: `python -m uvicorn config.asgi:application --host 0.0.0.0 --port $PORT --workers 1 --timeout-keep-alive 75`. Uvicorn has **no `--threads` flag** (verified against the installed Uvicorn 0.54.0 — that option belongs to Gunicorn); concurrency comes from the async event loop. **One worker**: 512 MB RAM, Django+Uvicorn ≈150–250 MB, SSE adds per-connection buffers. The async SSE view does not block request handling (verified: API < 200 ms with 20 concurrent SSE streams).
4. Health check path: `/api/v1/config/` (public, no auth).
5. Environment variables: fill the `sync:false` entries from `render.yaml` in the dashboard — `SECRET_KEY`, `DATABASE_URL` (Neon **pooled**, runtime), `MIGRATION_DATABASE_URL` (Neon **direct**, migrations), `CORS_ALLOWED_ORIGINS` + `FRONTEND_URL` (both `https://<project>.vercel.app`), `RESEND_API_KEY`, `CRON_SECRET_KEY` (32+ chars), and the four Neon-storage variables from §1. `DEBUG=False`, `ALLOWED_HOSTS=.onrender.com` are pre-set in the blueprint. Append `?sslmode=require` to both Neon URLs if the console string omits it.
6. **First production administrator — create it from the LOCAL Django environment connected to Neon** (Render Free has no Shell/one-off jobs). Run this one-off from your local machine, in the backend venv, with the **DIRECT** (non-pooler) connection string — never the pooled one:

   **PowerShell (your local shell):**
   ```powershell
   $env:DATABASE_URL = "<Neon DIRECT connection string>"
   python manage.py migrate --no-input
   python manage.py createsuperuser        # prompts for email/password securely
   Remove-Item Env:DATABASE_URL
   ```

   <details><summary>cmd.exe alternative</summary>

   ```bat
   set DATABASE_URL=postgresql://<user>:<password>@<ep-…>/neondb?sslmode=require
   python manage.py migrate --no-input
   python manage.py createsuperuser
   set DATABASE_URL=
   ```
   </details>

   Handling the credential: paste the connection string **only into the terminal session** — never into source files, screenshots, chat or committed `.env` files. `Remove-Item Env:DATABASE_URL` (PowerShell) / `set DATABASE_URL=` (cmd) clears it from the session when you're done, so everyday local development goes back to the local database.

   `createsuperuser` (Django's built-in) creates an admin with `role=admin` via this project's custom user model — verify with `python manage.py shell -c "from django.contrib.auth import get_user_model; print(get_user_model().objects.filter(is_superuser=True).values('email','role'))"`. **Never run `seed_demo` against production** — it creates 16 demo accounts with a shared password and demo listings.
7. **Instance-hours math (why there is no second worker in the blueprint):** the free 750 instance-hours/month are shared across all free services. The web service sleeps after ~15 min idle — with hourly cron pings and light staging use it consumes well under 400 h/month. An always-on outbox worker would add ~720 h and can exceed the allowance → Render **suspends** services (no charge, but downtime). Default: web service only; the optional worker exists commented-out in `render.yaml` for teams that accept the trade-off. Render Cron Jobs are a **paid** feature — not used.

**SSE on the free instance.** Spin-down after 15 min idle; cold start ~50 s. The SPA keeps a 10 s polling fallback and reconnects automatically, so notifications may pause but never break. Do not add keep-alive traffic to fake activity — the poll fallback is the honest answer.

## 3. Vercel frontend (Hobby)

1. Vercel → **Add New → Project** → import the repository. Framework preset: Vite.
2. Root directory: `frontend`. Build command: `npm run build`. Output directory: `dist` (auto-detected; also encoded in `frontend/vercel.json` semantics).
3. Environment variable: `VITE_API_URL=https://<service>.onrender.com` (no trailing slash).
4. SPA routing: `frontend/vercel.json` already rewrites all paths to `/index.html` and adds `X-Content-Type-Options`/`Referrer-Policy` headers.
5. The free `*.vercel.app` domain is used — **no domain purchase**.
6. **Hobby eligibility**: Vercel's Hobby plan is for personal, non-commercial use. FoodBridge staging is a personal/portfolio project — eligible. Do not attach a payment method; Vercel will not ask for one on Hobby.
7. CORS: the backend's `CORS_ALLOWED_ORIGINS` must list the exact Vercel domain (step 2.5).

## 4. Resend email

1. Create the API key → `RESEND_API_KEY` (free plan: 3,000 emails/month, 100/day).
2. **Limitation (documented honestly):** without a verified sending domain, Resend's sandbox sender `onboarding@resend.dev` delivers **only to the Resend account owner's own email address** — in this deployment that is the owner (`vikashvnb2005@gmail.com`), so owner logins receive real OTP emails. **New users with other Gmail addresses will NOT receive OTP emails** until a domain is verified (DNS records + `OTP_EMAIL_FROM` on that domain — a change that must not be auto-purchased; domain verification itself is free but requires owning a domain). **Password authentication remains fully available for everyone**; the login screen states the delivery outcome from the outbox instead of pretending.
3. `OTP_EMAIL_FROM=FoodBridge <onboarding@resend.dev>` (default in `render.yaml`).
4. Immediate post-commit delivery is unchanged: the request path never blocks on the mail server; a worker/cron sweep only retries failures (up to 5 attempts).
5. Smoke test after deploying: `python manage.py send_test_email --to vikashvnb2005@gmail.com --wait --real` → expect an accepted event + message id in the Resend dashboard and the message in the inbox.

## 5. cron-job.org (free)

The same two secured endpoints as before (POST-only, shared-secret Bearer **or** per-run HMAC, 10/min rate limit, closed until `CRON_SECRET_KEY` is set):

| Endpoint | Operation | Schedule for staging |
| --- | --- | --- |
| `POST /api/v1/cron/expire-listings/` | materialize expired listings + no-show penalties | hourly |
| `POST /api/v1/cron/process-email-outbox/` | recover failed/retrying OTP outbox messages | hourly |

Setup:
1. `python -c "import secrets; print(secrets.token_urlsafe(32))"` → set as `CRON_SECRET_KEY` on Render.
2. cron-job.org → Create cronjob → URL `https://<service>.onrender.com/api/v1/cron/expire-listings/`, POST, hourly, headers `Authorization: Bearer <secret>`. Repeat for `process-email-outbox/`.
3. Each call also **wakes the sleeping Render service** (that is a feature here: hourly maintenance keeps expiry materialized even while the app sleeps).
4. Previously verified in this environment: both endpoints returned 200 with `{"operation": …, "result": …}` and 403 on wrong/missing secret (`config/test_cron.py`, 7 tests). HMAC mode exists but cron-job.org cannot sign per run — shared-secret mode is used.

## 6. Free-tier audit ($0/month)

| Provider | Free allowance | Limit that bites first | Exhaustion behavior | Charge risk |
| --- | --- | --- | --- | --- |
| Vercel Hobby | 100 GB bandwidth/mo, unlimited static requests, 100 builds/mo (est.) | Build count | Deploys pause until next month | None (no card on file) |
| Render Web Service | 750 instance-hrs/mo shared, 512 MB RAM, 5 GB egress/mo | Spin-down after 15 min idle; hours | Service suspends until next month | None |
| Neon | ~1 GB DB storage, 100 CU-hrs/mo, 5 GB Object Storage, **5 GB/mo public network transfer** | CU-hours (compute) or the transfer allowance | Per Neon's documented over-limit behavior: **compute is suspended until the next billing period** and queries fail with a Neon over-quota error — this affects the API **and** presigned photo URLs (storage is served through Neon). Data is retained. No overage charges; verify the current wording on the Neon plans page at deployment time. | None |
| Neon Object Storage | 5 GB per project, 5 GiB per upload, SigV4 | Storage size; `503 SlowDown` under heavy load | Writes/reads error until space frees or load drops | None |
| Resend | 3,000 emails/mo, 100/day | 100/day | API rejects; outbox retries 5× then marks failed; UI reports honestly | None |
| cron-job.org | Unlimited jobs (1/min min interval) | — | Skipped executions logged | None |

**The 5 GB/month public network transfer is shared across PostgreSQL, Object Storage and Functions** — database queries, photo uploads/downloads (each photo view is a presigned fetch through Neon) and any Neon Functions usage all draw from the same pool. At staging scale (a handful of testers, small photos) this is far from binding; the practical mitigation is that photo views are presigned single-object fetches, not proxied downloads, so transfer per photo view equals the photo size.

Expected staging usage (a handful of testers): well inside every allowance. **$0/month.** No billing method is attached anywhere; exceeding a quota degrades service instead of billing. Do not simulate traffic to keep Render awake — spin-down is accepted behavior.

## 7. Code adaptation for Neon Object Storage (implemented)

`backend/config/storage.py::default_storage_config` now distinguishes two shapes:

- **AWS S3** (no endpoint URL): unchanged — virtual-hosted addressing, `default_acl: "private"`.
- **S3-compatible endpoints** (Neon, MinIO…): `addressing_style: "path"` is set automatically, `default_acl` is **not sent** (Neon returns 501 for ACL writes; buckets are private by default), `custom_domain` stays unset so presigned URLs hit the Neon endpoint.

Covered by tests in `backend/listings/storage_tests.py`: `test_neon_object_storage_config_selected_when_endpoint_set`, `test_acl_override_still_possible_via_env`, plus the pre-existing AWS-selection, local-fallback and end-to-end photo-upload tests (upload → EXIF strip → presigned read path).

## 8. Deployment verification checklist

| # | Check | Status |
| --- | --- | --- |
| 1 | Local startup (`scripts\start_foodbridge.ps1`) | VERIFIED (this environment) |
| 2 | OTP pipeline (outbox → provider → verify → JWT) | VERIFIED (real Resend 200 + message id, earlier round) |
| 3 | Backend production start (`DEBUG=False`, Uvicorn) | VERIFIED locally; **Render runtime NOT VERIFIED (manual step)** |
| 4 | Neon migration (`migrate` against Neon URL) | NOT VERIFIED — requires the Neon account (manual; runs in the Render build via `MIGRATION_DATABASE_URL`) |
| 4b | **Neon claim concurrency** — the 50-thread race result from local PostgreSQL is **not** production verification. Once the Neon project exists, run the same test against the real runtime. **PowerShell:** `$env:DATABASE_URL = "<Neon DIRECT connection string>"` → `python -m pytest claims/test_concurrency.py -q` → `Remove-Item Env:DATABASE_URL`. bash equivalent: `DATABASE_URL="<Neon DIRECT connection string>" python -m pytest claims/test_concurrency.py -q`. Expect the documented 1 × 201 / 49 × 409 / 1 claim row. Record the outcome here before trusting staging under load. | PENDING — manual, after Neon project creation |
| 5 | Neon Object Storage end-to-end (upload → presigned read → delete) | Selection logic VERIFIED by tests against documented Neon behavior; **live bucket NOT VERIFIED (manual step)** |
| 6 | Frontend production build + `vercel.json` rewrites | VERIFIED (build); Vercel deploy NOT VERIFIED (manual step) |
| 7 | Auth (password + OTP + JWT), claim concurrency (50 threads, 1×201/49×409), SSE + polling fallback | VERIFIED (test suites) |
| 8 | cron endpoints with secret (200/403) | VERIFIED locally; cron-job.org setup NOT VERIFIED (external) |

## 9. Manual deployment order

1. Neon: create project → save pooled + direct connection strings → create bucket + storage credential.
2. Render: New → Blueprint → this repo → fill `sync:false` env vars (including `MIGRATION_DATABASE_URL` = direct string) → deploy. **The build already runs `migrate` against `MIGRATION_DATABASE_URL`** — no separate manual migration is needed. Re-run one manually (from the local PowerShell, §2.6 style) **only** if the build's migration step failed, or later when a new migration needs applying outside an auto-deploy.
3. Vercel: import repo → root `frontend` → set `VITE_API_URL` → deploy.
4. Render env: set `CORS_ALLOWED_ORIGINS`/`FRONTEND_URL` to the Vercel URL → redeploy.
5. cron-job.org: create the two hourly jobs with the Bearer secret.
6. Verify: open the Vercel URL → password login as an approved donor → post a listing **with a photo** → open the photo (presigned URL) → log in as the owner via OTP (email arrives at the Resend account owner) → claim → verify pickup → deliver.

## 10. Migration of existing data (optional)

Local demo data → Neon: `pg_dump --format=custom foodbridge` → `pg_restore` against the **direct** Neon string, **before** the first `migrate` against Neon. Rotate demo passwords (`DemoPass123!`) after any public exposure. Existing photo files (local `media/`) would need a manual copy into the Neon bucket if they must survive the move.
