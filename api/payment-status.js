import supabase from './_db-client.js';
import Stripe from 'stripe';
import { requireUser } from './_auth.js';

const STRIPE_KEY = process.env.STRIPE_API_KEY || '';
let stripe = null;
if (STRIPE_KEY) {
  stripe = new Stripe(STRIPE_KEY);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireUser(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const { user } = auth;

  const { session_id, sub } = req.query || {};
  if (!session_id) return res.status(400).json({ error: 'Missing session_id' });

  try {
    // ===== STEP 1: Try to find existing transaction in our DB =====
    let txn = null;
    try {
      const { data, error } = await supabase
        .from('payment_transactions')
        .select('*')
        .eq('stripe_session_id', session_id)
        .single();
      if (!error && data) txn = data;
    } catch {
      // stripe_session_id column may not exist — that's OK, we'll use metadata
    }

    // ===== STEP 2: Verify with Stripe =====
    if (!stripe) {
      // No Stripe configured — return whatever we have
      return res.status(200).json({
        payment_status: txn?.payment_status || 'unknown',
        credits_added: 0,
        credits_balance: 0,
      });
    }

    const session = await stripe.checkout.sessions.retrieve(session_id);
    const paymentStatus = (session.payment_status || 'unknown').toLowerCase();
    const meta = session.metadata || {};

    // ===== STEP 3: Handle subscription payments =====
    if (sub || meta.type === 'subscription') {
      const tier = meta.tier || sub || 'all_access';

      // Update profile subscription tier
      const updateData = {};
      try { updateData.subscription_tier = tier; } catch {}
      if (tier === 'all_access') {
        updateData.credits = 999999;
      }

      try {
        await supabase.from('profiles').update(updateData).eq('user_id', user.id);
      } catch {
        // subscription_tier column may not exist — try just credits
        if (tier === 'all_access') {
          await supabase.from('profiles').update({ credits: 999999 }).eq('user_id', user.id);
        }
      }

      try {
        await supabase.from('credit_transactions').insert({
          user_id: user.id, amount: 0, type: 'subscription',
          description: `Subscription activated: ${tier}`,
        });
      } catch {}

      // Fetch updated profile to return current balance
      const { data: updatedProfile } = await supabase
        .from('profiles')
        .select('credits')
        .eq('user_id', user.id)
        .single();

      return res.status(200).json({
        payment_status: 'paid',
        subscription_tier: tier,
        credits_added: 0,
        credits_balance: updatedProfile?.credits || (tier === 'all_access' ? 999999 : 0),
      });
    }

    // ===== STEP 4: Handle one-time credit pack payments =====
    if (paymentStatus === 'paid') {
      // Determine credits to grant — from DB txn or from Stripe metadata
      const credits = txn?.credits || parseInt(meta.credits || '0', 10);
      const packId = txn?.pack_id || meta.pack_id || 'unknown';
      const packName = meta.name || 'Credit Pack';

      if (credits > 0) {
        // Check if we already granted credits for this session (idempotency)
        let alreadyPaid = false;
        if (txn && txn.payment_status === 'paid') {
          alreadyPaid = true;
        }

        if (!alreadyPaid) {
          // The client polls this endpoint while the webhook may be running,
          // so the two can race. Claim the payment row atomically first: only
          // the caller that flips pending -> paid is allowed to grant credits.
          // grant_credits() applies the balance change and ledger row together.
          const claim = supabase
            .from('payment_transactions')
            .update({ payment_status: 'paid' })
            .eq('stripe_session_id', session_id)
            .neq('payment_status', 'paid');

          const { data: claimed, error: claimErr } = txn
            ? await claim.select('id')
            : { data: null, error: null };

          const wonRace = txn ? !claimErr && Array.isArray(claimed) && claimed.length > 0 : true;

          if (wonRace) {
            const { error: grantErr } = await supabase.rpc('grant_credits', {
              p_user_id: user.id,
              p_amount: credits,
              p_type: 'purchase',
              p_description: `Purchase: ${packName}`,
            });
            if (grantErr) {
              console.error('payment-status: failed to grant credits:', grantErr.message);
              // Release the claim so a retry can try again.
              try {
                await supabase
                  .from('payment_transactions')
                  .update({ payment_status: 'pending' })
                  .eq('stripe_session_id', session_id);
              } catch { /* best effort */ }
            }
          } else {
            console.warn('payment-status: credits already granted for', session_id);
          }

          // Fetch the balance for the response either way.
          const { data: profile } = await supabase
            .from('profiles')
            .select('credits')
            .eq('user_id', user.id)
            .single();

          // If we had no local row for this session, record the receipt now
          // (the unique index on stripe_session_id makes this idempotent).
          if (!txn && wonRace) {
            const { error: recErr } = await supabase.from('payment_transactions').insert({
              user_id: user.id,
              pack_id: packId,
              amount_usd: session.amount_total ? session.amount_total / 100 : 0,
              credits,
              payment_status: 'paid',
              stripe_session_id: session_id,
            });
            if (recErr && !/duplicate key/.test(recErr.message || '')) {
              console.error('payment-status: failed to record payment:', recErr.message);
            }
          }

          return res.status(200).json({
            payment_status: 'paid',
            credits_added: wonRace ? credits : 0,
            credits_balance: profile?.credits || 0,
            already_granted: !wonRace,
          });
        } else {
          // Already paid — return current balance
          const { data: currentProfile } = await supabase
            .from('profiles')
            .select('credits')
            .eq('user_id', user.id)
            .single();

          return res.status(200).json({
            payment_status: 'paid',
            credits_added: 0,
            credits_balance: currentProfile?.credits || 0,
            already_granted: true,
          });
        }
      }
    }

    // Payment not yet paid or no credits to grant
    const { data: currentProfile } = await supabase
      .from('profiles')
      .select('credits')
      .eq('user_id', user.id)
      .single();

    return res.status(200).json({
      payment_status: paymentStatus,
      credits_added: 0,
      credits_balance: currentProfile?.credits || 0,
    });
  } catch (err) {
    console.error('payment status error:', err);
    return res.status(500).json({ error: err.message });
  }
}
