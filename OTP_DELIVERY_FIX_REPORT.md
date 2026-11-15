# OTP Delivery Fix Report

*FoodBridge — Resend/OTP email delivery repair. All claims below are separated into Implemented / Automated-test verified / Real-provider verified / Real-Gmail verified / External configuration required. No delivery result is fabricated.*

---

## 1. Original failure

`send_test_email --to vikashvnb2005@gmail.com --wait --real` produced:
`status=pending provider=resend message_id=- failure=auth_error error=provider HTTP 403`
and Gmail never received the OTP. The Resend dashboard showed key usage **zero** — no request had ever authenticated.

## 2. Actual reason for HTTP 403 (captured live)

The 403 body was **`error code: 1010`** — a **Cloudflare edge block**, not a Resend API error. Resend's API sits behind Cloudflare, which rejected the default Python-urllib client signature (`Python-urllib/3.x`) before the request reached Resend's auth layer. Proven by a controlled A/B probe against the live API:

| Client | Result |
| --- | --- |
| urllib default User-Agent | `403` — `error code: 1010` (Cloudflare block) |
| `User-Agent: FoodBridge-Backend/1.0` | `200` — `{"id": "01a1d068-ce44-7181-8964-ffd093901140"}` |

The API key was valid all along; key usage was zero because no request ever got past the edge. Secondary issue: the code never read the HTTPError response body, so this diagnosis was impossible from the outbox alone.

## 3. Files modified

- `backend/accounts/otp.py` — recovered from a truncated working-tree state (IndentationError at line 96), then rebuilt: User-Agent fix, full HTTPError body capture + classification, `transaction.on_commit` scheduling, `close_old_connections` in worker threads, stale-`sending` recovery, permanent-vs-transient retry policy, Resend `Idempotency-Key` support, dev_code gating.
- `backend/accounts/models.py` + migration `accounts/0005_...` — `EmailOutbox.provider_status_code` field (HTTP status preserved), expanded failure categories.
- `backend/accounts/management/commands/process_email_outbox.py` — verified: no `flush` kwarg, loop mode, interval validation.
- `backend/accounts/management/commands/send_test_email.py` — reports outbox id, provider, status, message id, HTTP status, sanitized error; distinguishes console fallback from real delivery.
- `backend/config/settings.py` — `CRON_SECRET_KEY`, env-overridable `AUTH_THROTTLE_RATE`, `cron` throttle scope.
- `backend/config/cron_views.py` + `config/urls.py` + `config/test_cron.py` — HMAC/shared-secret cron endpoints (JWT auth bypass fixed).
- `frontend/src/pages/Login.tsx` — corrected delivery status mapping.
- `backend/accounts/test_otp.py` — rewritten for the new semantics (24 tests).
- `scripts/start_foodbridge.ps1` / `stop_foodbridge.ps1` — local reliability fixes.

## 4. OTP fallback changes

- **Configured Resend key → Resend is used and `dev_code` is `None` unconditionally** (DEBUG included). Previously DEBUG=True exposed the code via the API even with a provider configured.
- **No key**: console delivery requires `DEBUG=True` **and** `OTP_EMAIL_FALLBACK_TO_CONSOLE=true`. If the fallback is disabled, the outbox row is marked `failed` / `configuration_error` — no success is claimed.

## 5. HTTP error handling changes

- `HTTPError.read()` captures the provider response body; JSON `message` extracted; sanitized to 220 chars; HTTP status persisted in `EmailOutbox.provider_status_code`.
- `_classify_provider_error()` derives the category from the actual body: `auth_error`, `restricted_api_key`, `domain_not_authorized`, `sandbox_recipient_restriction`, `account_restriction`, `validation_error`, `rate_limited`, `provider_error`, `network_error`, `edge_blocked_client_signature` (Cloudflare 1010).
- API key and Authorization header never appear in stored errors or logs.

## 6. Outbox & transaction improvements

- `EmailOutbox` rows created synchronously (pending) in the request path; delivery scheduled via **`transaction.on_commit`** — the worker never races an uncommitted row.
- `close_old_connections()` at worker start/end keeps DB connections healthy across requests.
- Atomic claiming (`pending → sending` filtered update) prevents duplicate delivery across workers; Resend `Idempotency-Key: otp-<rowid>` prevents double-send on provider retries.
- Rows stuck in `sending` longer than 120 s are treated as worker-crash losses and reset to pending.

## 7. Retry logic

