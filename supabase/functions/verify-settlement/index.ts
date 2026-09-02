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

    const amountPaidGHS = verifyData.data.amount / 100;

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: settlement, error: settlementError } = await supabaseAdmin
      .from('rider_settlements')
      .select('id, status, total_commission_owed')
      .eq('paystack_reference', reference)
      .eq('rider_id', rider_id)
      .maybeSingle();

    if (settlementError || !settlement) {
      return new Response(
        JSON.stringify({ error: 'No matching settlement record found for this reference' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (settlement.status === 'paid') {
      return new Response(
        JSON.stringify({ success: true, already_processed: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const owed = Number(settlement.total_commission_owed);
    if (amountPaidGHS + 0.5 < owed) {
      return new Response(
        JSON.stringify({ error: 'Amount paid does not match commission owed' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { error: settleUpdateError } = await supabaseAdmin
      .from('rider_settlements')
      .update({ status: 'paid', paid_at: new Date().toISOString() })
      .eq('id', settlement.id)
      .eq('status', 'pending');

    if (settleUpdateError) {
      return new Response(
        JSON.stringify({ error: settleUpdateError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { error: resetError } = await supabaseAdmin
      .from('riders')
      .update({ commission_owed: 0, last_settled_at: new Date().toISOString() })
      .eq('id', rider_id);

    if (resetError) {
      return new Response(
        JSON.stringify({ error: `Payment verified but could not reset commission: ${resetError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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