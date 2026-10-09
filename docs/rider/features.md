# Waakye Plug — Rider App Changes

This folder documents changes made to **`Waakye-plug-rider`** as the rider
features evolve.

## Status: no changes yet

No rider-app code changes have been made so far in this project's history.

Notes relevant to the rider app (so future work here has context):

- The **rider repo** is where the Supabase CLI is linked — database queries
  (schema, RLS, mutations) are run from `C:\Users\user\Desktop\Waakye-plug-rider`
  with `supabase db query "<SQL>" --linked`.
- Riders claim orders that reach `status = 'available'`; the customer and
  vendor apps both watch `orders` over realtime.
- Riders have their own `riders` table (`is_approved`, `is_online`,
  `transport_type`, commission/deposit) with edge functions `approve-rider` /
  `decline-rider` for admin approval.
- Order statuses used across the platform:
  `awaiting_approval → available → rider_assigned → picked_up → delivered`
  (plus `cancelled`).