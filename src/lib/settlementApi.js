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

// Both settlement endpoints verify a REAL user JWT (the anon key is rejected
// with 401). Riders may only create/verify settlements for themselves; admins
// for anyone. The server derives identity from the token — body rider_id is
// advisory at best, so we don't rely on it.
async function getBearer() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Not signed in — please log in again');
  }
  return session.access_token;
}

export async function verifySettlement(reference) {
  const token = await getBearer();
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/verify-settlement`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ reference }),
    }
  );

  const result = await res.json();
  if (!res.ok) throw new Error(result.error || 'Verification failed');
  return result;
}

export async function createSettlementIntent() {
  const token = await getBearer();
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-settlement`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({}),
    }
  );

  const result = await res.json();
  if (!res.ok) throw new Error(result.error || 'Could not start settlement');
  return result;
}