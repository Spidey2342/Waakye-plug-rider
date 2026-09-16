# Waakye Plug — Rider App

Mobile-first web app for delivery riders. Riders log in with phone + PIN, claim available orders, navigate to vendor then customer, mark pickup/delivery, track earnings, and settle platform commission via Paystack.

**Live:** https://waakye-plug-rider.vercel.app  
**Repo:** [Spidey2342/Waakye-plug-rider](https://github.com/Spidey2342/Waakye-plug-rider)  
**Shared Supabase project:** `verncapitxzsgcughvil`

## Platform siblings

| App | Repo | Live |
|---|---|---|
| Customer | [Spidey2342/Waakye-Plug2](https://github.com/Spidey2342/Waakye-Plug2) | https://waakye-plug2.vercel.app |
| Admin (vendor panel) | [Spidey2342/waakyeplug-vendor](https://github.com/Spidey2342/waakyeplug-vendor) | https://waakyeplug-vendor.vercel.app |
| **Rider (this repo)** | Spidey2342/Waakye-plug-rider | https://waakye-plug-rider.vercel.app |

## Stack

- Vite 8 + React 19 + Tailwind 4
- Leaflet / OpenStreetMap + OSRM routing + Nominatim geocoding
- Supabase (Auth, Postgres, Realtime, Edge Functions in Deno)
- Paystack Inline (commission settlements only)

## Quick start

See **[docs/SETUP.md](docs/SETUP.md)** for env vars, install, and edge-function deploy.

```bash
npm install
# Create .env with the vars listed in SETUP.md (there is no .env.example in this repo)
npm run dev
```

## Documentation

| Doc | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, auth model, order lifecycle, money flow |
| [docs/FEATURES.md](docs/FEATURES.md) | Exhaustive inventory of every screen, `src/lib` module, and edge function |
| [docs/SETUP.md](docs/SETUP.md) | Local env, secrets, build, deploy |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Day-to-day rider ops, settlement lock, support |
| [RIDER_AUDIT.md](RIDER_AUDIT.md) | Security/bug audit + fix log (keep; historical source of truth) |

## Platform constants (shared)

| Constant | Value |
|---|---|
| Delivery fee | **8 GHS** |
| Service fee | **1 GHS** |
| Rider commission | **10% of delivery fee** (DB trigger `apply_commission_on_delivery` on `delivered`) |
| Settlement lock | After **Africa/Accra noon (12:00)** if `commission_owed > 0` and not settled since today's Accra cutoff |
| Max vendor radius (customer) | **6 km** |
| Order status enum | `available` → `rider_assigned` → `picked_up` → `delivered` \| `cancelled` |
| Paystack amount tolerance | **+0.5 GHS** |
| Chat Support WhatsApp | `233599995651` (**TODO: confirm**) |
| Synthetic rider email | `{phone}@riders.waakyeplug.app` |
| Auth password shape | `{pin}{last4 of phone}` (server-side only; never typed by rider) |

## PR #1 (merged) — accept guard + Accra lock

Merged rider work: `acceptOrder` requires `status = 'available'` **and** `rider_id IS NULL`; settlement lock uses **Africa/Accra** noon. See [RIDER_AUDIT.md](RIDER_AUDIT.md) fix log (2026-09-16).

## Known open gaps

Documented fully in FEATURES / OPERATIONS / audit:

- HomeScreen distance/ETA still shows "Distance unavailable" / "—" until vendor GPS + rider position are wired into OSRM cards
- WhatsApp support number hardcoded with TODO to confirm (`233599995651`)
- Settlement lock **fails open** on first-fetch network error (fails closed if session already knew commission was owed)
- `alert()` still used for add-rider / apply failures in `App.jsx`
- Resend sender may still be placeholder (`onboarding@resend.dev`) until domain + secrets are verified
- **`supabase/functions/add-rider/index.ts` still has unresolved Git conflict markers on `main`** (`<<<<<<< HEAD` / `=======` / `>>>>>>> …`) — must be resolved before relying on that function's source in-repo

## License / private

Private product codebase for Waakye Plug / Lumora.
