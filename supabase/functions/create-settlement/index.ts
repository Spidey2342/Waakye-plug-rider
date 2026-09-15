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

// Verifies the caller's JWT and resolves who is asking. Riders may only act
// on their own settlement; admins may act on any rider's.
// Returns either the caller's resolved rider_id or a ready-to-send error.
async function requireRiderOrAdmin(
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

  if (profileError || !profile) {
    return { ok: false, response: jsonResponse(403, { error: 'Profile not found' }) };
  }

  if (profile.role === 'admin') {
    // Admins settle on behalf of any rider — caller-supplied rider_id is trusted here.
    return { ok: true, riderId: '__admin__' };
  }

  if (profile.role !== 'rider') {
    return { ok: false, response: jsonResponse(403, { error: 'Rider access required' }) };
  }

  const { data: rider, error: riderError } = await supabaseAdmin
    .from('riders')
    .select('id')
    .eq('profile_id', data.user.id)
    .maybeSingle();

  if (riderError || !rider) {
    return { ok: false, response: jsonResponse(403, { error: 'No rider record for this account' }) };
  }

  return { ok: true, riderId: rider.id };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Auth FIRST — before any DB read, so anonymous probes learn nothing.
    const gate = await requireRiderOrAdmin(req, supabaseAdmin);
    if (!gate.ok) return gate.response;

    const { rider_id } = await req.json();

    // Riders can only create settlements for themselves — body rider_id ignored.
    const effectiveRiderId = gate.riderId === '__admin__' ? rider_id : gate.riderId;

    if (!effectiveRiderId) {
      return jsonResponse(400, { error: 'rider_id is required' });
    }

    const { data: rider, error: riderError } = await supabaseAdmin
      .from('riders')
      .select('commission_owed')
      .eq('id', effectiveRiderId)
      .single();

    if (riderError || !rider) {
      return jsonResponse(404, { error: 'Rider not found' });
    }

    const owed = Number(rider.commission_owed);
    if (owed <= 0) {
      return jsonResponse(400, { error: 'Nothing owed — no settlement needed' });
    }

    const reference = `settle_${effectiveRiderId.slice(0, 8)}_${Date.now()}`;

    const { error: insertError } = await supabaseAdmin.from('rider_settlements').insert({
      rider_id: effectiveRiderId,
      total_commission_owed: owed,
      paystack_reference: reference,
      status: 'pending',
    });

    if (insertError) {
      return jsonResponse(500, { error: insertError.message });
    }

    return jsonResponse(200, { reference, amount: owed });
  } catch (err) {
    return jsonResponse(500, {
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});
