# Paystack — switch from test to live (rider settlements)

Rider **Settle Up** uses Paystack Inline. Keys are **never** in git — only env vars.

## 1. Paystack Dashboard (Live mode)

1. Turn off **Test mode** (toggle top-right).
2. Copy **Live public key** (`pk_live_…`) and **Live secret key** (`sk_live_…`).
3. **Settings → API Keys & Webhooks → Webhooks**  
   Add (or update) URL for **Live** transactions:

   `https://verncapitxzsgcughvil.supabase.co/functions/v1/paystack-webhook`

   Use the **live** webhook secret Paystack shows (same env name on Supabase: `PAYSTACK_SECRET_KEY`).

## 2. Vercel (rider app frontend)

Project: **waakye-plug-rider** (or your rider deployment).

| Variable | Value |
|----------|--------|
| `VITE_PAYSTACK_PUBLIC_KEY` | `pk_live_…` (live public key) |

Redeploy after saving. Production builds **block** `pk_test_` keys (see `src/lib/paystack.js`).

## 3. Supabase (edge functions)

Project: `verncapitxzsgcughvil` → **Project Settings → Edge Functions → Secrets**

| Secret | Value |
|--------|--------|
| `PAYSTACK_SECRET_KEY` | `sk_live_…` (live secret key) |

Used by: `create-settlement`, `verify-settlement`, `paystack-webhook`.

No function redeploy is required for a secret-only change, but redeploy if you are unsure caches are fresh.

## 4. Local dev (optional)

Keep test keys in local `.env` only:

```bash
VITE_PAYSTACK_PUBLIC_KEY=pk_test_…
```

`npm run dev` allows test keys; `npm run build` + preview treats test keys like production if you need to verify the guard.

## 5. Smoke test (live, small amount)

1. Rider with small `commission_owed` → **Settle Up** → Paystack opens (live UI, real charge).
2. Complete payment → app returns home unlocked.
3. Paystack Dashboard → **Live** transactions → payment appears.
4. Supabase logs: `paystack-webhook` 200, `verify-settlement` success.

## Checklist

- [ ] Live `pk_live_` on Vercel + redeploy rider app  
- [ ] Live `sk_live_` in Supabase `PAYSTACK_SECRET_KEY`  
- [ ] Live webhook URL registered in Paystack (not test webhook only)  
- [ ] Test settlement with a small real commission amount  

## Clear test commission debt (all riders)

After test Paystack runs, riders may still show `commission_owed > 0` and get **Settle Up** locked. That is platform ledger debt, not real live money.

Run once in **Supabase → SQL Editor**:

[`scripts/clear-test-rider-commission-debt.sql`](../scripts/clear-test-rider-commission-debt.sql)

This sets every rider’s `commission_owed` to **0**, updates `last_settled_at`, and marks **pending** `rider_settlements` as **paid** so checkout can start clean on live keys.
