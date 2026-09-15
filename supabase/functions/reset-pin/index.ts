import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Strips spaces/hyphens so formatting differences don't dodge the rate limiter
// ("0244 123 456" and "0244123456" must hit the same bucket).
function normalizePhone(phone: string): string {
  return phone.replace(/[\s-]/g, '');
}

function clientIp(req: Request): string {
  return (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { phone, ghana_card_number, new_pin } = await req.json();

    // Stricter PIN rules (audit S2): 4 digits, and block the trivial ones
    // (repeats like 1111 and runs like 1234/4321) that bots try first.
    if (
      !phone || typeof phone !== 'string' ||
      !ghana_card_number || typeof ghana_card_number !== 'string' ||
      !new_pin || !/^\d{4}$/.test(new_pin) ||
      /^(\d)\1{3}$/.test(new_pin) ||
      '0123456789'.includes(new_pin) ||
      '9876543210'.includes(new_pin)
    ) {
      return new Response(
        JSON.stringify({ error: 'Phone, Ghana Card number, and a new 4-digit PIN are all required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // ---- Rate limiting (audit S2 — previously there was none) ----
    // Per phone: 3 failed verifications / 15 min -> 15 min lockout.
    // Per IP:    10 failed verifications / 15 min -> 15 min lockout.
    // The per-phone bucket is keyed on normalized phone so the limiter can't
    // be sidestepped by reformatting the number.
    const ip = clientIp(req);
    const phoneKey = normalizePhone(phone);
    const genericFailure = { error: 'We could not verify those details.' };

    const beginChecks = [
      { bucket: `reset-ip:${ip}`, max: 10 },
      { bucket: `reset:${phoneKey}`, max: 3 },
    ];
    for (const check of beginChecks) {
      const { data: gate, error: gateError } = await supabaseAdmin.rpc('begin_auth_attempt', {
        p_bucket: check.bucket,
        p_max_attempts: check.max,
        p_window_minutes: 15,
        p_lockout_minutes: 15,
      });
      if (gateError || !gate?.allowed) {
        return new Response(
          JSON.stringify({
            error: `Too many attempts. Try again in ${Math.ceil((gate?.retry_after_sec ?? 900) / 60)} minutes.`,
            retry_after_sec: gate?.retry_after_sec ?? 900,
          }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }


    // Find the profile by phone, then the rider record, and check the
    // Ghana Card number matches — this pair is the identity check standing
    // in for "prove you're really this rider" since there's no real email
    // or SMS OTP path available here.
    let profile: { id: string; full_name: string; phone: string } | null = null;
    for (const candidate of [phone.trim(), phoneKey]) {
      const { data } = await supabaseAdmin
        .from('profiles')
        .select('id, full_name, phone')
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
      await supabaseAdmin.rpc('record_auth_failure', { p_bucket: `reset:${phoneKey}` });
      await supabaseAdmin.rpc('record_auth_failure', { p_bucket: `reset-ip:${ip}` });
      return new Response(
        JSON.stringify(genericFailure),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: rider, error: riderError } = await supabaseAdmin
      .from('riders')
      .select('id, ghana_card_number')
      .eq('profile_id', profile.id)
      .maybeSingle();

    const cardMatches =
      rider?.ghana_card_number &&
      rider.ghana_card_number.trim().toLowerCase() === ghana_card_number.trim().toLowerCase();

    if (riderError || !rider || !cardMatches) {
      await supabaseAdmin.rpc('record_auth_failure', { p_bucket: `reset:${phoneKey}` });
      await supabaseAdmin.rpc('record_auth_failure', { p_bucket: `reset-ip:${ip}` });
      return new Response(
        JSON.stringify(genericFailure),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Same password formula used everywhere else — PIN + last 4 digits of phone.
    // Built from the phone STORED in the DB (matches add-rider/rider-login),
    // not the raw user input, so formatting can't desync the auth account.
    const newPassword = `${new_pin}${profile.phone.trim().slice(-4)}`;

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(profile.id, {
      password: newPassword,
    });

    if (updateError) {
      return new Response(
        JSON.stringify({ error: updateError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Identity proven + PIN updated — clear the per-phone failure counter so
    // a rider who fat-fingered the card number twice isn't stuck locked out.
    await supabaseAdmin.rpc('clear_auth_failures', { p_bucket: `reset:${phoneKey}` });

    // Notify the admin so every reset leaves a trail — best-effort, never
    // blocks the actual reset if the email happens to fail to send.
    const resendKey = Deno.env.get('RESEND_API_KEY');
    const adminEmail = Deno.env.get('ADMIN_NOTIFICATION_EMAIL');
    if (resendKey && adminEmail) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'Waakye Plug Riders <onboarding@resend.dev>',
            to: adminEmail,
            subject: 'Rider PIN was reset',
            text: `${profile.full_name} (${phone}) just reset their login PIN via the app.`,
          }),
        });
      } catch {
        // Don't fail the whole reset just because the notification email failed.
      }
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});