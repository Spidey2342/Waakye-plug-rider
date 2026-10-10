-- One-time: wipe test-era rider commission balances (Paystack test settlements).
-- Run in Supabase Dashboard → SQL Editor (uses postgres / service role).
-- Does NOT refund Paystack test charges — only clears platform ledger (riders.commission_owed).
--
-- After live Paystack go-live, run once, then riders should not be locked to Settle Up for old test debt.

BEGIN;

-- Preview
SELECT
  r.id AS rider_id,
  p.full_name,
  p.phone,
  r.commission_owed,
  r.last_settled_at
FROM public.riders r
LEFT JOIN public.profiles p ON p.id = r.profile_id
WHERE COALESCE(r.commission_owed, 0) > 0
ORDER BY r.commission_owed DESC;

-- Clear all rider commission debt
UPDATE public.riders
SET
  commission_owed = 0,
  last_settled_at = timezone('UTC', now())
WHERE COALESCE(commission_owed, 0) <> 0;

-- Close stuck "pending" settlement intents from test checkout (optional but recommended)
UPDATE public.rider_settlements
SET
  status = 'paid',
  paid_at = COALESCE(paid_at, timezone('UTC', now()))
WHERE status = 'pending';

COMMIT;

-- Verify (full_name is on profiles, not riders)
SELECT COUNT(*) AS riders_still_owing
FROM public.riders
WHERE COALESCE(commission_owed, 0) > 0;

SELECT r.id, p.full_name, p.phone, r.commission_owed
FROM public.riders r
LEFT JOIN public.profiles p ON p.id = r.profile_id
WHERE COALESCE(r.commission_owed, 0) > 0;

SELECT status, COUNT(*) AS n
FROM public.rider_settlements
GROUP BY status
ORDER BY status;
