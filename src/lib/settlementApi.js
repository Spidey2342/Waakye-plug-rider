import { supabase } from './supabase';

export async function fetchTodaySettlementSummary(riderId) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from('orders')
    .select('total_amount, delivery_fee')
    .eq('rider_id', riderId)
    .eq('status', 'delivered')
    .gte('delivered_at', startOfDay.toISOString());

  if (error) throw new Error(error.message);

  const ordersCompleted = data.length;
  const totalCollected = data.reduce(
    (sum, o) => sum + Number(o.total_amount) + Number(o.delivery_fee),
    0
  );

  const { data: rider, error: riderError } = await supabase
    .from('riders')
    .select('commission_owed')
    .eq('id', riderId)
    .single();

  if (riderError) throw new Error(riderError.message);

  return {
    ordersCompleted,
    totalCollected,
    commissionOwed: Number(rider.commission_owed || 0),
  };
}

export async function verifySettlement(reference, riderId) {
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/verify-settlement`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ reference, rider_id: riderId }),
    }
  );

  const result = await res.json();
  if (!res.ok) throw new Error(result.error || 'Verification failed');
  return result;
}