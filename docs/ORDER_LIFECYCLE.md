# Order Lifecycle Edge Functions

Three Supabase edge functions that handle secure order lifecycle transitions beyond what riders can do via direct PostgREST writes.

## Overview

These functions use service-role credentials to perform mutations that require business logic validation or admin privileges. All functions follow the existing auth patterns from `approve-rider`, `reset-pin`, etc.

| Function | Caller | Purpose |
|----------|--------|---------|
| `release-order` | Rider JWT | Unassign self from accepted order (before pickup) |
| `cancel-order` | Admin JWT | Cancel order at any stage (available → picked_up) |
| `verify-delivery` | Rider JWT | Confirm delivery with customer's 4-digit code |

**Shared Supabase instance:** `verncapitxzsgcughvil`

**Status transitions:**
```
available → rider_assigned → picked_up → delivered
                ↓               ↓           
            cancelled       cancelled
```

---

## `release-order`

**Endpoint:** `POST /functions/v1/release-order`

**Auth:** Rider JWT (Authorization: Bearer token)

**Request body:**
```json
{
  "order_id": "uuid",
  "release_reason": "optional string"
}
```

**Product rules (locked):**
- Rider must own the order (rider_id matches JWT)
- Status must be exactly `rider_assigned` (NOT `picked_up`)
- On success: `status` → `available`, `rider_id` → `null`
- Optional `release_reason` is recorded in `order_issues` for admin visibility

**Response (success):**
```json
{
  "success": true,
  "order": { /* updated order record */ }
}
```

**Error cases:**
- `401` Missing/invalid JWT
- `403` Not the assigned rider
- `404` Order not found
- `400` Cannot release after pickup (status = `picked_up`)
- `400` Cannot release in other statuses (delivered, cancelled, etc.)

**Out of scope:**
- Customer WhatsApp notification (later story)
- Rider penalty system (TBD)

---

## `cancel-order`

**Endpoint:** `POST /functions/v1/cancel-order`

**Auth:** Admin JWT (Authorization: Bearer token)

**Request body:**
```json
{
  "order_id": "uuid",
  "cancel_reason": "required string"
}
```

**Product rules (locked):**
- Admin JWT required (reuses `requireAdmin` helper)
- Allowed statuses: `available` | `rider_assigned` | `picked_up`
- On success: `status` → `cancelled`, `rider_id` → `null`, `cancel_reason` recorded

**Response (success):**
```json
{
  "success": true,
  "order": { /* updated order record */ },
  "pending_actions": {
    "customer_notification": "WhatsApp notification not yet implemented",
    "refund": "Paystack refund integration pending",
    "rider_penalty": "Delivery fee penalty on next order not yet implemented" | null
  }
}
```

**Error cases:**
- `401` Missing/invalid JWT
- `403` Not an admin
- `404` Order not found
- `400` Cannot cancel (status = `delivered` or `cancelled`)

**TODO (stub comments in code):**
- Customer WhatsApp notification via WhatsApp Business API
- Paystack refund logic (fetch payment reference, call refund API)
- Rider delivery fee percentage penalty on next order (percentage TBD)

---

## `verify-delivery`

**Endpoint:** `POST /functions/v1/verify-delivery`

**Auth:** Rider JWT (Authorization: Bearer token)

**Request body:**
```json
{
  "order_id": "uuid",
  "delivery_code": "1234"
}
```

**Product rules (locked):**
- Rider must own the order (rider_id matches JWT)
- Status must be exactly `picked_up` (not `rider_assigned`, not already `delivered`)
- `delivery_code` must be 4 digits
- Compare against `delivery_code_hash` in database (bcrypt)
- Rate limit: **5 wrong attempts per order per 15 minutes** (uses `begin_auth_attempt` / `record_auth_failure` pattern)
- On success: `status` → `delivered` (commission trigger fires automatically)

**Response (success):**
```json
{
  "success": true,
  "order": { /* updated order record */ },
  "message": "Delivery verified successfully"
}
```

**Error cases:**
- `401` Missing/invalid JWT
- `403` Not the assigned rider
- `404` Order not found
- `400` Invalid delivery code format (not 4 digits)
- `400` Cannot verify before pickup (status = `rider_assigned`)
- `400` Order already delivered
- `400` Delivery code not set (column missing or null)
- `400` Invalid delivery code (wrong code)
- `429` Too many incorrect attempts (rate limited)

