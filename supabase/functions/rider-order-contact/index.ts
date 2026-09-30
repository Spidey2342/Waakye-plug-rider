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

async function customerContactForOrder(
  supabaseAdmin: SupabaseClient,
  customerId: string | null
): Promise<{ full_name: string | null; phone: string | null } | null> {
  if (!customerId) return null;
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('full_name, phone')
    .eq('id', customerId)
    .maybeSingle();
  if (!profile?.phone && !profile?.full_name) return null;
  return { full_name: profile.full_name ?? null, phone: profile.phone ?? null };
}

// Returns customer name + phone for an order the rider is currently assigned to (service role — bypasses profile RLS).
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

    const { order_id } = await req.json();
    if (!order_id) {
      return jsonResponse(400, { error: 'order_id is required' });
    }

    const { data: order, error: fetchError } = await supabaseAdmin
      .from('orders')
      .select('id, rider_id, customer_id, status')
      .eq('id', order_id)
      .maybeSingle();

    if (fetchError || !order) {
      return jsonResponse(404, { error: 'Order not found' });
    }

    if (order.rider_id !== ridersId) {
      return jsonResponse(403, { error: 'You are not assigned to this order' });
    }

    const customer = await customerContactForOrder(supabaseAdmin, order.customer_id);
    if (!customer?.phone) {
      return jsonResponse(404, { error: 'Customer phone not on file for this order' });
    }

    return jsonResponse(200, { customer });
  } catch (err) {
    return jsonResponse(500, {
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});
