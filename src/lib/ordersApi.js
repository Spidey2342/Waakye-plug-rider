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

// Safely claim an order: .is('rider_id', null) means this only succeeds if
// nobody beat them to it a second earlier. Empty result = lost the race.
export async function acceptOrder(orderId, riderId) {
  const { data, error } = await supabase
    .from('orders')
    .update({ rider_id: riderId, status: 'rider_assigned' })
    .eq('id', orderId)
    .is('rider_id', null)
    .select('*, vendors(business_name, location, phone)');

  if (error) throw new Error(error.message);
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