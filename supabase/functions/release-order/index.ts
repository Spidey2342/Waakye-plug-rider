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

// Verifies the caller's JWT and returns the rider's profile ID.
async function requireRider(
  req: Request,
  supabaseAdmin: SupabaseClient
): Promise<{ ok: true; riderId: string } | { ok: false; response: Response }> {
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

  if (profileError || !profile || profile.role !== 'rider') {
    return { ok: false, response: jsonResponse(403, { error: 'Rider access required' }) };
  }

  return { ok: true, riderId: data.user.id };
}

// Allows a rider to release (unassign themselves from) an order they've
// accepted but haven't picked up yet. This is the escape hatch for cases
// where a rider realizes they can't make it to the vendor, or the vendor
// tells them the order won't be ready for a long time.
//
// Product rules (locked):
// 1. Rider must own the order (rider_id matches)
// 2. Status must be exactly `rider_assigned` (NOT picked_up)
// 3. On success: status -> `available`, rider_id -> null
// 4. Optional release_reason field (for analytics / future admin visibility)
// 5. May insert/update order_issues note with the reason
//
// What this does NOT do (intentionally):
// - Does not allow releasing after pickup (picked_up status blocks it)
// - Does not notify customer (WhatsApp notification is a later story)
// - Does not penalize the rider (penalty/rating system TBD)
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const riderCheck = await requireRider(req, supabaseAdmin);
    if (!riderCheck.ok) return riderCheck.response;

    const { order_id, release_reason } = await req.json();

    if (!order_id) {
      return jsonResponse(400, { error: 'order_id is required' });
    }

    // First verify ownership and current status before making any changes.
    const { data: order, error: fetchError } = await supabaseAdmin
      .from('orders')
      .select('id, rider_id, status')
      .eq('id', order_id)
      .maybeSingle();

    if (fetchError || !order) {
      return jsonResponse(404, { error: 'Order not found' });
    }

    if (order.rider_id !== riderCheck.riderId) {
      return jsonResponse(403, { error: 'You are not assigned to this order' });
    }

    if (order.status !== 'rider_assigned') {
      if (order.status === 'picked_up') {
        return jsonResponse(400, {
          error: 'Cannot release order after pickup. Please contact support if you need to cancel.'
        });
      }
      return jsonResponse(400, {
        error: `Cannot release order in ${order.status} status`
      });
    }

    // Status and ownership are valid — release the order back to the pool.
    const { data: released, error: updateError } = await supabaseAdmin
      .from('orders')
      .update({
        status: 'available',
        rider_id: null,
      })
      .eq('id', order_id)
      .select()
      .single();

    if (updateError || !released) {
      return jsonResponse(500, { error: 'Failed to release order' });
    }

    // If a reason was provided, record it in order_issues for admin visibility
    // and future analytics. This is best-effort — don't fail the release if
    // the issue insert fails.
    if (release_reason && typeof release_reason === 'string' && release_reason.trim()) {
      await supabaseAdmin
        .from('order_issues')
        .insert({
          order_id: order_id,
          rider_id: riderCheck.riderId,
          description: `Rider released order: ${release_reason.trim()}`,
        });
    }

    return jsonResponse(200, { success: true, order: released });
  } catch (err) {
    return jsonResponse(500, {
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});
