import { supabase } from './supabase';

// Vendor fields every order query needs: latitude/longitude are the real
// GPS coordinates a vendor can set from their Settings tab ("Use My
// Current Location"). When present, the rider app should use them
// directly instead of re-geocoding the free-text `location` string —
// geocoding a short/ambiguous address is what previously sent a rider's
// map halfway across the world. `location` is kept as a fallback for
// vendors who haven't set precise coordinates yet, and for display.
const VENDOR_FIELDS = 'business_name, location, latitude, longitude, phone';

// Orders a rider can see and accept: no rider assigned yet, vendor has
// marked them ready (covers your original 'ready' rows and new 'available' ones).
export async function fetchAvailableOrders() {
  const { data, error } = await supabase
    .from('orders')
    .select(`*, vendors(${VENDOR_FIELDS})`)
    .in('status', ['ready', 'available'])
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

// Safely claim an order: .is('rider_id', null) means this only succeeds if
// nobody beat them to it a second earlier. Empty result = lost the race.
export async function acceptOrder(orderId, riderId) {
  const { data, error } = await supabase
    .from('orders')
    .update({ rider_id: riderId, status: 'rider_assigned' })
    .eq('id', orderId)
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
    throw new Error('This order was just accepted by another rider.');
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