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
// 3. Sets status to `cancelled`, clears rider_id, records cancel_reason
// 4. STUB ONLY: customer WhatsApp notification, refund logic, and
//    next-order delivery-fee percentage charge are TODO (see inline comments)
//
// What this does NOT yet do (intentionally stubbed for later stories):
// - Customer WhatsApp notification (TODO: integrate WhatsApp Business API)
// - Paystack refund logic (TODO: wire Paystack refund API)
// - Delivery fee percentage penalty on rider's next order (TODO: determine %)
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
      .select('id, status, rider_id, customer_id, total')
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

    // Cancel the order: set status, clear rider assignment, record reason
    const { data: cancelled, error: updateError } = await supabaseAdmin
      .from('orders')
      .update({
        status: 'cancelled',
        rider_id: null,
        cancel_reason: cancel_reason.trim(),
      })
      .eq('id', order_id)
      .select()
      .single();

    if (updateError || !cancelled) {
      return jsonResponse(500, { error: 'Failed to cancel order' });
    }

    // TODO (Story 2/3): Send WhatsApp notification to customer
    // - Fetch customer phone from profiles or orders.customer_phone
    // - Use WhatsApp Business API or Twilio to send cancellation notice
    // - Include cancel_reason in message if customer-facing
    // - Best-effort: don't block cancellation if WhatsApp send fails

    // TODO (Story 2/3): Process refund via Paystack
    // - Fetch payment reference from order or payments table
    // - Call Paystack refund API with reference and amount
    // - Handle partial refund logic if delivery was in progress
    // - Record refund status in database (consider a refunds table)
    // - Handle refund failures gracefully (alert admin, don't block cancel)

    // TODO (Story 2/3): Apply delivery fee percentage penalty to rider's next order
    // - Only if order was rider_assigned or picked_up (rider was involved)
    // - Determine percentage (e.g., 20%, 50%, 100% of delivery fee?)
    // - Record penalty in riders table or a rider_penalties table
    // - Next order acceptance should check for pending penalties and apply
    // - Consider: does penalty expire? Per-rider cap on penalties?

    // For now, just return success with a note about the pending integrations
    return jsonResponse(200, {
      success: true,
      order: cancelled,
      pending_actions: {
        customer_notification: 'WhatsApp notification not yet implemented',
        refund: 'Paystack refund integration pending',
        rider_penalty: order.rider_id
          ? 'Delivery fee penalty on next order not yet implemented'
          : null,
      },
    });
  } catch (err) {
    return jsonResponse(500, {
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});
