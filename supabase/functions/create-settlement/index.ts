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
    const { rider_id } = await req.json();
    if (!rider_id) {
      return new Response(
        JSON.stringify({ error: 'rider_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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
    if (owed <= 0) {
      return new Response(
        JSON.stringify({ error: 'Nothing owed — no settlement needed' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const reference = `settle_${rider_id.slice(0, 8)}_${Date.now()}`;

    const { error: insertError } = await supabaseAdmin.from('rider_settlements').insert({
      rider_id,
      total_commission_owed: owed,
      paystack_reference: reference,
      status: 'pending',
    });

    if (insertError) {
      return new Response(
        JSON.stringify({ error: insertError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ reference, amount: owed }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});