**Schema dependency:**
- Requires `delivery_code_hash` column on `orders` table (bcrypt hash)
- Customer app must generate and store hash at checkout
- If column doesn't exist yet, function returns clear error message

**Rate limiting:**
- Uses existing `auth_rate_limits` table / RPC pattern
- Bucket key: `verify-delivery:{order_id}`
- 5 failures / 15 min → 15 min lockout
- Prevents brute-force of 4-digit code (10,000 possibilities / 5 attempts = 0.05% chance)

**Security notes:**
- Never returns the plaintext delivery code
- Hash comparison uses bcrypt (secure against timing attacks)
- Rate limit is per-order, not per-rider (prevents session reuse attacks)

**TODO (stub comments in code):**
- Customer WhatsApp "delivered" notification (later story)

---

## Deployment

Deploy all three functions to Supabase:

```bash
# From repo root
supabase functions deploy release-order
supabase functions deploy cancel-order
supabase functions deploy verify-delivery
```

**Environment secrets required:**
- `SUPABASE_URL` (auto-injected by Supabase)
- `SUPABASE_SERVICE_ROLE_KEY` (auto-injected by Supabase)
- `SUPABASE_ANON_KEY` (auto-injected by Supabase)

No additional secrets needed for these stubs. Future stories will require:
- WhatsApp Business API credentials (for customer notifications)
- Paystack secret key (for refunds)

---

## Testing

### Test `release-order`:
```bash
# Get rider JWT from rider-login first
curl -X POST https://verncapitxzsgcughvil.supabase.co/functions/v1/release-order \
  -H "Authorization: Bearer <RIDER_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"order_id":"<ORDER_UUID>","release_reason":"Vendor said 30 min wait"}'
```

### Test `cancel-order`:
```bash
# Get admin JWT from admin login first
curl -X POST https://verncapitxzsgcughvil.supabase.co/functions/v1/cancel-order \
  -H "Authorization: Bearer <ADMIN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"order_id":"<ORDER_UUID>","cancel_reason":"Customer requested cancellation"}'
```

### Test `verify-delivery`:
```bash
# Get rider JWT + order with delivery_code_hash set
curl -X POST https://verncapitxzsgcughvil.supabase.co/functions/v1/verify-delivery \
  -H "Authorization: Bearer <RIDER_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"order_id":"<ORDER_UUID>","delivery_code":"1234"}'
```

---

## Optional API Helpers

Thin client wrappers can be added to `src/lib/ordersApi.js` for future UI integration:

```javascript
// Example stubs (DO NOT add UI buttons yet — later story)

export async function releaseOrder(orderId, releaseReason) {
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  const res = await fetch(`${supabase.supabaseUrl}/functions/v1/release-order`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ order_id: orderId, release_reason: releaseReason }),
  });
  if (!res.ok) throw new Error((await res.json()).error);
  return res.json();
}

export async function cancelOrder(orderId, cancelReason) {
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  const res = await fetch(`${supabase.supabaseUrl}/functions/v1/cancel-order`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ order_id: orderId, cancel_reason: cancelReason }),
  });
  if (!res.ok) throw new Error((await res.json()).error);
  return res.json();
}

export async function verifyDelivery(orderId, deliveryCode) {
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  const res = await fetch(`${supabase.supabaseUrl}/functions/v1/verify-delivery`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ order_id: orderId, delivery_code: deliveryCode }),
  });
  if (!res.ok) throw new Error((await res.json()).error);
  return res.json();
}
```

**Note:** These helpers are production-shaped but NOT wired to any UI yet. ActiveOrderScreen CTAs and report-issue return links are a later story (Story 2/Phase 1).

---

## Next Steps

1. **Schema migration:** Ensure `delivery_code_hash` column exists on `orders` table (bcrypt)
2. **Customer app:** Generate and store delivery code hash at checkout
3. **Deploy functions:** Run deployment commands above
4. **Story 2:** Wire up UI (release button, cancel admin panel, delivery code input)
5. **Story 3:** WhatsApp notifications (customer + rider)
6. **Story 4:** Paystack refund integration
7. **Story 5:** Rider penalty system for late cancellations
