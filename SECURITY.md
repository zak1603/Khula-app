# Security policy

## Reporting a vulnerability

Please email **security@khula.co.za** (replace with your monitored address before launch) with steps to reproduce.
Do not open public issues for security reports. We aim to acknowledge within 2 business days.

## Security architecture (defence in depth)

| Layer | Control | Where |
|---|---|---|
| Edge | Upstash sliding-window rate limits (auth fails closed), CSRF origin check, nonce CSP, HSTS & security headers | `apps/web/src/middleware.ts`, `next.config.ts` |
| API | Strict Zod schemas (`.strict()` = no mass assignment), per-identity limits, generic auth errors (no enumeration), step-up password check for erasure, MFA (AAL2) for admin erasure | `apps/web/src/app/api/**`, `packages/shared/src/validation` |
| Database | RLS on every table, column-level grants, RPC-only writes for bookings/payments, `SECURITY DEFINER` + `search_path = ''`, deny-by-default function EXECUTE | `supabase/migrations/0200`, `0600` |
| Integrity | Exclusion constraint prevents double-booking; server-side pricing; state machine trigger; idempotency keys | `0100`, `0300` |
| Payments | HMAC-SHA512 over raw body (constant time), idempotent `webhook_events`, API re-verification, amount/currency re-check, auto-refund for closed bookings | `supabase/functions/paystack-webhook` |
| Crypto at rest | Client notes & card tokens encrypted with AES-256 (pgcrypto) using keys generated inside Supabase Vault | `0300`, `0400`, `0600` |
| Mobile | Session tokens AES-encrypted with a Keychain/Keystore key; foreground-only location; Paystack checkout in system browser (no card data in-app) | `apps/mobile/src/lib/supabase.ts` |
| Audit | Append-only, SHA-256 hash-chained `audit_logs`; reads of sensitive notes are logged; `verify_audit_chain()` detects tampering | `0200`, `0500` |
| Supply chain | Dependabot (grouped), CodeQL, gitleaks, npm audit, Semgrep rules, CodeRabbit security checklist gate | `.github/`, `.coderabbit.yaml`, `.semgrep.yml` |

## POPIA

- **Consent** (s11) captured at sign-up with notice version.
- **Minimisation**: mobile operators' base addresses are never public; payout account numbers are never stored (last 4 only); webhook payloads stored only as hashes.
- **Retention** (s14): job-site addresses 90 days, walk-in phones 180 days, webhook events 180 days — enforced nightly by `purge_expired_personal_data()`.
- **Access** (s23): self-service export (`/api/privacy/export`).
- **Deletion** (s24): self-service erasure with password step-up (`/api/privacy/erase`); financial ledger retained pseudonymously for 5 years (Tax Administration Act).
- **Accountability** (s19/s22): tamper-evident audit log; breach response — notify the Information Regulator and affected data subjects as soon as reasonably possible.

## Operational checklist before going live

- [ ] Rotate all keys used in development; set `RATE_LIMIT_PEPPER`, Upstash, Paystack and PayFast secrets in the hosting provider / `supabase secrets set`.
- [ ] Enable Supabase **leaked-password protection**, **MFA** for all admin accounts, and CAPTCHA (Turnstile/hCaptcha) on Auth.
- [ ] Set `PAYSTACK_ENFORCE_IP_ALLOWLIST=true` after confirming forwarded-IP behaviour.
- [ ] Configure Paystack webhook URL: `https://<project>.supabase.co/functions/v1/paystack-webhook`.
- [ ] Confirm `pg_cron` jobs `khula-expire-holds` and `khula-popia-retention` are scheduled (`select * from cron.job`).
- [ ] Appoint and register an Information Officer with the Information Regulator.
- [ ] Run `select * from public.verify_audit_chain();` on a schedule and alert on any row.
