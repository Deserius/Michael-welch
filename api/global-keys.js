import supabase from './_db-client.js';
import { requireAdmin } from './_auth.js';

/**
 * GET  /api/global-keys  -> whether app-wide keys are configured (never values)
 * POST /api/global-keys  -> set app-wide keys        [admin only]
 *
 * SECURITY: V4 let any authenticated user call POST here and overwrite the
 * owner's OpenAI / ElevenLabs keys. Both methods are now admin-gated.
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const auth = await requireAdmin(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });

  try {
    if (req.method === 'GET') {
      const { data } = await supabase
        .from('global_settings')
        .select('openai_key, elevenlabs_key')
        .eq('id', 1)
        .maybeSingle();

      return res.status(200).json({
        has_openai: !!(data?.openai_key || process.env.OPENAI_API_KEY),
        has_elevenlabs: !!(data?.elevenlabs_key || process.env.ELEVENLABS_API_KEY),
        source: data?.openai_key ? 'database' : 'env',
      });
    }

    if (req.method === 'POST') {
      const { openai_key, elevenlabs_key } = req.body || {};
      if (!openai_key && !elevenlabs_key) {
        return res.status(400).json({ error: 'Provide openai_key and/or elevenlabs_key' });
      }

      // Only overwrite the fields that were supplied; `undefined` would
      // otherwise null out a key the admin did not intend to change.
      const patch = { id: 1, updated_by: auth.user.id };
      if (openai_key) patch.openai_key = openai_key;
      if (elevenlabs_key) patch.elevenlabs_key = elevenlabs_key;

      const { error } = await supabase.from('global_settings').upsert(patch);
      if (error) throw error;

      return res.status(200).json({ ok: true, message: 'Global API keys updated' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('global-keys error:', err);
    return res.status(500).json({ error: err.message });
  }
}
