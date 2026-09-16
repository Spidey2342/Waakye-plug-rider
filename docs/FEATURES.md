# Rider App — Features (exhaustive inventory)

Every screen file, every `src/lib` module, and every edge function as of the docs branch. No invented features.

## Screens (`src/components/screens/`)

### `LoginScreen.jsx`
- Phone + 4-digit PIN form
- Calls `riderLogin` → edge `rider-login`
- Links: Forgot PIN, Apply as rider
- On success: parent routes via `routeRiderToCurrentScreen`

### `ForgotPinScreen.jsx`
- Phone + Ghana Card number + new 4-digit PIN
- Calls `resetPin` → edge `reset-pin`
- Shows rate-limit / verification errors from the edge

### `AddRiderScreen.jsx`
- Dual mode: **add** (default) and **apply** (`mode="apply"`)
- Collects: full name, phone, PIN, transport, Ghana Card, home area, emergency contact, photo URL fields, deposit (add path)
- Submits to parent handlers which call edge `add-rider`
- Success UI is rendered by `App.jsx` (`screen === 'success'`), not a separate file

### Success UI (`App.jsx` inline)
- Shown after successful add or apply
- CTA back to add-rider or login

### `HomeScreen.jsx`
- Lists `fetchAvailableOrders()` (`status = available`, `rider_id IS NULL`)
- Online/offline via `setRiderOnlineStatus`
- Accept → `acceptOrder` (race-safe + status guard)
- Nav tabs to earnings / history / profile / settle
- Order cards: distance label uses `order.distance_km` or **"Distance unavailable"**; ETA often **"—"** (known gap)

### `ActiveOrderScreen.jsx`
- Current assigned order (`rider_assigned` | `picked_up`)
- Map + OSRM route via `mapService` (vendor GPS preferred over free-text geocode)
- Actions: mark picked up, mark delivered, report issue (`issuesApi`)
- **Chat Support** opens WhatsApp to `SUPPORT_WHATSAPP_NUMBER = '233599995651'` with **TODO to confirm**

### `EarningsScreen.jsx`
- Today earnings = sum of `delivery_fee` on today's delivered orders (`fetchTodayEarnings`)
- Commission owed + recent deliveries (`fetchCommissionOwed`, `fetchRecentDeliveries`)

### `SettleUpScreen.jsx`
- Today settlement summary (`fetchTodaySettlementSummary`)
- Pay commission via Paystack (`createSettlementIntent` + `payWithPaystack` + `verifySettlement`)
- Forced destination when Accra noon lock is active

### `OrderHistoryScreen.jsx`
- `fetchOrderHistory` — delivered + cancelled for this rider, newest first

### `ProfileScreen.jsx`
- Shows rider profile fields from session rider record
- Logout (clears Supabase session)

### Placeholder (`App.jsx`)
- `PlaceholderScreen` helper exists for unfinished tabs (not used as primary routes in current machine)

---

## Libraries (`src/lib/`)

### `supabase.js`
- Creates browser Supabase client from `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`
- Throws if env missing

### `riderAuth.js`
- `riderLogin(phone, pin)` → `POST /functions/v1/rider-login` then `setSession`
- `getCurrentRider()` — session restore; requires `is_approved`
- `resetPin(phone, ghanaCardNumber, newPin)` → `reset-pin`

