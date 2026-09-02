import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { phone, ghana_card_number, new_pin } = await req.json();

    if (!phone || !ghana_card_number || !new_pin || new_pin.length !== 4) {
      return new Response(
        JSON.stringify({ error: 'Phone, Ghana Card number, and a new 4-digit PIN are all required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Find the profile by phone, then the rider record, and check the
    // Ghana Card number matches — this pair is the identity check standing
    // in for "prove you're really this rider" since there's no real email
    // or SMS OTP path available here.
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name')
      .eq('phone', phone)
      .eq('role', 'rider')
      .maybeSingle();

    if (profileError || !profile) {
      return new Response(
        JSON.stringify({ error: 'We could not verify those details.' }),
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
      return new Response(
        JSON.stringify({ error: 'We could not verify those details.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Same password formula used everywhere else — PIN + last 4 digits of phone.
    const newPassword = `${new_pin}${phone.slice(-4)}`;

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(profile.id, {
      password: newPassword,
    });

    if (updateError) {
      return new Response(
        JSON.stringify({ error: updateError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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