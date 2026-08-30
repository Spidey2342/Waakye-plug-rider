import { supabase } from './supabase';

export async function fetchTodayEarnings(riderId) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from('orders')
    .select('delivery_fee')
    .eq('rider_id', riderId)
    .eq('status', 'delivered')
    .gte('delivered_at', startOfDay.toISOString());

  if (error) throw new Error(error.message);
  return data.reduce((sum, o) => sum + Number(o.delivery_fee || 0), 0);
}

export async function fetchCommissionOwed(riderId) {
  const { data, error } = await supabase
    .from('riders')
    .select('commission_owed, last_settled_at')
    .eq('id', riderId)
    .single();

  if (error) throw new Error(error.message);
  return { commissionOwed: Number(data.commission_owed || 0), lastSettledAt: data.last_settled_at };
}

export async function fetchRecentDeliveries(riderId, limit = 10) {
  const { data, error } = await supabase
    .from('orders')
    .select('id, delivery_fee, delivered_at, vendors(business_name)')
    .eq('rider_id', riderId)
    .eq('status', 'delivered')
    .order('delivered_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return data;
}