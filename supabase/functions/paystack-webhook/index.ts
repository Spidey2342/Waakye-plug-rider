import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

async function verifySignature(rawBody: string, signature: string | null, secret: string): Promise<boolean> {
  if (!signature) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign']
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const computed = Array.from(new Uint8Array(sigBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return computed === signature;
}

Deno.serve(async (req) => {
  const rawBody = await req.text();
  const signature = req.headers.get('x-paystack-signature');
  const secret = Deno.env.get('PAYSTACK_SECRET_KEY')!;

  const isValid = await verifySignature(rawBody, signature, secret);
  if (!isValid) {
    return new Response('Invalid signature', { status: 401 });
  }

  const event = JSON.parse(rawBody);

  if (event.event === 'charge.success') {
    const reference = event.data.reference;
    const amountPaidGHS = event.data.amount / 100;

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: settlement } = await supabaseAdmin
      .from('rider_settlements')
      .select('id, rider_id, status, total_commission_owed')
      .eq('paystack_reference', reference)
      .maybeSingle();

    if (settlement && settlement.status === 'pending') {
      const owed = Number(settlement.total_commission_owed);
      if (amountPaidGHS + 0.5 >= owed) {
        await supabaseAdmin
          .from('rider_settlements')
          .update({ status: 'paid', paid_at: new Date().toISOString() })
          .eq('id', settlement.id);

        await supabaseAdmin
          .from('riders')
          .update({ commission_owed: 0, last_settled_at: new Date().toISOString() })
          .eq('id', settlement.rider_id);
      }
    }
  }

  return new Response('ok', { status: 200 });
});