- **Permanent categories** (`auth_error`, `restricted_api_key`, `domain_not_authorized`, `sandbox_recipient_restriction`, `account_restriction`, `validation_error`, `configuration_error`) → `failed` immediately; never auto-retried.
- **Transient categories** (`rate_limited`, `network_error`, `provider_error`) → `pending`, retried by `process_email_outbox` with bounded exponential backoff (30 s × 2^attempts, max 5 attempts).

## 8. Frontend status corrections

Login screen states now map honestly to the outbox: *Preparing your verification email…* (queued) → *Your email provider accepted the message. Check your inbox and spam folder.* (accepted) → *Your verification email is still being processed.* (sending/pending) → *We couldn't send your verification email. Please try again.* (failed) → *Development mode: the code was printed to the server console (no email sent).* (console provider). The OTP itself is never shown in the browser when Resend is configured.

## 9. Backend test results

**113 passed / 0 failed** (real PostgreSQL, ~6.7 min), including the full previous regression (50-thread claim concurrency: 1 × 201 / 49 × 409 / 1 row; privacy fuzzing; SSE; storage/image) plus the new suites: **24 OTP/outbox tests** and 7 cron-endpoint security tests.

## 10. Frontend test results

TypeScript strict ✓ · ESLint 0 problems ✓ · Vite production build ✓ · Playwright **16/16** (full rescue lifecycle, double-claim 409 race, 6 LocationPicker checks, 3 dashboard-alignment viewports, attribution, map resize, mobile list/map switch, photo upload/render, OTP status line, production page measurements).

## 11. Real Resend test outcome — **REAL-PROVIDER VERIFIED**

`send_test_email --to vikashvnb2005@gmail.com --wait --real` after the User-Agent fix:

```
Outcome: status=accepted provider=resend
         message_id=01a1d08f-1f65-7310-b040-1f250f670170
```

Persisted in `accounts_emailoutbox`: `status=accepted, provider=resend, provider_status_code=200, provider_message_id=01a1d068.../01a1d08f...`. The key was valid throughout; the 403 was purely the Cloudflare edge blocking the client signature.

## 12. Gmail delivery outcome — user verification pending

Provider acceptance is **verified** (HTTP 200 + message id). The OTP email was dispatched to `vikashvnb2005@gmail.com`; **check Inbox and Spam**. A subsequent login attempt with a freshly requested code re-confirms the whole loop. Final "delivered to Gmail" confirmation requires the user to observe the message — the system now records everything needed (message id, accepted state) to correlate with the Resend dashboard.

## 13. Required external configuration (user actions)

1. Resend sandbox: while unverified, Resend delivers **only to the account owner's email** (`vikashvnb2005@gmail.com` — the account creator — is allowed, so OTP login for that address works today).
2. For arbitrary recipients: verify a sending domain in Resend (add DNS SPF/DKIM records shown in the dashboard), then set `OTP_EMAIL_FROM=FoodBridge <otp@your-domain>` in `.env`.
3. Optional production cron: set `CRON_SECRET_KEY` (32+ chars) and register the two cron endpoints with cron-job.org (see DEPLOYMENT.md §6).

## 14. Remaining limitations

- Resend sandbox restriction (own-address only) until a domain is verified — external, not bypassable.
- No webhook integration for Resend "delivered" events — delivery *to Gmail* is inferred from provider acceptance + the user's inbox, not a provider delivery event. (Resend paid tier adds webhooks.)
- `EmailOutbox.body` stores the rendered message (contains the OTP) as the retry mechanism's requirement; at-rest encryption is a documented follow-up.

## Acceptance criteria status

| # | Criterion | Status |
| --- | --- | --- |
| 1 | otp.py compiles | ✅ |
| 2 | System checks pass | ✅ |
| 3 | Existing auth works | ✅ (full suite) |
| 4 | No OTP exposure with Resend configured | ✅ (test-verified) |
| 5 | Meaningful HTTP error diagnostics | ✅ (test-verified incl. live 403 capture) |
| 6 | Real Resend request succeeds | ✅ **REAL-PROVIDER VERIFIED** |
| 7 | Provider message ID recorded | ✅ **REAL-PROVIDER VERIFIED** |
| 8 | Gmail receives the OTP | ⏳ dispatched — user checks inbox/spam |
| 9 | OTP verification → valid JWT | ✅ (test + live verified) |
| 10 | Regression green | ✅ 113/113 backend, frontend clean, 16/16 Playwright |
