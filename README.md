# Khula 🌱

A secure, multi-industry service marketplace for South Africa — salons, plumbers, locksmiths, tutors, mobile mechanics — with a **web dashboard for businesses** and a **mobile app for clients**, sharing one Supabase backend.

```
khula/
├── apps/
│   ├── web/          Next.js 15 dashboard + BFF API (businesses & staff)
│   └── mobile/       Expo SDK 58 app (clients)
├── packages/
│   └── shared/       Types, Zod validation, money/geo/time helpers, Tailwind preset
├── supabase/
│   ├── migrations/   Schema, RLS, RPCs, payments, POPIA (6 ordered files)
│   ├── functions/    Edge Functions: paystack-webhook/-initialize/-subaccount, payfast-itn
│   └── tests/        Migration + RLS scenario tests (PGlite, no Docker needed)
├── .coderabbit.yaml  AI PR review with security & POPIA gates
└── .github/          CI, CodeQL, Dependabot, PR template
```

## Where each part lives

| Section | Files |
|---|---|
| 1 · Schema & RLS | `supabase/migrations/20261117000100_core_schema.sql` (tables), `…0200_security_rls.sql` (helpers, triggers, policies), `…0300_booking_rpcs.sql`, `…0400_payments.sql`, `…0500_popia_compliance.sql`, `…0600_platform_and_grants.sql` |
| 2.1 CodeRabbit | `.coderabbit.yaml`, `.semgrep.yml`, `.sqlfluff` |
| 2.2 Rate limiting | `apps/web/src/middleware.ts`, `apps/web/src/lib/rate-limit.ts` |
| 2.3 Zod schemas | `packages/shared/src/validation/*` |
| 2.4 Webhook security | `supabase/functions/paystack-webhook/index.ts` (+ `payfast-itn`) |
| 2.5 POPIA helpers | `…0500_popia_compliance.sql`, `apps/web/src/lib/server/popia.ts`, `packages/shared/src/popia.ts` |
| 3 · Shared types | `packages/shared/src/types/index.ts`, `types/database.ts` |
| 4 · Web dashboard | `apps/web/src/components/{dashboard,calendar,services,staff}` |
| 5 · Mobile app | `apps/mobile/app/(tabs)/{index,bookings,profile}.tsx`, `app/book/[serviceId].tsx`, `app/booking/[id].tsx` |

## How a booking flows

1. Client searches (`search_businesses` RPC — mobile operators' home addresses are never exposed).
2. Client picks a slot from `get_available_slots` (no other clients' data is revealed).
3. App `POST /api/bookings` → middleware IP rate limit → JWT check → Zod → per-user limit → `book_appointment()`:
   price from DB, PostGIS travel-radius check for on-site jobs, exclusion constraint blocks double-booking, DB-level spam throttle, idempotency key.
4. If a deposit is due, `paystack-initialize` creates the ledger row and a Paystack checkout (split to the business's subaccount).
5. Paystack calls `paystack-webhook` → HMAC-SHA512 verified → re-verified via API → `apply_payment_success()` confirms the booking.
6. The client's tracker updates instantly via Supabase Realtime (RLS-filtered).

## Getting started

Prerequisites: Node 22+, [Supabase CLI](https://supabase.com/docs/guides/cli), Docker (for the local Supabase stack), an [Upstash](https://upstash.com) Redis DB, a Paystack test account.

```bash
npm install
supabase start                 # local Postgres + Auth + Storage + Realtime
supabase db reset              # applies migrations + seed.sql
cp apps/web/.env.example apps/web/.env.local       # fill in keys from `supabase status`
cp apps/mobile/.env.example apps/mobile/.env
cp supabase/functions/.env.example supabase/functions/.env

npm run dev:web                # http://localhost:3000  (owner@khula.test / KhulaDemo2026!)
npm run functions:serve        # Edge Functions
npm run dev:mobile             # Expo (client@khula.test / KhulaDemo2026!)
```

Tests:

```bash
npm test                 # shared validation/money/geo/status unit tests (vitest)
npm run db:test:fast     # all migrations + 76 RLS/booking/payment/POPIA scenarios in PGlite
npm run typecheck
```

Production: deploy `apps/web` to Vercel, push migrations with `supabase db push`, deploy functions with
`supabase functions deploy`, set secrets with `supabase secrets set --env-file …`, then work through the
checklist in [SECURITY.md](SECURITY.md).

## Notes & upgrade paths

- **Next.js 16** renames `middleware.ts` → `proxy.ts` (Node runtime). The logic ports unchanged.
- **Expo**: after changing SDKs run `npx expo install --fix`. NativeWind 4 requires Tailwind 3 — both apps share `packages/shared/tailwind-preset.cjs`.
- **Types**: `src/types/database.ts` is hand-maintained to match the migrations; regenerate the authoritative version with `npm run db:types` and diff.
- **PayFast** ITN settlement is implemented; PayFast *checkout initiation* (split payments) is not yet — Paystack is the primary rail.
