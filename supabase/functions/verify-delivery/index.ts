import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import * as bcrypt from 'https://deno.land/x/bcrypt@v0.4.1/mod.ts';

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

function clientIp(req: Request): string {
  return (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim();
}

// Verifies the caller's JWT and returns the rider's profile ID.
async function requireRider(
  req: Request,
  supabaseAdmin: SupabaseClient
): Promise<{ ok: true; riderId: string } | { ok: false; response: Response }> {
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

  if (profileError || !profile || profile.role !== 'rider') {
    return { ok: false, response: jsonResponse(403, { error: 'Rider access required' }) };
  }

  return { ok: true, riderId: data.user.id };
}

// Verifies delivery by comparing the customer's 4-digit code against the
// hashed version stored at checkout. This is the secure, rider-facing
// completion flow that replaces the old direct markDelivered write (which
// any rider could call on any order).
//
// Product rules (locked):
// 1. Rider JWT required
// 2. Rider must own the order (rider_id matches)
// 3. Status must be exactly `picked_up` (not rider_assigned, not already delivered)
// 4. Request body must include 4-digit delivery_code (plaintext)
// 5. Compare against delivery_code_hash in database (bcrypt)
// 6. On success: status -> `delivered` (commission trigger fires automatically)
// 7. Rate-limit wrong attempts to prevent brute-force (5 failures / 15 min / order)
//
// Schema dependency:
// - Requires `delivery_code_hash` column on orders table (bcrypt hash of 4-digit code)
// - If Plug2 migration hasn't landed yet, this function will fail with clear error
// - Customer app must generate and store the hash at checkout (SHA-256 or bcrypt)
//
// What this does NOT do:
// - Does not return the plaintext code (security: customer only, never logged)
// - Does not allow verification before pickup (status guard)
// - Does not notify customer (WhatsApp "delivered" message is a later story)
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const riderCheck = await requireRider(req, supabaseAdmin);
    if (!riderCheck.ok) return riderCheck.response;

    const { order_id, delivery_code } = await req.json();

    if (!order_id) {
      return jsonResponse(400, { error: 'order_id is required' });
    }

    if (!delivery_code || !/^\d{4}$/.test(delivery_code)) {
      return jsonResponse(400, { error: 'delivery_code must be a 4-digit number' });
    }

    const ip = clientIp(req);
    const rateLimitBucket = `verify-delivery:${order_id}`;
    const genericFailure = { error: 'Invalid delivery code' };

    // Rate limit: 5 wrong attempts per order per 15 minutes.
    // This prevents a rider (or anyone who steals a rider's session) from
    // brute-forcing the customer's 4-digit code. 10,000 possibilities / 5
    // attempts = only 0.05% chance of guessing correctly before lockout.
    const gateCheck = await supabaseAdmin.rpc('begin_auth_attempt', {
      p_bucket: rateLimitBucket,
      p_max_attempts: 5,
      p_window_minutes: 15,
      p_lockout_minutes: 15,
    });

    if (gateCheck.error || !gateCheck.data?.allowed) {
      return jsonResponse(429, {
        error: `Too many incorrect attempts. Try again in ${Math.ceil((gateCheck.data?.retry_after_sec ?? 900) / 60)} minutes.`,
        retry_after_sec: gateCheck.data?.retry_after_sec ?? 900,
      });
    }

    // Fetch the order with delivery_code_hash
    const { data: order, error: fetchError } = await supabaseAdmin
      .from('orders')
      .select('id, rider_id, status, delivery_code_hash')
      .eq('id', order_id)
      .maybeSingle();

    if (fetchError || !order) {
      return jsonResponse(404, { error: 'Order not found' });
    }

    // Verify ownership
    if (order.rider_id !== riderCheck.riderId) {
      return jsonResponse(403, { error: 'You are not assigned to this order' });
    }

    // Verify status (must be picked_up, not already delivered)
    if (order.status !== 'picked_up') {
      if (order.status === 'delivered') {
        return jsonResponse(400, { error: 'Order already marked as delivered' });
      }
      if (order.status === 'rider_assigned') {
        return jsonResponse(400, { error: 'Cannot verify delivery before pickup' });
      }
      return jsonResponse(400, {
        error: `Cannot verify delivery for order in ${order.status} status`
      });
    }

    // Check if delivery_code_hash column exists and has a value
    if (!order.delivery_code_hash) {
      // This means either:
      // 1. The column doesn't exist yet (schema migration pending)
      // 2. The customer app didn't generate/store a hash at checkout
      // 3. This is an old order from before the delivery code feature
      return jsonResponse(400, {
        error: 'Delivery code not set for this order. Contact support.',
        hint: 'delivery_code_hash column may not exist or was not populated at checkout'
      });
    }

    // Verify the delivery code against the stored hash
    // Assuming bcrypt is used (most secure for this use case).
    // If schema uses SHA-256 instead, replace with a SHA comparison.
    let codeMatches = false;
    try {
      codeMatches = await bcrypt.compare(delivery_code, order.delivery_code_hash);
    } catch (compareError) {
      // Hash comparison failed — likely means the hash format is wrong or
      // corrupted. Log the error but don't expose details to the client.
      console.error('Delivery code hash comparison error:', compareError);
      await supabaseAdmin.rpc('record_auth_failure', { p_bucket: rateLimitBucket });
      return jsonResponse(500, {
        error: 'Failed to verify delivery code. Contact support.',
        hint: 'Hash comparison failed — check delivery_code_hash format'
      });
    }

    if (!codeMatches) {
      // Wrong code — record failure and return generic error
      await supabaseAdmin.rpc('record_auth_failure', { p_bucket: rateLimitBucket });
      return jsonResponse(400, genericFailure);
    }

    // Code is correct — mark the order as delivered
    const { data: delivered, error: updateError } = await supabaseAdmin
      .from('orders')
      .update({ status: 'delivered' })
      .eq('id', order_id)
      .select()
      .single();

    if (updateError || !delivered) {
      return jsonResponse(500, { error: 'Failed to mark order as delivered' });
    }

    // Success: clear rate limit failures for this order
    await supabaseAdmin.rpc('clear_auth_failures', { p_bucket: rateLimitBucket });

    // Note: The database commission trigger (if it exists) should fire
    // automatically when status changes to 'delivered'. No manual commission
    // calculation is needed in this function.

    // TODO (later story): Send WhatsApp notification to customer
    // - "Your order has been delivered!"
    // - Include order details, thank customer, request feedback/rating

    return jsonResponse(200, {
      success: true,
      order: delivered,
      message: 'Delivery verified successfully'
    });
  } catch (err) {
    return jsonResponse(500, {
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});
