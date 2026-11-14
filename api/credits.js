import supabase from './db-client.js';
import Stripe from 'stripe';
import { requireUser } from './_auth.js';

// ===== PRICING =====
// One-time credit packs
const CREDIT_PACKS = {
  starter:  { id: 'starter', credits: 10,  amount_usd: 4.99,  name: 'Starter Roast Pack', type: 'one_time' },
  pro:      { id: 'pro',     credits: 25,  amount_usd: 9.99,  name: 'Pro Roast Pack',     type: 'one_time' },
  savage:   { id: 'savage',  credits: 60,  amount_usd: 19.99, name: 'Savage Roast Pack',  type: 'one_time' },
  kingpin:  { id: 'kingpin', credits: 200, amount_usd: 49.99, name: 'Kingpin Roast Pack', type: 'one_time' },
  boss:     { id: 'boss',    credits: 500, amount_usd: 99.00, name: 'Boss Roast Pack',    type: 'one_time' },
};

// Subscription tiers (monthly / annual)
const SUBSCRIPTIONS = {
  premium_personas: {
    id: 'premium_personas', name: 'Premium Personas Pass',
    monthly_usd: 9.99, annual_usd: 99.99,
    description: 'Unlimited access to all 10 premium roaster personas. No credit charge for premium personas.',
    tier: 'premium_personas', type: 'subscription',
  },
  premium_voices: {
    id: 'premium_voices', name: 'Premium Voices Pass',
    monthly_usd: 14.99, annual_usd: 149.99,
    description: 'Unlimited ElevenLabs premium voice synthesis. No credit charge for premium voices.',
    tier: 'premium_voices', type: 'subscription',
  },
  all_access: {
    id: 'all_access', name: 'All-Access Roast Pass',
    monthly_usd: 24.99, annual_usd: 249.99,
    description: 'Everything unlocked: premium personas, premium voices, premium AI model, and unlimited roasts. No credit charges ever.',
    tier: 'all_access', type: 'subscription',
  },
};

const STRIPE_KEY = process.env.STRIPE_API_KEY || '';
let stripe = null;
if (STRIPE_KEY) {
  stripe = new Stripe(STRIPE_KEY);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const auth = await requireUser(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const { user } = auth;

  try {
    if (req.method === 'GET') {
      const { data: txns } = await supabase
        .from('credit_transactions')
        .select('amount, type, description, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(30);

      const { data: profile } = await supabase
        .from('profiles')
        .select('credits, subscription_tier')
        .eq('user_id', user.id)
        .single();

      return res.status(200).json({
        packs: Object.values(CREDIT_PACKS),
        subscriptions: Object.values(SUBSCRIPTIONS),
        transactions: txns || [],
        balance: profile?.credits || 0,
        subscription_tier: profile?.subscription_tier || null,
        stripe_enabled: !!stripe,
      });
    }

    if (req.method === 'POST') {
      const { pack_id, billing_period } = req.body || {};

      // Check if it's a subscription
      const sub = SUBSCRIPTIONS[pack_id];
      if (sub) {
        const isAnnual = billing_period === 'annual';
        const amount = isAnnual ? sub.annual_usd : sub.monthly_usd;

        if (stripe) {
          const origin = req.headers.origin || 'https://da-roastbox.vercel.app';
          const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
              price_data: {
                currency: 'usd',
                product_data: {
                  name: sub.name,
                  description: sub.description,
                },
                unit_amount: Math.round(amount * 100),
              },
              quantity: 1,
            }],
            mode: 'payment',
            success_url: `${origin}/credits/success?session_id={CHECKOUT_SESSION_ID}&sub=${pack_id}`,
            cancel_url: `${origin}/credits/cancel`,
            metadata: {
              user_id: user.id,
              pack_id: pack_id,
              type: 'subscription',
              tier: sub.tier,
              billing_period: isAnnual ? 'annual' : 'monthly',
              name: sub.name,
            },
            client_reference_id: user.id,
          });

          await safeInsertPayment(user.id, pack_id, amount, 0, 'pending', session.id);
          return res.status(200).json({ checkout_url: session.url, session_id: session.id, stripe: true });
        }

        // Demo mode — grant subscription instantly
        await grantSubscription(user.id, sub.tier);
        return res.status(200).json({
          ok: true,
          subscription_tier: sub.tier,
          stripe: false,
        });
      }

      // One-time credit pack
      const pack = CREDIT_PACKS[pack_id];
      if (!pack) return res.status(400).json({ error: 'Invalid pack' });

      const { data: profile } = await supabase
        .from('profiles')
        .select('credits')
        .eq('user_id', user.id)
        .single();
      if (!profile) return res.status(404).json({ error: 'Profile not found' });

      if (stripe) {
        const origin = req.headers.origin || 'https://da-roastbox.vercel.app';
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ['card'],
          line_items: [{
            price_data: {
              currency: 'usd',
              product_data: {
                name: pack.name,
                description: `${pack.credits} roast credits for Da RoastBox!`,
              },
              unit_amount: Math.round(pack.amount_usd * 100),
            },
            quantity: 1,
          }],
          mode: 'payment',
          success_url: `${origin}/credits/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${origin}/credits/cancel`,
          metadata: {
            user_id: user.id,
            pack_id: pack.id,
            credits: pack.credits,
            name: pack.name,
            type: 'one_time',
          },
          client_reference_id: user.id,
        });

        await safeInsertPayment(user.id, pack.id, pack.amount_usd, pack.credits, 'pending', session.id);
        return res.status(200).json({ checkout_url: session.url, session_id: session.id, stripe: true });
      }

      // Demo mode — no Stripe configured, so credits are granted instantly.
      // Surfaced in the response (`stripe: false`) so the UI can warn.
      const { data: newCredits, error: grantErr } = await supabase.rpc('grant_credits', {
        p_user_id: user.id,
        p_amount: pack.credits,
        p_type: 'purchase',
        p_description: `Purchase: ${pack.name} (demo mode)`,
      });
      if (grantErr) throw grantErr;
      await safeInsertPayment(user.id, pack.id, pack.amount_usd, pack.credits, 'paid', null);

      return res.status(200).json({
        ok: true, pack_id: pack.id, credits_added: pack.credits,
        credits_balance: newCredits, stripe: false,
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('credits error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// Helper: grant subscription tier to user
async function grantSubscription(userId, tier) {
  const { error } = await supabase
    .from('profiles')
    .update({ subscription_tier: tier })
    .eq('user_id', userId);
  if (error) throw error;

  await supabase.from('credit_transactions').insert({
    user_id: userId, amount: 0, type: 'subscription',
    description: `Subscription activated: ${tier}`,
  });
}

// Helper: safely insert payment with optional stripe_session_id
async function safeInsertPayment(userId, packId, amountUsd, credits, status, stripeSessionId) {
  try {
    await supabase.from('payment_transactions').insert({
      user_id: userId, pack_id: packId, amount_usd: amountUsd,
      credits, payment_status: status, stripe_session_id: stripeSessionId,
    });
  } catch {
    await supabase.from('payment_transactions').insert({
      user_id: userId, pack_id: packId, amount_usd: amountUsd,
      credits, payment_status: status,
    });
  }
}
