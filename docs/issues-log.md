# Rider Settlement / Wallet — Issue Log

> Keep this file updated whenever the platform-manager-fee ("wallet") flow
> misbehaves. Each entry = what the rider saw, what actually caused it, and
> what we changed so the pattern is not reintroduced.

---

## 2026-10-10 — Rider can't pay commission; duplicated settlement intents

**Reported by:** Spidey (platform manager)
**Symptom (rider):** "After delivery you have to pay something to use — like a
platform manager's fee — but the wallet where the rider pays has an error."
Rider reaches the **Daily Settlement Required** screen, taps **Pay with
Paystack**, and payment cannot complete. The rider stays locked out.

### Root causes (confirmed)

1. **Duplicate settlement intents (primary — real money risk).**
   `create-settlement` inserted a NEW `rider_settlements` row (with a fresh
   `paystack_reference`) on every call — there was no "reuse a pending intent"
   guard. Evidence in prod data: rider `0599995611` has **two `pending` rows
   for GH₵1.00 created one second apart (2026-10-09), neither paid**, and still
   shows `commission_owed = 1.00`. Consequences:
   - A rider (or double-tap / re-mount of the Settle Up screen) gets multiple
     references. If both ever get paid, one payment is verifiable while the
     other hits `already_processed` — meaning the rider is charged twice and
     the second charge is never applied to their commission.
   - Stale `pending` rows accumulate with no cleanup path.

2. **Commission accounting resets instead of subtracts.**
   `verify-settlement` and `paystack-webhook` both set `commission_owed = 0`
   after a payment. If the rider delivered another order *between creating the
   intent and paying*, that new commission was silently wiped. (Should have
   been `commission_owed - amount_paid`.)

3. **Missing client Paystack public key (dev/preview builds).**
   Production has `VITE_PAYSTACK_PUBLIC_KEY` baked in (Vercel), but the local
   `.env` (gitignored) only had the commented placeholder
   `pk_test_xxxxxxxxxxxxx`. Any build without the env var threw
   `Missing VITE_PAYSTACK_PUBLIC_KEY in .env` instantly on tapping Pay.
   The live public key is public (it ships in the browser bundle):
   `pk_live_3a37012a48f76211f246f0ea1b57f0d228e69882`.

### Fixed

- `create-settlement`: is now **idempotent** — if a `pending` settlement
  already exists for the rider it returns that same reference/amount instead
  of inserting a second one.
- `verify-settlement` + `paystack-webhook`: after a successful payment,
  `commission_owed` is **reduced by the settled amount** (never `= 0`), and any
  other `pending` settlements for the rider are marked `failed` (the status
  CHECK allows only `pending`/`paid`/`failed`).
- `paystack.js`: actionable error message if the key is ever missing.
- `SettleUpScreen`: success/error feedback now uses the app-wide toast system.
- Local `.env` given the real live public key so dev builds exercise the full
  flow (file is gitignored — do not commit).
- Regression guard: `create-settlement` called twice for the same rider now
  returns the same reference and leaves exactly one `pending` row (see the
  test script referenced in `/scripts`).

### Verification note

Reproduced against the live edge functions **before** the fix (two calls →
two different references + two `pending` rows), and **after** the fix (two
calls → same reference + one `pending` row). Test rider and rows were removed
after the run.

### Ops checklist for the next person

- Vercel (`waakye-plug-rider`): ensure `VITE_PAYSTACK_PUBLIC_KEY` is set
  (currently yes — the live key above). Local dev: `.env` (gitignored).
- Supabase: `PAYSTACK_SECRET_KEY` must exist for `verify-settlement` /
  `paystack-webhook` (currently set).
- Paystack minimum for GHS inline is GHS 1.00 — a rider owing less than that
  cannot pay; keep an eye on that edge (product decision, not a code bug).
- Clean up any legacy `pending` rows in `rider_settlements` for riders who
  already paid a different reference:
  `update rider_settlements set status = 'failed' where status = 'pending' and paid_at is null and id <> (select id from rider_settlements s2 where s2.rider_id = rider_settlements.rider_id and s2.status = 'pending' order by s2.created_at desc limit 1);`