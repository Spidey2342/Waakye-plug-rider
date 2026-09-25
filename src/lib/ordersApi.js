import { supabase } from './supabase';

// Order selects use `*` so delivery_lat / delivery_lng (customer pin coords
// written by the customer app at checkout) are included once those columns
// exist in production. Older orders without them leave the fields undefined
// — ActiveOrderScreen falls back to Nominatim geocode of delivery_address.
// Do not list delivery_lat/lng explicitly: missing columns would break the
// whole select before the customer-app migration lands.

// Vendor fields every order query needs: latitude/longitude are the real
// GPS coordinates a vendor can set from their Settings tab ("Use My
// Current Location"). When present, the rider app should use them
// directly instead of re-geocoding the free-text `location` string —
// geocoding a short/ambiguous address is what previously sent a rider's
// map halfway across the world. `location` is kept as a fallback for
// vendors who haven't set precise coordinates yet, and for display.
const VENDOR_FIELDS = 'business_name, location, latitude, longitude, phone';

// Orders a rider can see and accept: unassigned and still in the
// available pool. Canonical status enum no longer includes legacy
// `ready` (DB CHECK: available | rider_assigned | picked_up | delivered | cancelled).
export async function fetchAvailableOrders() {
  const { data, error } = await supabase
    .from('orders')
    .select(`*, vendors(${VENDOR_FIELDS})`)
    .eq('status', 'available')
    .is('rider_id', null)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  return data;
}

// Whatever order this rider is currently mid-delivery on, if any — used on
// login/session-restore so a page refresh (or a re-login) sends the rider
// straight back into ActiveOrderScreen instead of back to the Available
// Orders list. Without this, a rider could try to accept a second order
// while still assigned to one, which the DB correctly rejects (see the
// riders_one_active_order unique constraint) but with a raw, ugly error.
export async function fetchActiveOrderForRider(riderId) {
  const { data, error } = await supabase
    .from('orders')
    .select(`*, vendors(${VENDOR_FIELDS})`)
    .eq('rider_id', riderId)
    .in('status', ['rider_assigned', 'picked_up'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

// Safely claim an order: only succeeds if the row is still `available` AND
// nobody else took it (rider_id IS NULL). Empty result = lost the race or
// the order left the pool (cancelled / already assigned).
export async function acceptOrder(orderId, riderId) {
  const { data, error } = await supabase
    .from('orders')
    .update({ rider_id: riderId, status: 'rider_assigned' })
    .eq('id', orderId)
    .eq('status', 'available')
    .is('rider_id', null)
    .select(`*, vendors(${VENDOR_FIELDS})`);

  if (error) {
    // Postgres error code 23505 = unique_violation. The DB enforces "one
    // active order per rider" via the riders_one_active_order constraint;
    // surfacing the raw constraint name to the rider is confusing, so we
    // translate it into something they can act on.
    if (error.code === '23505' || /riders_one_active_order/i.test(error.message)) {
      throw new Error('You already have an order in progress. Finish or cancel it before accepting another.');
    }
    throw new Error(error.message);
  }
  if (!data || data.length === 0) {
    throw new Error('This order is no longer available.');
  }
  return data[0];
}

export async function markPickedUp(orderId) {
  const { data, error } = await supabase
    .from('orders')
    .update({ status: 'picked_up' })
    .eq('id', orderId)
    .select(`*, vendors(${VENDOR_FIELDS})`)
    .single();

  if (error) throw new Error(error.message);
  return data;
}

// Marking delivered is what fires the commission trigger already set up
// in the database — no commission math needs to happen in this app code.
export async function markDelivered(orderId) {
  const { data, error } = await supabase
    .from('orders')
    .update({ status: 'delivered' })
    .eq('id', orderId)
    .select(`*, vendors(${VENDOR_FIELDS})`)
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function setRiderOnlineStatus(riderId, isOnline) {
  const { error } = await supabase
    .from('riders')
    .update({ is_online: isOnline })
    .eq('id', riderId);

  if (error) throw new Error(error.message);
}

// Persists this rider's live GPS position so anything else on the platform
// (a customer "where's my rider" map, a vendor dashboard, an admin view)
// can actually read where the rider is. Previously the app only ever kept
// this in local React state during an active delivery — it was never
// written to the database, so nothing outside this one browser tab could
// ever see it. Call this on a throttle (every 5-10s), not on every GPS tick.
export async function updateRiderLocation(riderId, lat, lng) {
  if (!riderId || lat == null || lng == null) return;

  const { error } = await supabase
    .from('riders')
    .update({
      current_lat: lat,
      current_lng: lng,
      location_updated_at: new Date().toISOString(),
    })
    .eq('id', riderId);

  // Location pings are best-effort — a rare failed write shouldn't
  // interrupt the rider's delivery flow, so we log rather than throw.
  if (error) console.warn('Failed to sync rider location:', error.message);
}

// ---- Story 1 / Phase 0: Order lifecycle edge function wrappers ----
// These call the new edge functions (release-order, cancel-order, verify-delivery).
// NOT wired to any UI yet — ActiveOrderScreen CTAs and admin panel are Story 2.
// Production-shaped but stubbed for future integration.

// Allows a rider to release (unassign) themselves from an order they've
// accepted but haven't picked up yet. Calls the release-order edge function.
export async function releaseOrder(orderId, releaseReason) {
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;
  if (!token) throw new Error('Not authenticated');

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/release-order`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ order_id: orderId, release_reason: releaseReason }),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to release order');
  }

  return res.json();
}

// Admin-only cancellation. Calls the cancel-order edge function.
export async function cancelOrder(orderId, cancelReason) {
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;
  if (!token) throw new Error('Not authenticated');

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cancel-order`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ order_id: orderId, cancel_reason: cancelReason }),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to cancel order');
  }

  return res.json();
}

// Verifies delivery by comparing the customer's 4-digit code against the
// hashed version stored at checkout. Calls the verify-delivery edge function.
// Rate-limited (5 wrong attempts per order per 15 minutes).
export async function verifyDelivery(orderId, deliveryCode) {
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;
  if (!token) throw new Error('Not authenticated');

  const res = await fetch(`${supabase.supabaseUrl}/functions/v1/verify-delivery`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ order_id: orderId, delivery_code: deliveryCode }),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to verify delivery');
  }

  return res.json();
}