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

    if (!full_name || !phone || !pin || pin.length !== 4) {
      return new Response(
        JSON.stringify({ error: 'full_name, phone, and a 4-digit pin are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Service role client — full admin rights, only ever runs server-side.
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Riders never see this — they only ever type their phone + 4-digit PIN.
    // We turn that into a real password Supabase Auth will accept.
    const syntheticEmail = `${phone}@riders.waakyeplug.app`;
    const realPassword = `${pin}${phone.slice(-4)}`;

    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: syntheticEmail,
      password: realPassword,
      email_confirm: true,
    });

    if (authError) {
      return new Response(
        JSON.stringify({ error: authError.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { error: profileError } = await supabaseAdmin.from('profiles').insert({
      id: authUser.user.id,
      full_name,
      phone,
      email: syntheticEmail,
      role: 'rider',
    });

    if (profileError) {
      // Roll back the auth user so we don't leave an orphaned account behind.
      await supabaseAdmin.auth.admin.deleteUser(authUser.user.id);
      return new Response(
        JSON.stringify({ error: profileError.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: rider, error: riderError } = await supabaseAdmin
      .from('riders')
      .insert({
        profile_id: authUser.user.id,
        status: 'pending',
        is_approved: true,
        photo_url,
        transport_type,
        ghana_card_number,
        home_area,
        emergency_contact_name,
        emergency_contact_phone,
        deposit_amount: deposit_amount ?? 0,
        deposit_collected_at: deposit_amount ? new Date().toISOString() : null,
      })
      .select()
      .single();

    if (riderError) {
      await supabaseAdmin.auth.admin.deleteUser(authUser.user.id);
      return new Response(
        JSON.stringify({ error: riderError.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, rider }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});