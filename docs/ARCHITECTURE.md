# Rider App — Architecture

## Role in the platform

Three frontends share one Supabase project (`verncapitxzsgcughvil`):

1. **Customer (Waakye-Plug2)** — places orders (`status: available`), pays cash/momo at delivery (no Paystack on customer checkout yet).
2. **Admin (waakyeplug-vendor)** — manages vendors + riders; vendors never log in.
3. **Rider (this app)** — claims/delivers orders; settles platform commission via Paystack.

## High-level flow

```
Customer creates order (status=available, rider_id=null)
        │
        ▼
Rider HomeScreen lists available orders (realtime)
        │  acceptOrder: UPDATE … WHERE status='available' AND rider_id IS NULL
        ▼
status=rider_assigned  →  ActiveOrderScreen (map + nav)
        │  markPickedUp
        ▼
status=picked_up
        │  markDelivered  →  DB trigger apply_commission_on_delivery
        ▼
status=delivered; riders.commission_owed += 10% of delivery_fee
        │
        ▼  (after Accra noon if still owed)
SettleUpScreen → create-settlement → Paystack → webhook + verify-settlement
```

## Client architecture

- **No React Router.** `src/App.jsx` is an explicit state machine (`screen` string).
- Screens live under `src/components/screens/`.
- Data access is concentrated in `src/lib/*` (Supabase client queries + edge `fetch` calls).
- Maps: Leaflet UI + `mapService.js` (Nominatim geocode with Ghana viewbox + localStorage cache; OSRM routes; `speak()` voice prompts).

### Screen state machine (`App.jsx`)

| `screen` | Component | Notes |
|---|---|---|
| `login` | `LoginScreen` | Default; session restore may skip |
| `forgotPin` | `ForgotPinScreen` | Phone + Ghana Card + new PIN |
| `addRider` | `AddRiderScreen` (admin-style add) | Historically admin-onboard path from this UI |
| `apply` | `AddRiderScreen mode="apply"` | Public self-apply → pending until admin approve |
| `success` | inline success UI | After add/apply |
| `home` | `HomeScreen` | Available orders + online toggle |
| `activeOrder` | `ActiveOrderScreen` | In-progress delivery |
| `earnings` | `EarningsScreen` | Today earnings + recent deliveries |
| `settleUp` | `SettleUpScreen` | Forced after Accra noon when locked |
| `history` | `OrderHistoryScreen` | Delivered/cancelled history |
| `profile` | `ProfileScreen` | Profile + logout |

On load: `getCurrentRider()` → if approved rider session exists → `routeRiderToCurrentScreen` (active order if any, else settlement lock check, else home).

## Auth model

### Synthetic credentials

Riders never see an email/password form. The platform stores:

- **Email:** `{phone}@riders.waakyeplug.app`
- **Password:** `{pin}{last4 of phone}`

Created by `add-rider` (service role). Login **must** go through the `rider-login` edge function (not client `signInWithPassword`), which:

1. Rate-limits per phone (5 fails / 15 min → 15 min lockout) and per IP (20 / 15 min)
2. Verifies PIN server-side via anon auth client
3. Returns a real Supabase session; client calls `supabase.auth.setSession`

`getCurrentRider()` restores session and requires `riders.is_approved === true`.

PIN reset: `reset-pin` edge function (phone + Ghana Card + new PIN), with stricter PIN rules and rate limits (3 fails/phone, 10/IP per 15 min). Notifies admin via Resend when configured.

### Admin-gated rider lifecycle edges

`add-rider`, `approve-rider`, `decline-rider` verify an **admin** JWT (`profiles.role = 'admin'`). Self-apply creates a dormant rider (`is_approved: false`) until `approve-rider`. `decline-rider` returns **409** if `commission_owed > 0`.

> **Source warning:** `add-rider/index.ts` on main currently contains unresolved merge conflict markers. Treat live deployed behavior as authoritative until the file is cleaned.

## Order claiming (race safety)

`acceptOrder` (ordersApi.js):

```text
UPDATE orders
SET rider_id = $rider, status = 'rider_assigned'
WHERE id = $id AND status = 'available' AND rider_id IS NULL
RETURNING …
```

Empty result → `"This order is no longer available."`  
Unique violation `riders_one_active_order` → friendly one-active-order message.

PR #1 closed the residual hole of accepting cancelled/unassigned rows without the `status = 'available'` guard.

## Canonical status enum

DB CHECK (migration `2026-09-12_canonical_status.sql` in customer repo):

`available | rider_assigned | picked_up | delivered | cancelled`

Rider app is a primary writer for the middle three after accept.

## Money / commission

- Customer pays **delivery 8 GHS + service 1 GHS** (+ items). Rider collects cash/momo at the door; **no customer Paystack** in this stack yet.
- On `delivered`, DB trigger `apply_commission_on_delivery` increments `riders.commission_owed` by **10% of delivery_fee**.
- Settlement: `create-settlement` → Paystack Inline (`paystack.js`) → `paystack-webhook` (HMAC-SHA512) and/or `verify-settlement` (re-checks Paystack API). Amount match allows **+0.5 GHS** tolerance. Success zeroes `commission_owed` and sets `last_settled_at`.

## Settlement lock (Africa/Accra)

Pure function `shouldLockForSettlement` in `settlementLock.js`:

- Cutoff hour **12** in timezone **`Africa/Accra`** (UTC+0, no DST)
- Lock if `commission_owed > 0`, Accra hour ≥ 12, and `last_settled_at` is before today's Accra noon

`App.jsx` policy:

- **Fail open** if the first commission fetch fails (network) — rider can work
- **Fail closed** if a prior successful fetch in the session showed owed commission

## Edge functions map

| Function | Auth | Purpose |
|---|---|---|
| `rider-login` | anon + rate limits | Phone/PIN → session |
| `reset-pin` | anon + rate limits | Identity via phone + Ghana Card |
| `add-rider` | admin JWT (intended) | Create auth user + profile + rider |
| `approve-rider` | admin JWT | `is_approved = true` |
| `decline-rider` | admin JWT | Delete rider (+ profile/auth); **409 if commission owed** |
| `create-settlement` | rider or admin JWT | Create Paystack settlement intent |
| `verify-settlement` | rider or admin JWT | Confirm payment + clear debt |
| `paystack-webhook` | Paystack signature | Server-side paid confirmation |

## Security notes (post-audit)

Fixed / mitigated (see RIDER_AUDIT.md): PIN brute-force via edge + rate limits; weak reset throttling; unauthenticated mint/delete of riders; RLS lockdown in shared DB; accept status guard; Accra timezone lock.

Remaining: conflict markers in `add-rider` source; WhatsApp TODO; distance/ETA wiring; alert() UX; Resend domain.
