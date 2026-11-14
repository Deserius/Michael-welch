import supabase from './_db-client.js';
import Stripe from 'stripe';

const STRIPE_KEY = process.env.STRIPE_API_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

let stripe = null;
if (STRIPE_KEY) {
  stripe = new Stripe(STRIPE_KEY);
}

export const config = {
  api: { bodyParser: false },
};

async function grantSubscription(userId, tier) {
  const { error } = await supabase
    .from('profiles')
    .update({ subscription_tier: tier })
    .eq('user_id', userId);
  if (error) console.error('Webhook: failed to set subscription tier:', error.message);

  const { error: txnErr } = await supabase.from('credit_transactions').insert({
    user_id: userId, amount: 0, type: 'subscription',
    description: `Subscription activated: ${tier}`,
  });
  if (txnErr) console.error('Webhook: failed to log subscription:', txnErr.message);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, stripe-signature');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!stripe) {
    return res.status(200).json({ received: false, error: 'Stripe not configured' });
  }

  const sig = req.headers['stripe-signature'] || '';

  // Read raw body
  let rawBody;
  if (Buffer.isBuffer(req.body)) {
    rawBody = req.body;
  } else if (typeof req.body === 'string') {
    rawBody = Buffer.from(req.body);
  } else if (req.body) {
    rawBody = Buffer.from(JSON.stringify(req.body));
  } else {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    rawBody = Buffer.concat(chunks);
  }

  let event;
  try {
    if (STRIPE_WEBHOOK_SECRET) {
      event = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET);
    } else {
      // No webhook secret — parse as JSON (dev/test mode)
      const bodyStr = rawBody.toString('utf8');
      event = JSON.parse(bodyStr);
    }
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const meta = session.metadata || {};
      const userId = meta.user_id || session.client_reference_id;
      const type = meta.type || 'one_time';
      const sessionId = session.id;

      if (!userId) {
        console.error('Webhook: missing user_id in metadata', meta);
        return res.status(200).json({ received: true, error: 'missing user_id' });
      }

      // Idempotency check — look for existing paid transaction
      let existingTxn = null;
      try {
        const { data } = await supabase
          .from('payment_transactions')
          .select('payment_status')
          .eq('stripe_session_id', sessionId)
          .single();
        existingTxn = data;
      } catch {
        // stripe_session_id column may not exist — proceed anyway
      }

      if (existingTxn && existingTxn.payment_status === 'paid') {
        return res.status(200).json({ received: true, duplicate: true });
      }

      if (type === 'subscription') {
        const tier = meta.tier || 'all_access';
        await grantSubscription(userId, tier);
        console.log(`Webhook: granted subscription ${tier} to ${userId}`);
      } else {
        // One-time credit pack
        const credits = parseInt(meta.credits || '0', 10);
        const packId = meta.pack_id || 'unknown';
        const packName = meta.name || 'Credit Pack';

        if (credits > 0) {
          // Claim the session before granting. The client also polls
          // /api/payment-status, so both paths can observe "not paid yet" and
          // both grant — double credits for one payment. Only the caller that
          // wins the pending -> paid transition may grant.
          let wonClaim = !existingTxn;
          if (existingTxn) {
            const { data: claimed } = await supabase
              .from('payment_transactions')
              .update({ payment_status: 'paid' })
              .eq('stripe_session_id', sessionId)
              .neq('payment_status', 'paid')
              .select('id');
            wonClaim = Array.isArray(claimed) && claimed.length > 0;
          }

          if (wonClaim) {
            const { data: balance, error: grantErr } = await supabase.rpc('grant_credits', {
              p_user_id: userId,
              p_amount: credits,
              p_type: 'purchase',
              p_description: `Purchase: ${packName}`,
            });
            if (grantErr) {
              console.error('Webhook: failed to grant credits:', grantErr.message);
            } else {
              console.log(`Webhook: granted ${credits} credits to ${userId} (new balance: ${balance})`);
            }
          } else {
            console.warn('Webhook: credits already granted for', sessionId);
          }
        }

        // Update or create payment transaction record
        if (existingTxn) {
          try {
            await supabase
              .from('payment_transactions')
              .update({ payment_status: 'paid' })
              .eq('stripe_session_id', sessionId);
          } catch {}
        } else {
          try {
            await supabase.from('payment_transactions').insert({
              user_id: userId, pack_id: packId,
              amount_usd: session.amount_total ? session.amount_total / 100 : 0,
              credits, payment_status: 'paid', stripe_session_id: sessionId,
            });
          } catch {
            try {
              await supabase.from('payment_transactions').insert({
                user_id: userId, pack_id: packId,
                amount_usd: session.amount_total ? session.amount_total / 100 : 0,
                credits, payment_status: 'paid',
              });
            } catch {}
          }
        }
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook processing error:', err);
    return res.status(500).json({ error: err.message });
  }
}
