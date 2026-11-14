import supabase from './_db-client.js';
import { requireUser, resolveProviderKeys } from './_auth.js';

/**
 * Per-user BYOK ("bring your own key") management.
 *
 * SECURITY: V4's POST handler also mirrored the keys into `global_settings`,
 * so the first user to save a key silently replaced the provider key for the
 * entire app. Only /api/global-keys (admin-gated) may touch global settings now.
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const auth = await requireUser(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const { user } = auth;

  try {
    if (req.method === 'GET') {
      const { data: byok } = await supabase
        .from('byok_keys')
        .select('openai_key, elevenlabs_key')
        .eq('user_id', user.id)
        .maybeSingle();

      const { data: global } = await supabase
        .from('global_settings')
        .select('openai_key, elevenlabs_key')
        .eq('id', 1)
        .maybeSingle();

      return res.status(200).json({
        has_openai: !!(byok?.openai_key || global?.openai_key || process.env.OPENAI_API_KEY),
        has_elevenlabs: !!(
          byok?.elevenlabs_key ||
          global?.elevenlabs_key ||
          process.env.ELEVENLABS_API_KEY
        ),
        has_byok_openai: !!byok?.openai_key,
        has_byok_elevenlabs: !!byok?.elevenlabs_key,
        global_openai: !!(global?.openai_key || process.env.OPENAI_API_KEY),
        global_elevenlabs: !!(global?.elevenlabs_key || process.env.ELEVENLABS_API_KEY),
      });
    }

    if (req.method === 'POST') {
      const { openai_key, elevenlabs_key } = req.body || {};
      if (!openai_key && !elevenlabs_key) {
        return res.status(400).json({ error: 'Provide openai_key and/or elevenlabs_key' });
      }

      // Read-then-merge so saving only the OpenAI key does not wipe an
      // existing ElevenLabs key.
      const { data: existing } = await supabase
        .from('byok_keys')
        .select('openai_key, elevenlabs_key')
        .eq('user_id', user.id)
        .maybeSingle();

      const { error } = await supabase.from('byok_keys').upsert({
        user_id: user.id,
        openai_key: openai_key || existing?.openai_key || null,
        elevenlabs_key: elevenlabs_key || existing?.elevenlabs_key || null,
      });
      if (error) throw error;

      return res.status(200).json({ ok: true, message: 'Your keys saved' });
    }

    if (req.method === 'DELETE') {
      const { error } = await supabase.from('byok_keys').delete().eq('user_id', user.id);
      if (error) throw error;

      // Report what the caller falls back to, so the UI can explain itself.
      const keys = await resolveProviderKeys(user.id);
      return res.status(200).json({
        ok: true,
        message: 'Your API keys were removed',
        using_global_openai: keys.source !== 'byok' && !!keys.openaiKey,
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('voice-settings error:', err);
    return res.status(500).json({ error: err.message });
  }
}
