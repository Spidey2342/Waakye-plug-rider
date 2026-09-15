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

// Strips spaces/hyphens so a rider typing "0244 123 456" still matches a
// profile stored as "0244123456". Only used for LOOKUP — the auth account
// itself is always reconstructed from the phone stored in the DB.
function normalizePhone(phone: string): string {
  return phone.replace(/[\s-]/g, '');
}

function clientIp(req: Request): string {
  return (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim();
}

// Verifies a rider's phone + PIN entirely server-side and returns a real
// Supabase session. Replaces the old client-side signInWithPassword, which
// let anyone script 4-digit PIN guesses with the public anon key (audit S1).
//
// Rate limits (DB-backed, atomic — see 2026-09-12_pin_rate_limits.sql):
//   - per phone:  5 failed attempts / 15 min -> 15 min lockout
//   - per IP:    20 failed attempts / 15 min -> 15 min lockout
// The IP bucket is NOT cleared on success: an attacker who knows one valid
// credential can't use it to reset their IP budget while probing others.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { phone, pin } = await req.json();

    if (!phone || typeof phone !== 'string' || !pin || !/^\d{4}$/.test(pin)) {
      return jsonResponse(400, { error: 'Phone number and 4-digit PIN are required' });
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Anon-role client for the actual password check — keeps Supabase Auth's
    // own counting meaningful and never leaks service-role into a session.
    const supabaseAnon = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!
    );

    const ip = clientIp(req);
    const phoneKey = normalizePhone(phone);
    const genericFailure = { error: 'Incorrect phone number or PIN' };

    // ---- Per-IP throttle (loose cap, catches distributed phone probing) ----
    const ipCheck = await supabaseAdmin.rpc('begin_auth_attempt', {
      p_bucket: `login-ip:${ip}`,
      p_max_attempts: 20,
      p_window_minutes: 15,
      p_lockout_minutes: 15,
    });
    if (ipCheck.error || !ipCheck.data?.allowed) {
      return jsonResponse(429, {
        error: `Too many attempts. Try again in ${Math.ceil((ipCheck.data?.retry_after_sec ?? 900) / 60)} minutes.`,
        retry_after_sec: ipCheck.data?.retry_after_sec ?? 900,
      });
    }

    // ---- Per-phone throttle (the actual PIN brute-force guard) ----
    // Checked BEFORE the profile lookup so even unknown-phone spam gets
    // locked out after 5 attempts, not just known-phone PIN guessing.
    // begin() itself only reads counts — recording happens on failure.
    const phoneCheck = await supabaseAdmin.rpc('begin_auth_attempt', {
      p_bucket: `login:${phoneKey}`,
      p_max_attempts: 5,
      p_window_minutes: 15,
      p_lockout_minutes: 15,
    });
    if (phoneCheck.error || !phoneCheck.data?.allowed) {
      return jsonResponse(429, {
        error: `Too many incorrect attempts. Try again in ${Math.ceil((phoneCheck.data?.retry_after_sec ?? 900) / 60)} minutes.`,
        retry_after_sec: phoneCheck.data?.retry_after_sec ?? 900,
      });
    }

    // ---- Find the rider profile (exact match first, then stripped) ----
    let profile: { id: string; phone: string } | null = null;
    for (const candidate of [phone.trim(), phoneKey]) {
      const { data } = await supabaseAdmin
        .from('profiles')
        .select('id, phone')
        .eq('phone', candidate)
        .eq('role', 'rider')
        .limit(1)
        .maybeSingle();
      if (data) {
        profile = data;
        break;
      }
    }

    if (!profile) {
      await supabaseAdmin.rpc('record_auth_failure', { p_bucket: `login-ip:${ip}` });
      await supabaseAdmin.rpc('record_auth_failure', { p_bucket: `login:${phoneKey}` });
      return jsonResponse(401, genericFailure);
    }

    // ---- Verify the PIN ----
    // Same synthetic-identity formula the app has always used
    // (add-rider builds it identically), but reconstructed from the phone
    // STORED in the DB so formatting differences in the rider's input
    // can't break the check.
    const storedPhone = profile.phone.trim();
    const syntheticEmail = `${storedPhone}@riders.waakyeplug.app`;
    const realPassword = `${pin}${storedPhone.slice(-4)}`;

    const { data: authData, error: authError } = await supabaseAnon.auth.signInWithPassword({
      email: syntheticEmail,
      password: realPassword,
    });

    if (authError || !authData?.session) {
      await supabaseAdmin.rpc('record_auth_failure', { p_bucket: `login:${phoneKey}` });
      await supabaseAdmin.rpc('record_auth_failure', { p_bucket: `login-ip:${ip}` });
      return jsonResponse(401, genericFailure);
    }

    // ---- Load the rider record ----
    const { data: rider, error: riderError } = await supabaseAdmin
      .from('riders')
      .select('*, profiles(full_name, phone)')
      .eq('profile_id', authData.user.id)
      .maybeSingle();

    if (riderError || !rider) {
      await supabaseAdmin.rpc('record_auth_failure', { p_bucket: `login:${phoneKey}` });
      await supabaseAdmin.rpc('record_auth_failure', { p_bucket: `login-ip:${ip}` });
      return jsonResponse(401, genericFailure);
    }

    if (!rider.is_approved) {
      // Correct PIN, but the account is still awaiting approval. Don't count
      // this as a failure, and sign the anon client's session back out.
      await supabaseAnon.auth.signOut();
      return jsonResponse(403, { error: 'Your account is pending approval' });
    }

    // ---- Success: reset the phone bucket, hand back the session ----
    await supabaseAdmin.rpc('clear_auth_failures', { p_bucket: `login:${phoneKey}` });

    return jsonResponse(200, {
      success: true,
      session: {
        access_token: authData.session.access_token,
        refresh_token: authData.session.refresh_token,
        expires_at: authData.session.expires_at,
      },
      rider,
    });
  } catch (err) {
    return jsonResponse(500, {
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});
