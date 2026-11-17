## What & why

<!-- One or two sentences. Link the issue. -->

## Security & POPIA checklist

- [ ] No secrets, tokens or real customer data in code, tests, fixtures or env examples
- [ ] New tables have RLS + least-privilege policies; new functions have explicit `grant execute`
- [ ] All new inputs validated with a shared `.strict()` Zod schema (and SQL checks where relevant)
- [ ] Authorisation enforced server-side (RLS / RPC checks), not only in the UI
- [ ] Payment amounts computed server-side; webhooks verify signatures before state changes
- [ ] Personal information: purpose stated below, retention + erasure/export handled, nothing logged
- [ ] Tests added/updated (`supabase/tests`, `packages/shared/src/__tests__`)

**Personal information touched (if any) and purpose:**

## How I tested
