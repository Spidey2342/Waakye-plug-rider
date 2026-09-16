# Rider App — Operations

## Daily rider workflow

1. Open https://waakye-plug-rider.vercel.app
2. Sign in with phone + PIN
3. Toggle **online** on Home
4. Accept an available order (only one active order at a time)
5. Navigate vendor → pickup → customer → mark delivered
6. After Accra noon, if commission is still owed, app locks to **Settle Up** until Paystack payment succeeds

## Settlement lock (business rule)

- Timezone: **Africa/Accra**
- Cutoff: **12:00 Accra**
- Condition: `commission_owed > 0` and no successful settlement since today's Accra noon
- Commission amount: **10% of each order's delivery fee**, accrued by DB trigger on `delivered`

### Fail-open / fail-closed behavior

| Situation | Behavior |
|---|---|
| First commission fetch fails (network) | **Fail open** — rider can still work |
| Session already observed `commission_owed > 0` and lock would apply | **Fail closed** — force Settle Up |

## Admin operations that affect riders

Performed in the **admin panel** (waakyeplug-vendor), which calls rider-repo edge functions:

| Action | Edge | Notes |
|---|---|---|
| Approve application | `approve-rider` | Sets `is_approved` |
| Decline / remove | `decline-rider` | **Blocked with 409** while commission owed |
| Onboard in person | `add-rider` with admin JWT | Approved immediately (intended) |

Self-apply from the rider app creates a **pending** rider who cannot log in until approved (`getCurrentRider` requires `is_approved`).

## Support

- In-app Chat Support (Active Order) opens WhatsApp to **`233599995651`** — **TODO: confirm this is the real support line** before launch comms.
- PIN resets notify `ADMIN_NOTIFICATION_EMAIL` via Resend when secrets are configured. Placeholder From-address (`onboarding@resend.dev`) may look like spam until a verified domain is set.

## Incident checklist

1. **Riders cannot log in / 429:** check `auth_rate_limits` buckets / wait out lockout; confirm `rider-login` deployed.
2. **Cannot accept orders:** confirm order `status=available` and `rider_id` null; check unique one-active-order constraint.
3. **Settlement paid but still locked:** inspect `rider_settlements` + `paystack-webhook` / run `verify-settlement` with the Paystack reference; confirm HMAC secret.
4. **Wrong map destination:** prefer vendor `latitude`/`longitude` from Settings; Nominatim is Ghana-bounded but ambiguous addresses can still fail.
5. **add-rider source conflicts:** do not redeploy from conflicted `main` file — resolve markers first.

## Related docs

- [ARCHITECTURE.md](ARCHITECTURE.md)
- [FEATURES.md](FEATURES.md)
- [SETUP.md](SETUP.md)
- [../RIDER_AUDIT.md](../RIDER_AUDIT.md)
