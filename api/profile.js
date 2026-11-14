import supabase from './db-client.js';
import { requireUser } from './_auth.js';

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
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (!profile) {
        const { data: newProfile, error: insertErr } = await supabase
          .from('profiles')
          .insert({ user_id: user.id, email: user.email, credits: 10 })
          .select()
          .single();
        if (insertErr) throw insertErr;

        await supabase.from('credit_transactions').insert({
          user_id: user.id, amount: 10, type: 'starter',
          description: 'Free starter credits',
        });

        return res.status(200).json({
          id: newProfile.id,
          user_id: newProfile.user_id,
          email: newProfile.email,
          credits: newProfile.credits,
          subscription_tier: newProfile.subscription_tier || null,
          has_byok_openai: false,
          has_byok_elevenlabs: false,
        });
      }

      const { data: byok } = await supabase
        .from('byok_keys')
        .select('openai_key, elevenlabs_key')
        .eq('user_id', user.id)
        .single();

      return res.status(200).json({
        id: profile.id,
        user_id: profile.user_id,
        email: profile.email,
        credits: profile.credits,
        subscription_tier: profile.subscription_tier || null,
        has_byok_openai: !!(byok && byok.openai_key),
        has_byok_elevenlabs: !!(byok && byok.elevenlabs_key),
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('profile error:', err);
    return res.status(500).json({ error: err.message });
  }
}