### `ordersApi.js`
- `fetchAvailableOrders()` — `status = available`, `rider_id IS NULL`, vendor GPS fields
- `fetchActiveOrderForRider(riderId)` — `rider_assigned` | `picked_up`
- `acceptOrder(orderId, riderId)` — requires `status=available` + `rider_id IS NULL` (PR #1)
- `markPickedUp(orderId)` → `picked_up`
- `markDelivered(orderId)` → `delivered` (fires commission trigger)
- `setRiderOnlineStatus(riderId, isOnline)`

### `earningsApi.js`
- `fetchTodayEarnings(riderId)`
- `fetchCommissionOwed(riderId)` → `{ commissionOwed, lastSettledAt }`
- `fetchRecentDeliveries(riderId, limit=10)`

### `settlementApi.js`
- `fetchTodaySettlementSummary(riderId)`
- `createSettlementIntent()` → edge `create-settlement` with user JWT
- `verifySettlement(reference)` → edge `verify-settlement`

### `settlementLock.js`
- Accra timezone helpers; `CUTOFF_HOUR = 12`; `ACCRA_TZ = 'Africa/Accra'`
- `todaysAccraCutoff`, `shouldLockForSettlement(commissionOwed, lastSettledAt, now)`
- Exports `accraDayKey`, `ACCRA_TZ`, `CUTOFF_HOUR`

### `paystack.js`
- Loads Paystack Inline script; `payWithPaystack({ email, amountGHS, reference, onSuccess, onClose })`
- Requires `VITE_PAYSTACK_PUBLIC_KEY`; amounts in pesewas (`* 100`), currency `GHS`

### `mapService.js`
- `geocodeAddress` — Nominatim, Ghana `countrycodes` + viewbox, localStorage cache `waakye_geocode_cache_v1`
- `getRoute(from, to)` — OSRM driving
- `distanceMeters`, `speak(text)` voice prompts

### `historyApi.js`
- `fetchOrderHistory(riderId)` — delivered/cancelled

### `issuesApi.js`
- `reportIssue(orderId, riderId, description)` → insert `order_issues`

---

## Edge functions (`supabase/functions/`)

### `rider-login`
- Input: `{ phone, pin }`
- Rate limits via RPC `begin_auth_attempt`: phone **5**/15m, IP **20**/15m, lockout 15m
- Reconstructs synthetic email/password; returns session + rider payload
- Generic error on bad credentials

### `reset-pin`
- Input: `{ phone, ghana_card_number, new_pin }`
- Blocks trivial PINs (repeats, ascending/descending runs)
- Rate limits: phone **3**/15m, IP **10**/15m
- Verifies Ghana Card match; updates auth password; optional Resend admin email

### `add-rider`
- Creates auth user + `profiles` (role `rider`) + `riders` row
- Synthetic email `{phone}@riders.waakyeplug.app`, password `{pin}{last4}`
- Intended: admin JWT → approved; public self-apply → pending
- **OPEN GAP:** file on main still contains Git conflict markers (`<<<<<<< HEAD` …) mixing HEAD vs admin-check branches — resolve before treating source as deployable truth

### `approve-rider`
- Admin JWT required
- Sets `is_approved: true`, `status: 'approved'`

### `decline-rider`
- Admin JWT required
- Deletes rider (+ profile/auth cleanup)
- **HTTP 409** if `commission_owed > 0` (message includes GHS amount)

### `create-settlement`
- Rider or admin JWT; riders limited to self
- Creates `rider_settlements` pending row + Paystack reference/amount

### `verify-settlement`
- Rider or admin JWT; re-verifies with Paystack API
- Clears `commission_owed` / marks settlement `paid` when amount OK

### `paystack-webhook`
- HMAC-SHA512 signature verification
- On charge success, matches settlement by reference; **+0.5 GHS** tolerance vs `total_commission_owed`
- Marks paid + zeroes commission

---

## Supporting app files

| File | Role |
|---|---|
| `src/App.jsx` | Screen state machine, settlement lock polling, add/apply handlers (`alert` on failure) |
| `src/main.jsx` | React mount |
| `src/App.css`, `src/index.css` | Styles |
| `vite.config.js` | Vite config |
| `eslint.config.js` | ESLint |
| `supabase/config.toml` | Supabase CLI config |
| `public/favicon.svg`, `public/icons.svg` | Static assets |

## Constants & live URLs (reference)

| Item | Value |
|---|---|
| Live | https://waakye-plug-rider.vercel.app |
| Delivery / service (customer-side) | 8 / 1 GHS |
| Commission | 10% of delivery fee (DB) |
| Accra noon lock | yes |
| Status enum | available → rider_assigned → picked_up → delivered \| cancelled |
| WhatsApp | 233599995651 TODO |
| Paystack tolerance | +0.5 GHS |
| PR #1 | accept `status=available` + Accra settlement lock (merged) |

## Known open gaps (rider)

1. Distance/ETA on HomeScreen cards incomplete
2. WhatsApp number TODO
3. Fail-open settlement lock on unknown owed (first fetch)
4. **add-rider conflict markers still on main**
5. `alert()` for add/apply errors
6. Resend placeholder sender until production domain/secrets confirmed
