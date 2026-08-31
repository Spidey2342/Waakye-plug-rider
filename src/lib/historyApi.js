import { supabase } from './supabase';

// Every order this rider has ever finished handling — delivered or
// cancelled — most recent first. Active orders (still in progress) never
// show here; this is a record of what's already done.
export async function fetchOrderHistory(riderId) {
  const { data, error } = await supabase
    .from('orders')
    .select('id, status, total_amount, delivery_fee, created_at, delivered_at, vendors(business_name)')
    .eq('rider_id', riderId)
    .in('status', ['delivered', 'cancelled'])
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return data;
}