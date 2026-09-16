# Waakye Plug — Rider App Audit & Bug Report

**Date:** 2026-09-09
**Repo:** `Waakye-plug-rider` — github.com/Spidey2342/Waakye-plug-rider
**Stack:** Vite 8 + React 19 + Tailwind 4 + Leaflet/OSM maps + OSRM routing + Supabase (Edge Functions in Deno) + Paystack
**Companion doc:** customer app audit → `../Waakye-Plug2/AUDIT.md`

---

## 1. Summary

| Item | Result |
|---|---|
| Production build | ✅ **VERIFIED 2026-09-15** — first-ever production build: `node node_modules/vite/bin/vite.js build` exit 0, 36.7s → `dist/assets/index-CLGCUghV.js` (736.7 kB, includes Leaflet+OSRM+motion) + `index-DH00HwaA.css` (40.6 kB). Chunk-size warning only (no code-split configured) — fine for MVP. |
| Secrets hygiene | ✅ No `.env` committed; but no `.env` on disk either → needs `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_PAYSTACK_PUBLIC_KEY` |
| Overall verdict | **Most sophisticated of the three apps — real money flow, real maps. But the auth design has serious security holes that must be fixed before launch.** |

## What's genuinely impressive 👏
- **Race-safe order claiming:** `acceptOrder` updates with `.is('rider_id', null)` so two riders can't both win the same order — correct pattern.
- **Real money handling done properly:** Paystack inline checkout → webhook verifies HMAC-SHA512 signature → `verify-settlement` *re-verifies server-side against the Paystack API* before resetting `commission_owed`. Double verification is exactly right.
- **Commission math lives in a DB trigger** (fires on `delivered`) — not in client code. Correct place for it.
- **Settlement lockout:** riders with unpaid commission get locked after 12:00 until they settle — enforced app-side with a clean pure function (`settlementLock.js`).
- **Edge functions roll back properly:** failed profile/rider inserts delete the orphaned auth user.
- **Real turn-by-turn navigation:** OSRM routes + Nominatim geocoding (with localStorage cache) + voice prompts (`speak`).
- Session restore on reload so riders don't get bounced to login.

---

## 2. Bugs & Issues (ranked)

### 🔴 S1 — Rider login is brute-forceable (auth by 4-digit PIN, predictable) *(FIXED 2026-09-12 — see Fix log §6)*
- `riderAuth.js`: synthetic email = `{phone}@riders.waakyeplug.app`, password = `{pin}{last4 of phone}`.
- Both halves are **derivable from public info** — anyone who knows a rider's phone number can script `signInWithPassword` attempts against a 4-digit PIN space (10,000 combos) using the public anon key.
- **Fix (launch-blocking):** move PIN verification into an edge function with rate limiting + lockout, or use Supabase OTP/SMS. At minimum: server-side attempt throttling per phone.

### 🔴 S2 — PIN reset identity check is too weak *(FIXED 2026-09-12 — see Fix log §6)*
- `reset-pin` edge function proves identity with **phone + Ghana Card number**. Ghana Card numbers follow a predictable format (`GHA-XXXXXXXXX-X`) and the function has **no rate limit** — a known phone number + a guessed card number takes over the account.
- It does notify admin by email after a reset (good audit trail) — but the reset itself isn't stopped, only observed.
- **Fix:** rate-limit per phone/IP, require stronger verification (SMS OTP to the number on file, or admin-assisted reset).

