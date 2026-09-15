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

// Verifies the caller's JWT. Riders may only verify their own settlements;
// admins may verify any. Returns caller identity or an error Response.
async function requireRiderOrAdmin(
  req: Request,
  supabaseAdmin: SupabaseClient
): Promise<{ ok: true; role: 'rider' | 'admin'; userId: string } | { ok: false; response: Response }> {
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

  if (profileError || !profile || (profile.role !== 'admin' && profile.role !== 'rider')) {
    return { ok: false, response: jsonResponse(403, { error: 'Rider or admin access required' }) };
  }

  return { ok: true, role: profile.role, userId: data.user.id };
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

    // Auth FIRST — before any DB read or Paystack call.
    const gate = await requireRiderOrAdmin(req, supabaseAdmin);
    if (!gate.ok) return gate.response;

    const { reference } = await req.json();
    if (!reference) {
      return jsonResponse(400, { error: 'reference is required' });
    }

    // The rider_id is NEVER taken from the body — it comes from the
    // settlement row the reference points at. Callers can't pay someone
    // else's (or a nonexistent) settlement by editing the payload.
    const { data: settlement, error: settlementError } = await supabaseAdmin
      .from('rider_settlements')
      .select('id, status, total_commission_owed, rider_id, riders(profile_id)')
      .eq('paystack_reference', reference)
      .maybeSingle();

    if (settlementError || !settlement) {
      return jsonResponse(404, { error: 'No matching settlement record found for this reference' });
    }

    const ownerProfileId = Array.isArray(settlement.riders)
      ? (settlement.riders[0] as { profile_id: string } | undefined)?.profile_id
      : (settlement.riders as unknown as { profile_id: string } | null)?.profile_id;

    if (
      gate.role !== 'admin' &&
      ownerProfileId !== gate.userId
    ) {
      return jsonResponse(403, { error: 'This settlement belongs to a different rider' });
    }

    const riderId = settlement.rider_id;

    const paystackSecret = Deno.env.get('PAYSTACK_SECRET_KEY');
    const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${paystackSecret}` },
    });
    const verifyData = await verifyRes.json();

    if (!verifyData.status || verifyData.data?.status !== 'success') {
      return jsonResponse(400, { error: 'Payment could not be verified as successful' });
    }

    const amountPaidGHS = verifyData.data.amount / 100;

    if (settlement.status === 'paid') {
      return jsonResponse(200, { success: true, already_processed: true });
    }

    const owed = Number(settlement.total_commission_owed);
    if (amountPaidGHS + 0.5 < owed) {
      return jsonResponse(400, { error: 'Amount paid does not match commission owed' });
    }

    const { error: settleUpdateError } = await supabaseAdmin
      .from('rider_settlements')
      .update({ status: 'paid', paid_at: new Date().toISOString() })
      .eq('id', settlement.id)
      .eq('status', 'pending');

    if (settleUpdateError) {
      return jsonResponse(500, { error: settleUpdateError.message });
    }

    const { error: resetError } = await supabaseAdmin
      .from('riders')
      .update({ commission_owed: 0, last_settled_at: new Date().toISOString() })
      .eq('id', riderId);

    if (resetError) {
      return jsonResponse(500, { error: `Payment verified but could not reset commission: ${resetError.message}` });
    }

    return jsonResponse(200, { success: true });
  } catch (err) {
    return jsonResponse(500, {
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});
