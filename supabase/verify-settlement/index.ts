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
    const { reference, rider_id } = await req.json();

    if (!reference || !rider_id) {
      return new Response(
        JSON.stringify({ error: 'reference and rider_id are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Ask Paystack directly whether this payment actually went through —
    // never trust a client-side "success" callback on its own, since that
    // can be faked by anyone with dev tools open.
    const paystackSecret = Deno.env.get('PAYSTACK_SECRET_KEY');
    const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${paystackSecret}` },
    });
    const verifyData = await verifyRes.json();

    if (!verifyData.status || verifyData.data?.status !== 'success') {
      return new Response(
        JSON.stringify({ error: 'Payment could not be verified as successful' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const amountPaidGHS = verifyData.data.amount / 100; // Paystack amounts are in pesewas

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: rider, error: riderError } = await supabaseAdmin
      .from('riders')
      .select('commission_owed')
      .eq('id', rider_id)
      .single();

    if (riderError || !rider) {
      return new Response(
        JSON.stringify({ error: 'Rider not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const owed = Number(rider.commission_owed);

    // Small tolerance for rounding, but reject anything meaningfully short
    // of what's actually owed — protects against a tampered/replayed reference.
    if (amountPaidGHS + 0.5 < owed) {
      return new Response(
        JSON.stringify({ error: 'Amount paid does not match commission owed' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    await supabaseAdmin.from('rider_settlements').insert({
      rider_id,
      total_commission_owed: owed,
      paystack_reference: reference,
      status: 'paid',
      paid_at: new Date().toISOString(),
    });

    await supabaseAdmin
      .from('riders')
      .update({ commission_owed: 0 })
      .eq('id', rider_id);

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