### 🔴 S3 — `add-rider` edge function has no caller authorization *(FIXED + DEPLOYED 2026-09-12 — see Fix log §6)*
- The function uses the **service-role key** and creates an **auto-approved rider** (`is_approved: true`) — but never checks *who is calling*. The app sends only the anon key.
- Anyone with the public anon key can POST to `/functions/v1/add-rider` and mint approved rider accounts with login credentials.
- Also contradictory state: it inserts `status: 'pending'` **and** `is_approved: true` — and `is_self_apply: true` (rider applications) takes the exact same path with the same instant approval. The "apply and wait for review" flow the UI promises doesn't exist server-side.
- **Fix:** require an authenticated admin/vendor JWT for the add-rider path; set `is_approved: false` for self-applications and add an approval step (that's presumably what `decline-rider` was meant to pair with).

### 🟠 S4 — Cross-app status lifecycle is inconsistent (connects to customer-app P1)
- Rider app writes: `available → rider_assigned → picked_up → delivered` (and reads `ready` too).
- Customer app's tracker expects: `pending → accepted → preparing → ready → picked_up → delivered`.
- So when a rider accepts, the order becomes `rider_assigned` — a status **neither** the customer tracker nor (to be verified) the vendor panel keys on. The three apps + DB trigger need **one agreed status enum** before launch.
- **Fix:** define the canonical lifecycle in one place (DB enum + constants file shared/copied across apps), then reconcile all three writers/readers.

### 🟠 S5 — Dead files copied from the customer app *(FIXED 2026-09-15 — see Fix log)*
- `src/lib/orders.ts` and `src/lib/vendorMenu.ts` sit in the rider repo; nothing imports them (only `ordersApi.js` is used). Same dead-code pattern as the customer app — prune before someone "fixes" a bug in a file that never runs.

### 🟡 S6 — Rough edges *(alerts + stray duplicate FIXED 2026-09-15 — see Fix log; remaining items deliberate/deferred)*
- 2× `alert()` in `App.jsx` for add-rider/apply failures (should be inline errors like other screens do).
- `settlementLock` **fails open** on network error (comment says deliberate) — means a rider owing commission can keep working if the network hiccups at the wrong moment. Business call: acceptable for MVP, but log it.
- Paystack webhook: `+0.5 GHS` tolerance on amount match; signature compare is `===` (not constant-time — low practical risk here, but easy to harden).
- Reset-pin email sends from `onboarding@resend.dev` (Resend's placeholder sender) — will look like spam / may not deliver until a real domain is verified. Needs `RESEND_API_KEY` + `ADMIN_NOTIFICATION_EMAIL` edge secrets.
- `supabase/verify-settlement/index.ts` exists **outside** `supabase/functions/` — a stray duplicate of the real function. Delete.
- Uncommitted `package-lock.json` modification sitting in the working tree.
- No build verification yet (deps not installed on this machine).

### 🟡 S7 — Known gaps (honest TODOs in code)
- HomeScreen order cards: distance/ETA show "Distance unavailable" / "—" — needs vendor coordinates + rider live position wired into the OSRM layer (planned per comments).
- Chat Support WhatsApp number is hardcoded with a TODO to confirm (`233599995651`).

---

## 3. Environment & secrets needed to run
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_PAYSTACK_PUBLIC_KEY` (client)
- Edge function secrets (server): `PAYSTACK_SECRET_KEY`, `RESEND_API_KEY`, `ADMIN_NOTIFICATION_EMAIL` (+ Supabase defaults)

## 4. Recommended fix order
1. **S3** — add-rider authorization hole (anyone can mint rider accounts). Worst issue in the whole codebase so far. *(DONE — deployed + verified live, see Fix log)*
2. **S1/S2** — PIN brute-force + weak reset (rider account takeover). *(DONE — deployed + verified live, see Fix log)*
3. **S4** — agree the canonical order status enum across all three apps.
4. **S5/S6** — dead files, stray duplicate, alerts → inline errors. *(DONE 2026-09-15)*
5. Verify build + wire distance/ETA. *(build VERIFIED 2026-09-15; distance/ETA still open — S7)*

## 5. Pending
- [ ] Audit **vendor panel** (`waakyeplug-vendor`) — cloned, not yet audited. *(Done — see `../waakyeplug-vendor/VENDOR_AUDIT.md`)*
- [x] Verify rider app builds. *(DONE 2026-09-15 — first production build verified, see fix log; vendor app tsc also passes)*
- [ ] Confirm with Lumora: real WhatsApp support number; whether rider self-applications should auto-approve (currently they do, server-side).

---

## 6. Fix log

### 2026-09-09 — S3 CLOSED (add-rider / decline-rider auth) ✅
- `add-rider`: anonymous callers now create **pending** riders (`is_approved: false`) that can't log in until admin approval; only a verified admin JWT yields an instantly-approved rider. PIN must be exactly 4 digits. Also kills the apply→"Add Another Rider" escalation chain (both paths are anonymous → both now pending).
- `decline-rider`: admin JWT required — anonymous calls rejected 401/403 before any deletion.
- New **`approve-rider`** function created (admin-gated) — the admin panel now uses it instead of a raw anon-key write.
- Deployment pending: `supabase functions deploy add-rider decline-rider approve-rider` (needs Supabase login). Until deployed, the LIVE functions remain vulnerable — do not distribute the anon key meanwhile.

### 2026-09-12 — S3 DEPLOYED + VERIFIED LIVE ✅ (and RLS lockdown — see below)
- All three functions deployed to production (`verncapitxzsgcughvil`) via CLI as Selasi: add-rider v7, decline-rider v2, approve-rider v1.
- Empirical verification against live endpoints: anonymous add-rider → pending (cannot log in); anonymous decline-rider/approve-rider → 401. Test rider created during verification was deleted afterwards (riders row + profile + auth account).

### 2026-09-12 — RLS LOCKDOWN APPLIED TO LIVE DB ✅
- `schema/migrations/2026-09-12_rls_lockdown.sql` (rev 2, column-grant model — Postgres policies don't support `FOR UPDATE OF`) applied via Management API SQL endpoint.
- Key changes: profiles role-escalation hole closed (own-row updates via column grants on full_name+phone only); riders self-approval + commission-wipe closed (grant on is_online only; insert admin-only); orders customer UPDATE removed (grants on rider_id+status only, rider/vendor/admin row-scoped policies); two orders triggers made SECURITY DEFINER (prevents commission math being blocked by RLS — pre-flight catch); player_stats/spin_history/points_earned_log fully locked (RLS enabled, zero policies).
- Post-flight verification: RLS=true on all 10 tables; column grants exactly as designed; anonymous attack tests (patch riders→approve, profiles→admin, orders→delivered, insert player_stats) ALL blocked with 42501; public reads (vendors, orders, riders) still 200.

### 2026-09-12 — S3 VERIFIED LIVE ✅
- Functions deployed to the production project (`verncapitxzsgcughvil`) via Supabase CLI: add-rider v7, decline-rider v2, approve-rider v1 — all ACTIVE.
- Empirically verified against the live endpoints: anonymous `add-rider` now returns a **pending** rider (`is_approved:false` — cannot log in); anonymous `decline-rider` and `approve-rider` return **401 Unauthorized**. The mint/delete-rider holes are closed in production.

### 2026-09-12 — S1 + S2 CLOSED (PIN brute-force + weak reset) — DEPLOYED + VERIFIED LIVE ✅
**Migration:** `Waakye-Plug2/schema/migrations/2026-09-12_pin_rate_limits.sql` — new `auth_rate_limits` table (RLS on, **zero policies** — service-role only via explicit grants to `service_role`; anon/authenticated have no grants at all). Two SECURITY DEFINER functions, both `service_role`-execute-only:
- `begin_auth_attempt(bucket, max_attempts, window_min, lockout_min)` — atomic check-and-prepare: returns `{allowed, attempts_left, retry_after_sec}`; engages lockout on the Nth failure.
- `record_auth_failure(bucket)` / `clear_auth_failures(bucket)` — the write halves. Sliding-window counters with `locked_until`.

**S1 fix — new `rider-login` edge function (client never touches Auth directly anymore):**
- App sends `phone + PIN` to the function; it looks up the rider profile with the **service-role** key, rebuilds the same synthetic identity (`{stored_phone}@riders.waakyeplug.app` / `{pin}{last4}`), and performs the password check server-side via an **anon-role** client (keeps Supabase Auth's own counting meaningful; service-role never leaks into a session).
- Rate limits: **per-phone 5 failures / 15 min → 15 min lockout**; **per-IP 20 failures / 15 min → 15 min lockout**. IP bucket is *not* cleared on success (can't reset your IP budget with one known credential). Per-phone gate runs **before** profile lookup, so unknown-phone spam locks out too.
- PIN-guessing now dead-ends at 5 tries per 15 min — full 10k PIN space would take ~5 weeks of continuous lockouts.
- Generic `401 Incorrect phone number or PIN` for all failure paths (no oracle for which phones exist). Pending-approval accounts get a distinct 403 (not counted as a failure, session destroyed). Weak/PIN-format errors: 400.
- `riderAuth.js` rewritten: `loginRider()` calls the function, restores the returned session via `supabase.auth.setSession()`; old direct `signInWithPassword` path removed.
- Deployed: `rider-login` **v2** ACTIVE on `verncapitxzsgcughvil` (v2 = per-phone gate moved ahead of profile lookup).

**S2 fix — `reset-pin` hardened (v2 deployed):**
- Same limiter: **3 identity attempts / hour per phone → 1 hour lockout**; separate per-IP bucket (5/hour). Failure counters recorded on every dead end (profile lookup, rider/card mismatch, weak PIN); phone bucket cleared only on success.
- Weak-PIN validation: rejects 4 identical digits (`1111`), sequences (`1234`, `0123`, …), and the literal `0000`.
- Phone lookup formatting-tolerant (exact match, then spaces/hyphens stripped); password rebuilt from the **stored** phone, not rider input.
- Deployed: `reset-pin` **v2** ACTIVE on `verncapitxzsgcughvil`.

**Verification (live endpoints, 2026-09-12):**
- 6 endpoint tests: bad-format 400s; generic 401 on wrong phone/PIN; 400 on weak PINs `1111`/`1234` (new validation confirmed live); wrong-PIN against a real phone → generic 401 with limiter state written.
- Live lockout test (`supabase-cli/test-lockout.ps1`): 4 wrong PINs → 401 each; 5th → **429 lockout, `retry_after_sec: 900`**; 6th → still 429. Exactly as designed.
- DO-block DB test of the limiter itself: all 4 phase checks passed (counts up, lockout engages at cap, stays locked, clears cleanly).
- Known-nice-to-gotcha: reset flows still notify admin by email; SMS-OTP identity verification remains the future upgrade (S2's "stronger verification" step) — rate limiting is the launch-blocking half.
- Test buckets cleaned from live `auth_rate_limits` afterwards (0 rows — fresh table for launch).

### 2026-09-13 — COMMISSION GUARD VERIFIED LIVE (V4→V5) ✅
`decline-rider` refuses to delete a rider while `commission_owed > 0` — now proven end-to-end with a **real admin session**, not just the auth gate:
- **V4 attempt** (`schema/test-v4-commission-guard.cjs`) could only exercise the auth gate: it seeded `profiles` directly with service role, but `profiles.id` is FK→`auth.users` and `profiles.email` is NOT NULL, so the seed died (23503/23502) and the bogus-JWT call never reached the commission branch.
- **V5** (`Waakye-Plug2/schema/test-v5-commission-guard.cjs`, rerunnable + self-cleaning) creates throwaway auth users via the admin API, mirrors the FK-valid chain (`auth.users → profiles → riders`), signs in via password grant to mint a genuine admin JWT, and covers four branches:
  - A. bogus JWT → **401** ✅
  - B. real customer JWT → **403** (admin required) ✅
  - C. admin + owed GHS 25.50 → **409** naming the amount, riders row + auth account intact ✅
  - D. after settling owed → 0, same admin call → **200**, riders row + profile + auth account all deleted ✅
- All checks PASS, exit 0 (run 2026-09-13 ~17:05 UTC).
- Test-scripting gotchas for future live tests (cost several retries): PostgREST INSERT returns **201 with an empty body** unless you send `Prefer: return=representation` (needed to get the generated `riders.id` back); insert responses are **arrays**; `profiles.email` NOT NULL must be included when seeding.

### 2026-09-15 — S5 + S6 CLOSED (dead files, stray duplicate, alerts → inline errors) ✅
**S5 — dead files deleted:**
- `src/lib/orders.ts` and `src/lib/vendorMenu.ts` — both **0 bytes** on disk (confirmed before deletion), zero imports anywhere in `src/`. Gone.
- `supabase/verify-settlement/` — the stray duplicate *outside* `supabase/functions/` — deleted via `Remove-Item -Recurse`. The real function at `supabase/functions/verify-settlement/index.ts` is untouched (referenced by `settlementApi.js:39`).

**S6 — alerts → inline errors (the last two `alert()` calls in the entire platform):**
- `App.jsx` `handleAddRider`/`handleApply`: `alert(...)` removed; failure now writes a `submitError` state (`Failed to add rider: …` / `Could not submit application: …`) and still throws so the form screen can stop its spinner.
- `AddRiderScreen.jsx`: new optional props `error` + `onErrorDismiss`; `handleSubmit` wraps `await onSubmit(form)` in try/catch (previously the throw landed in an unhandled rejection); dismisses the banner on back/next/submit; renders a red inline banner (icon dismiss button, `aria-label="Dismiss error"`) above the sticky action bar — pattern matches ForgotPinScreen/LoginScreen/HomeScreen. Added missing `X` lucide import.
- Grep-verified: **zero `alert(` remain in rider `src/`**.

**Build verified (first-ever production build):** `node node_modules/vite/bin/vite.js build` → exit 0, 36.7s, `dist/assets/index-CLGCUghV.js` (736.7 kB) + `index-DH00HwaA.css` (40.6 kB). Includes both the S5 deletions and S6 inline-error changes. Chunk-size warning only (Leaflet+maps+motion un-split) — not a blocker.

### 2026-09-15 — SETTLEMENT GATES DEPLOYED + VERIFIED LIVE (create-settlement / verify-settlement / paystack-webhook) ✅
**Scope:** both settlement edge functions now hard-require a real Supabase JWT before any DB access; webhook still signature-only (Paystack can't send a rider JWT).

**Deployed:** `supabase functions deploy create-settlement verify-settlement` on verncapitxzsgcughvil → "Deployed Functions on project verncapitxzsgcughvil: create-settlement, verify-settlement".

**Live re-test (Waakye-Plug2/scripts/test-edge-auth-2.cjs, rerunnable, exit 0):**
- create-settlement anon → **401** `{"error":"Invalid or expired token"}` ✅
- verify-settlement anon → **401** ✅
- paystack-webhook unsigned body → rejected (signature gate) ✅

**Verify-by-authority note:** real rider/admin JWT flows were verified earlier in this fix cycle with genuine sessions; today's re-run re-proves the anon-rejection half only.
**False alarm during re-test:** a probe run against the **pre-redeploy revision** made it look like the gates were bypassed and that `rider_settlements.total_commission_owed` was missing. Both disproven: re-test after deploy is green, and the column exists in live `rider_settlements` (the "missing" was PowerShell output truncation).
**Test-rider residue:** none left by this run (anon probes never passed the gate). The older test-rider rows (riders + profiles) were deleted via `schema/cleanup-test-rider.cjs` — riders row 204, profile row 204, auth account already gone, confirmed gone afterwards.

### 2026-09-15 — S3 STATUS CORRECTION: deployed since 2026-09-12, not "pending" ✅
S3 line above still read "deployment pending" — stale. add-rider/decline-rider/approve-rider have been live since the 2026-09-12 deploy; S3 is fully CLOSED, no pending deployment anywhere in the rider app.

### 2026-09-16 — Accept status guard + Accra settlement lock (Archilles / Lumora Team) ✅
**Fix 1 — `acceptOrder` status guard:** update now requires `.eq('status', 'available')` alongside `rider_id IS NULL`. Empty result message: "This order is no longer available." `fetchAvailableOrders` no longer queries legacy `ready` — only `available`. Closes the residual S4 accept hole (cancelled/unassigned reclaim).

**Fix 2 — settlement lock timezone:** `shouldLockForSettlement` uses **Africa/Accra** noon (via `Intl` + UTC noon on Accra calendar day; Accra is UTC+0 year-round). `App.jsx` still fails open on first-fetch network errors, but **fails closed** when a prior successful fetch in the session showed `commission_owed > 0`.

**S4 note:** Canonical order statuses already agree across apps (`available → rider_assigned → picked_up → delivered` + `cancelled`). Remaining rider-side gap was accept without a status guard — closed above. Self-apply remains **pending until admin approve** (not auto-approve).
