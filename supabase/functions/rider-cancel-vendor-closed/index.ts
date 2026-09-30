import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CANCEL_REASON =
  'Vendor closed — rider could not purchase food (order cancelled for customer)';

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function requireRider(
  req: Request,
  supabaseAdmin: SupabaseClient
): Promise<{ ok: true; profileId: string } | { ok: false; response: Response }> {
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

  return { ok: true, profileId: data.user.id };
}

async function ridersTableIdForProfile(
  supabaseAdmin: SupabaseClient,
  profileId: string
): Promise<string | null> {
  const { data: riderRow } = await supabaseAdmin
    .from('riders')
    .select('id')
    .eq('profile_id', profileId)
    .maybeSingle();
  return riderRow?.id ?? null;
}

// Rider-only: vendor closed before pickup → full cancel for customer + rider (status cancelled).
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

    const ridersId = await ridersTableIdForProfile(supabaseAdmin, riderCheck.profileId);
    if (!ridersId) {
      return jsonResponse(403, { error: 'Rider profile not found' });
    }

    const { order_id, note } = await req.json();

    if (!order_id) {
      return jsonResponse(400, { error: 'order_id is required' });
    }

    const { data: order, error: fetchError } = await supabaseAdmin
      .from('orders')
      .select('id, rider_id, status')
      .eq('id', order_id)
      .maybeSingle();

    if (fetchError || !order) {
      return jsonResponse(404, { error: 'Order not found' });
    }

    if (order.rider_id !== ridersId) {
      return jsonResponse(403, { error: 'You are not assigned to this order' });
    }

    if (order.status !== 'rider_assigned') {
      if (order.status === 'picked_up') {
        return jsonResponse(400, {
          error: 'Cannot cancel after pickup. Contact support.',
        });
      }
      if (order.status === 'cancelled') {
        return jsonResponse(400, { error: 'Order is already cancelled' });
      }
      return jsonResponse(400, {
        error: `Cannot cancel order in ${order.status} status`,
      });
    }

    const reason =
      note && typeof note === 'string' && note.trim()
        ? `${CANCEL_REASON}. Rider note: ${note.trim()}`
        : CANCEL_REASON;

    const { data: cancelled, error: updateError } = await supabaseAdmin
      .from('orders')
      .update({
        status: 'cancelled',
        rider_id: null,
        cancel_reason: reason,
      })
      .eq('id', order_id)
      .select()
      .single();

    if (updateError || !cancelled) {
      const msg = updateError?.message ?? '';
      if (/cancel_reason/i.test(msg)) {
        return jsonResponse(500, {
          error: 'Cancel failed — cancel_reason column may be missing. Run platform migrations.',
        });
      }
      return jsonResponse(500, { error: 'Failed to cancel order' });
    }

    await supabaseAdmin.from('order_issues').insert({
      order_id,
      rider_id: ridersId,
      description: reason,
    });

    return jsonResponse(200, { success: true, order: cancelled });
  } catch (err) {
    return jsonResponse(500, {
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});
