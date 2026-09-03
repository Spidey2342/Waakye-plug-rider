import { supabase } from './supabase';

export async function reportIssue(orderId, riderId, description) {
  const { error } = await supabase
    .from('order_issues')
    .insert({ order_id: orderId, rider_id: riderId, description });

  if (error) throw new Error(error.message);
}