import { supabase } from './supabase';

// Orders a rider can see and accept: no rider assigned yet, vendor has
// marked them ready (covers your original 'ready' rows and new 'available' ones).
export async function fetchAvailableOrders() {
  const { data, error } = await supabase
    .from('orders')
    .select('*, vendors(business_name, location, phone)')
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
    .select('*, vendors(business_name, location, phone)')
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
    .select('*, vendors(business_name, location, phone)');

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
    .select('*, vendors(business_name, location, phone)')
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
    .select('*, vendors(business_name, location, phone)')
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