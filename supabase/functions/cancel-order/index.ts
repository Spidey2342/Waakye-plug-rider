import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Verifies the caller's JWT and confirms they hold an admin profile.
async function requireAdmin(
  req: Request,
  supabaseAdmin: SupabaseClient
): Promise<{ ok: true; adminId: string } | { ok: false; response: Response }> {
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!token) {
    return { ok: false, response: jsonResponse(401, { error: 'Missing authorization token' }) };
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) {
    return { ok: false, response: jsonResponse(401, { error: 'Invalid or expired token' }) };
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', data.user.id)
    .maybeSingle();

  if (profileError || !profile || profile.role !== 'admin') {
    return { ok: false, response: jsonResponse(403, { error: 'Admin access required' }) };
  }

  return { ok: true, adminId: data.user.id };
}

// Admin-only order cancellation. Handles customer-initiated cancellations,
// vendor unavailability, payment issues, or any other case where an order
// can't proceed. This is the controlled path for cancellation — direct
// PostgREST writes are blocked by RLS.
//
// Product rules (locked):
// 1. Admin JWT required
// 2. Allowed statuses: available | rider_assigned | picked_up
// 3. Sets status to `cancelled`, clears rider_id, records cancel_reason,
//    cancelled_at, and cancelled_by (admin user id)
// 4. If previous status was `picked_up`: adds 0.70 * COALESCE(delivery_fee, 8)
//    to customer's profiles.pending_delivery_fee_owed (customer debt, NOT rider penalty)
// 5. Returns debt_added amount and pending_actions (WhatsApp notify, manual MoMo refund)
//
// What this does NOT do (intentionally):
// - Paystack refund (orders are cash/momo with no Paystack charge on this platform)
// - WhatsApp notification (TODO: integrate WhatsApp Business API when credentials available)
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const adminCheck = await requireAdmin(req, supabaseAdmin);
    if (!adminCheck.ok) return adminCheck.response;

    const { order_id, cancel_reason } = await req.json();

    if (!order_id) {
      return jsonResponse(400, { error: 'order_id is required' });
    }

    if (!cancel_reason || typeof cancel_reason !== 'string' || !cancel_reason.trim()) {
      return jsonResponse(400, { error: 'cancel_reason is required' });
    }

    // Fetch the order to verify status and get customer info for notifications
    const { data: order, error: fetchError } = await supabaseAdmin
      .from('orders')
      .select('id, status, rider_id, customer_id, total_amount, delivery_fee, payment_method')
      .eq('id', order_id)
      .maybeSingle();

    if (fetchError || !order) {
      return jsonResponse(404, { error: 'Order not found' });
    }

    // Validate that the order is in a cancellable state
    const cancellableStatuses = ['available', 'rider_assigned', 'picked_up'];
    if (!cancellableStatuses.includes(order.status)) {
      return jsonResponse(400, {
        error: `Cannot cancel order in ${order.status} status. Only available, rider_assigned, or picked_up orders can be cancelled.`
      });
    }

    // Cancel the order: set status, clear rider assignment, record reason and timestamp
    const { data: cancelled, error: updateError } = await supabaseAdmin
      .from('orders')
      .update({
        status: 'cancelled',
        rider_id: null,
        cancel_reason: cancel_reason.trim(),
        cancelled_at: new Date().toISOString(),
        cancelled_by: adminCheck.adminId,
      })
      .eq('id', order_id)
      .select()
      .single();

    if (updateError || !cancelled) {
      return jsonResponse(500, { error: 'Failed to cancel order' });
    }

    // Customer debt logic: if order was picked_up when cancelled, customer owes
    // 70% of delivery fee (as defined in locked rules). This compensates the
    // rider for time/fuel spent on partial delivery. Customer debt is tracked
    // in profiles.pending_delivery_fee_owed for later settlement/deduction.
    let debtAdded = 0;
    if (order.status === 'picked_up' && order.customer_id) {
      const deliveryFee = Number(order.delivery_fee ?? 8);
      const debtAmount = 0.70 * deliveryFee;
      
      const { error: debtError } = await supabaseAdmin.rpc('increment', {
        table_name: 'profiles',
        column_name: 'pending_delivery_fee_owed',
        row_id: order.customer_id,
        increment_value: debtAmount,
      }).single();

      // If the RPC doesn't exist, fall back to a direct update
      if (debtError?.code === '42883') {
        const { error: directDebtError } = await supabaseAdmin
          .from('profiles')
          .update({
            pending_delivery_fee_owed: supabaseAdmin.raw(`COALESCE(pending_delivery_fee_owed, 0) + ${debtAmount}`),
          })
          .eq('id', order.customer_id);

        if (!directDebtError) {
          debtAdded = debtAmount;
        }
      } else if (!debtError) {
        debtAdded = debtAmount;
      }
    }

    // TODO: Send WhatsApp notification to customer
    // - Fetch customer phone from profiles or orders.customer_phone
    // - Use WhatsApp Business API to send cancellation notice
    // - Include cancel_reason if customer-facing
    // - Best-effort: don't block cancellation if WhatsApp send fails

    return jsonResponse(200, {
      success: true,
      order: cancelled,
      debt_added: debtAdded,
      pending_actions: {
        notify_customer: order.payment_method === 'momo' && order.status === 'picked_up'
          ? 'Manual MoMo refund may be needed (70% delivery fee charged as customer debt)'
          : 'Customer notification pending (WhatsApp not yet wired)',
        notify_whatsapp: 'pending',
      },
    });
  } catch (err) {
    return jsonResponse(500, {
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});
