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
// Returns either the admin's user id or a ready-to-send error Response.
async function requireAdmin(
  req: Request,
  supabaseAdmin: SupabaseClient
): Promise<{ ok: true; adminId: string } | { ok: false; response: Response }> {
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  // The public anon key is NOT an admin token — treat missing/invalid tokens the same.
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const {
      full_name,
      phone,
      pin,
      photo_url,
      transport_type,
      ghana_card_number,
      home_area,
      emergency_contact_name,
      emergency_contact_phone,
      deposit_amount,
    } = await req.json();

    if (!full_name || !phone || !pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      return jsonResponse(400, {
        error: 'full_name, phone, and a 4-digit numeric pin are required',
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // SECURITY MODEL:
    //  - Caller with a valid ADMIN JWT  -> rider is created approved (in-person onboarding).
    //  - Anyone else (public self-apply) -> rider is created PENDING. The auth account
    //    exists but riderAuth.js blocks login until is_approved flips to true, so an
    //    anonymous caller can no longer mint a working rider account.
    const adminCheck = await requireAdmin(req, supabaseAdmin);
    const isApprovedByAdmin = adminCheck.ok;

    // Riders never see this — they only ever type their phone + 4-digit PIN.
    // We turn that into a real password Supabase Auth will accept.
    const syntheticEmail = `${phone.trim()}@riders.waakyeplug.app`;
    const realPassword = `${pin}${phone.trim().slice(-4)}`;

    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: syntheticEmail,
      password: realPassword,
      email_confirm: true,
    });

    if (authError) {
      return jsonResponse(400, { error: authError.message });
    }

    const { error: profileError } = await supabaseAdmin.from('profiles').insert({
      id: authUser.user.id,
      full_name,
      phone: phone.trim(),
      email: syntheticEmail,
      role: 'rider',
    });

    if (profileError) {
      await supabaseAdmin.auth.admin.deleteUser(authUser.user.id);
      return jsonResponse(400, { error: profileError.message });
    }

    const { data: rider, error: riderError } = await supabaseAdmin
      .from('riders')
      .insert({
        profile_id: authUser.user.id,
        status: isApprovedByAdmin ? 'approved' : 'pending',
        is_approved: isApprovedByAdmin,
        photo_url,
        transport_type,
        ghana_card_number,
        home_area,
        emergency_contact_name,
        emergency_contact_phone,
        deposit_amount: deposit_amount ?? 0,
        deposit_collected_at:
          isApprovedByAdmin && deposit_amount ? new Date().toISOString() : null,
      })
      .select()
      .single();

    if (riderError) {
      await supabaseAdmin.auth.admin.deleteUser(authUser.user.id);
      return jsonResponse(400, { error: riderError.message });
    }

    return jsonResponse(200, {
      success: true,
      rider,
      approved: isApprovedByAdmin,
      message: isApprovedByAdmin
        ? undefined
        : 'Application received — pending admin approval before login works.',
    });
  } catch (err) {
    return jsonResponse(500, {
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});
