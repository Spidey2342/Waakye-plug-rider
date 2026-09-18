# Rider App — Setup

## Prerequisites

- Node.js 20+ (or current LTS compatible with Vite 8)
- npm
- Access to Supabase project `verncapitxzsgcughvil` (or a linked staging clone)
- Optional: Supabase CLI for function deploys; Deno runtime used by edge functions in production

## Clone & install

```bash
git clone https://github.com/Spidey2342/Waakye-plug-rider.git
cd Waakye-plug-rider
npm install
```

## Environment (client)

Copy `.env.example` to `.env` in the repo root and fill in your values (never commit secrets):

```bash
cp .env.example .env
```

Required variables:

```bash
VITE_SUPABASE_URL=https://verncapitxzsgcughvil.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
VITE_PAYSTACK_PUBLIC_KEY=<paystack-public-key>
```

Optional variables:

```bash
# Support WhatsApp number (country code, no + or spaces)
# Falls back to 233599995651 if not set
VITE_SUPPORT_WHATSAPP=233599995651
```

Missing Supabase vars cause `supabase.js` to throw at import time. Missing Paystack public key throws when opening settlement checkout.

## Edge function secrets (Supabase Dashboard / CLI)

| Secret | Used by |
|---|---|
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Injected by Supabase for functions |
| `PAYSTACK_SECRET_KEY` | `create-settlement`, `verify-settlement`, `paystack-webhook` |
| `RESEND_API_KEY` | `reset-pin` admin notification email |
| `ADMIN_NOTIFICATION_EMAIL` | `reset-pin` recipient |

Webhook URL pattern: `https://<project>.supabase.co/functions/v1/paystack-webhook` (configure in Paystack dashboard).

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Production build (`vite build`) |
| `npm run preview` | Preview `dist/` |
| `npm run lint` | ESLint |

Production build was verified 2026-09-15 (`vite build` exit 0). Bundle is large (~737 kB JS) because Leaflet/OSRM/motion ship in one chunk — acceptable for MVP.

## Deploy

- **Frontend:** Vercel project pointed at this repo (live: https://waakye-plug-rider.vercel.app). Set the three `VITE_*` env vars in the Vercel project.
- **Edge functions:** deploy from `supabase/functions/*` with Supabase CLI against project `verncapitxzsgcughvil`.

```bash
npx supabase functions deploy rider-login
npx supabase functions deploy reset-pin
npx supabase functions deploy add-rider
npx supabase functions deploy approve-rider
npx supabase functions deploy decline-rider
npx supabase functions deploy create-settlement
npx supabase functions deploy verify-settlement
npx supabase functions deploy paystack-webhook
```

> Resolve **Git conflict markers** in `supabase/functions/add-rider/index.ts` before deploying from a fresh checkout of `main`.

## Shared schema / migrations

Schema migrations live in the **customer** repo (`Waakye-Plug2/schema/migrations/`), including:

- `2026-09-12_canonical_status.sql`
- `2026-09-12_pin_rate_limits.sql` (`auth_rate_limits` + `begin_auth_attempt` / failure RPCs)
- `2026-09-12_rls_lockdown.sql`
- `2026-09-13_profiles_self_write_lockdown.sql`

Rider app assumes those are already applied on the shared DB.

## Test rider accounts

Created only via admin `add-rider` or self-apply + admin approve. Login with the phone and PIN chosen at creation — never with the synthetic email in the UI.
