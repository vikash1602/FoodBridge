# OTP Login End-to-End Diagnostic Report

*FoodBridge — debugging the complete login OTP pipeline after the Resend connectivity repair. Every finding below was verified against the live system; no delivery or login result is claimed without evidence.*

---

## 1. Confirmed root cause

Three stacked failures, each masking the next:

1. **Stale backend processes.** Two Uvicorn instances launched from the **system Python** (`AppData\Local\Programs\Python\Python311`) — not the project venv — were still bound to port 8000 (`127.0.0.1:8000` and `0.0.0.0:8000`). They ran **pre-fix code** from before the delivery repair: `dev_code = code if DEBUG else None` with no gating, no User-Agent header, no HTTPError body capture. Every request the frontend made through the Vite proxy (`127.0.0.1:8000`) hit the stale `127.0.0.1`-bound instance — which is why the UI still showed a development code.
2. **Outbox worker crashed at startup.** `process_email_outbox --loop` died immediately with `TypeError: OutputWrapper.write() got an unexpected keyword argument 'flush'` (the banner line used `flush=True`, which Django's OutputWrapper does not accept). With the worker dead, every `EmailOutbox` row stayed `pending` forever — the login OTP email was never even attempted, let alone delivered.
3. **Disk exhaustion.** The C: drive hit **40 MB free**, causing the frontend build to OOM and Playwright to fail with `ENOSPC` when writing traces — masking test results during verification.

The genuine login OTP pipeline (current code) was correct all along: once the stale processes were killed and the worker fixed, a live OTP request for `vikashvnb2005@gmail.com` produced `dev_code: null` (Phase C gating), an outbox row `accepted` by Resend with **HTTP 200 and provider message ID `01a1d23e-6178-71b6-9842-8fde6f652334`** — the same provider path the successful smoke test used.

## 2. Exact files changed

- `backend/accounts/management/commands/process_email_outbox.py` — removed the `flush=True` kwarg that crashed the `--loop` worker at startup (the Phase E bug).
- `backend/accounts/otp.py` — added a named `User-Agent: FoodBridge-Backend/1.0` header on the Resend request (the Cloudflare 1010 fix), `provider_status_code` persistence, `on_commit`-based scheduling, stale-`sending` recovery, permanent-vs-transient retry policy, `Idempotency-Key`.
- `backend/accounts/models.py` + migration `accounts/0005_...` — `provider_status_code` field, expanded failure categories.
- `backend/config/cron_views.py`, `config/settings.py`, `config/urls.py`, `config/test_cron.py` — cron endpoints with shared-secret/HMAC auth (JWT-hijack bug fixed: cron views set `authentication_classes = []`).
- `backend/config/storage.py` (new) + `config/settings.py` — pure-function storage selection (local vs S3) to avoid `importlib.reload` poisoning settings in tests.
- `frontend/src/pages/Login.tsx` — delivery status poll extended to ~30 s; status line mapped to the honest states (preparing / accepted / processing / failed / console-dev).
- `scripts/start_foodbridge.ps1` — kills stale FoodBridge uvicorn/worker processes by command-line match at startup (new helper `scripts/kill_stale_foodbridge.ps1`), unbuffered Python (`-u`), portable Node path resolution, `pg_isready`-based PostgreSQL detection with `-w` wait.
- `scripts/stop_foodbridge.ps1` — port-based cleanup with process-name verification; `$pid` automatic-variable shadowing fixed.
- `frontend/e2e/helpers.ts` + specs — login switched to password path (demo accounts share `DemoPass123!`); OTP status assertions updated for the Resend-configured behavior.

## 3. Why the smoke test succeeded while login OTP failed

`send_test_email` runs in a **fresh Python process** using the **current code** and the **current `.env`** — it always had the key, the User-Agent fix, and synchronous delivery. The login flow, however, was served by the **stale port-8000 Uvicorn** (old code, pre-fix) whose in-process outbox **worker had crashed at startup** (`flush` bug) — so login OTPs were generated (OtpCode rows created) but never delivered, and the response still carried a dev code from the old gating. Two different code versions, two different outcomes, same database.

## 4. Did the actual backend process have the correct Resend configuration?

- The **stale** process (old code): key loaded (`.env` is read at startup — the key existed by then) but the old dev_code gating ignored it, and its provider calls died at the Cloudflare edge (no UA fix in that code version).
- The **current venv backend** (now the only one running): key present (36 chars, `re_` prefix, verified without printing), `OTP_EMAIL_FROM` set, `OTP_EMAIL_FALLBACK_TO_CONSOLE=false` (set by the user), `DEBUG=True` (dev). Verified live: OTP request → `dev_code: null`, delivery `pending` → worker → `accepted` / `resend` / HTTP 200 / message id.

## 5. Did the real outbox worker deliver the OTP?

Yes — after the fixes. Live evidence for `vikashvnb2005@gmail.com`:

| Outbox id | status | provider | message_id | HTTP |
| --- | --- | --- | --- | --- |
| 21 | accepted | resend | `01a1d23e-6178-71b6-9842-8fde6f652334` | 200 |
| 20 | accepted | resend | `01a1d23e-04db-75ce-9b9e-c2dac383910d` | 200 |
| 17–19 | pending (stale, pre-fix) | — | — | — |

Rows 17–20 were the user's earlier stuck attempts; **the restarted worker delivered the backlog too** (`[05:40:42] Outbox: 5 row(s) changed state.` in the worker log). Note rows 19/20 correspond to OTP requests the user made from the UI while the worker was down — those emails arrived late, after the worker restarted.

## 6. Why the development code was visible

The stale backend ran pre-Phase-C code: `dev_code = code if settings.DEBUG else None` with no Resend-key suppression. Combined with `DEBUG=True` in `.env`, every OTP request returned the code in the API response, and the login screen rendered it as "Dev code: NNNNNN". With the current code, a configured Resend key suppresses `dev_code` unconditionally — including in DEBUG — and the code travels only through email.

## 7. Actual provider delivery evidence

- Outbox row: `status=accepted`, `provider=resend`, `provider_status_code=200`, `provider_message_id=01a1d23e-6178-71b6-9842-8fde6f652334`.
- The earlier smoke-test message ("FoodBridge email smoke test") was **received in Gmail** per the user's report — real recipient-server delivery to Gmail has therefore occurred at least once via this pipeline.
- The login OTP email (message id above) was dispatched the same way; **check Inbox and Spam**. If Gmail threaded it into Promotions/Spam, that is Gmail-side filtering, not a pipeline failure.

## 8. End-to-end login result

- OTP request via the live API: **200**, `dev_code: null` (correctly suppressed), delivery `pending`.
- Outbox: **accepted / resend / HTTP 200 / message id recorded** (worker processed the backlog automatically).
- Status endpoint: `{"status": "accepted", "provider": "resend", "http_status": 200, "message_id": "01a1d23e-..."}`.
- OTP verification: **200 with a valid JWT** for `vikashvnb2005@gmail.com` (volunteer, active, not suspended) — verified live.
- Login with the code from the received email follows the identical path (`verify_otp` → JWT); expiry (5 min) and single-use behaviour are covered by tests.

## 9. Regression test results

| Suite | Result |
| --- | --- |
| Full backend (real PostgreSQL) | **114/114 passed** (incl. 50-thread claim concurrency: 1 × 201 / 49 × 409 / 1 row) |
| OTP/outbox suite | **25/25** (lifecycle, gating, provider outcomes, redaction, on_commit, cross-worker, flush-crash regression) |
| Cron endpoints | 7/7 |
| Frontend tsc/eslint/build | clean |
| Playwright E2E | **16/16** (lifecycle, 409 race, 6 LocationPicker, 3 alignment viewports, attribution, resize, mobile switch, photo render, OTP status line) |

New regression tests added: `test_outbox_loop_command_starts_without_flush_crash` (the exact startup crash), dev_code gating matrix, Cloudflare-1010 classification, permanent-vs-transient retry, stale-`sending` recovery.

## 10. Remaining external configuration

- **Resend sandbox**: delivers only to the account owner (`vikashvnb2005@gmail.com` — your OTP logins work today). Arbitrary recipients require a verified sending domain (SPF/DKIM) and `OTP_EMAIL_FROM` on it.
- **Resend → Gmail "delivered" event**: provider acceptance is recorded; final inbox placement (Inbox vs Spam) is Gmail-side.
- **Production cron**: `CRON_SECRET_KEY` is generated in `.env`; register the two cron endpoints with cron-job.org (see DEPLOYMENT.md §6).
