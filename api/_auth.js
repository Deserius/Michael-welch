import supabase from './_db-client.js';

/**
 * Resolve the caller from a Supabase access token.
 * Returns `{ user }` or `{ error, status }` so handlers can bail cleanly.
 */
export async function requireUser(req) {
  const header = req.headers?.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return { error: 'Unauthorized', status: 401 };

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return { error: 'Invalid token', status: 401 };
  return { user: data.user };
}

/**
 * Guard for endpoints that mutate app-wide state (currently: the global
 * OpenAI / ElevenLabs keys). V4 exposed these to *every* authenticated user,
 * which let any signup overwrite the owner's provider keys and burn their
 * OpenAI balance.
 *
 * Allowed when:
 *   - ADMIN_USER_IDS is set and the caller's id or email is listed, or
 *   - ADMIN_USER_IDS is unset AND the caller is the first (oldest) account,
 *     which keeps a fresh self-hosted instance usable without configuration.
 */
export async function requireAdmin(req) {
  const auth = await requireUser(req);
  if (auth.error) return auth;

  const allowList = (process.env.ADMIN_USER_IDS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const email = (auth.user.email || '').toLowerCase();
  if (allowList.length > 0) {
    if (allowList.includes(auth.user.id.toLowerCase()) || allowList.includes(email)) {
      return { user: auth.user };
    }
    return { error: 'Forbidden', status: 403 };
  }

  // No allow-list configured: fall back to the oldest account only.
  const { data: owner, error } = await supabase
    .from('profiles')
    .select('user_id')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) return { error: 'Could not verify admin', status: 500 };
  if (owner?.user_id === auth.user.id) return { user: auth.user };
  return { error: 'Forbidden', status: 403 };
}

/**
 * Is the caller a paying subscriber (and therefore entitled to premium voices)?
 *
 * `api/tts.js` used to hand out ElevenLabs synthesis to anyone who sent
 * `use_premium_voices: true`, whether or not they had paid for the tier the UI
 * gates behind a subscription. Entitlement is decided here, server-side, and
 * the client only gets to *ask*.
 */
export async function isSubscriber(userId) {
  const { data } = await supabase
    .from('profiles')
    .select('subscription_tier')
    .eq('user_id', userId)
    .maybeSingle();
  return !!data?.subscription_tier;
}

/**
 * Which API keys to use for a request, in priority order:
 *   1. the caller's own BYOK key
 *   2. the global key (global_settings row, then process.env)
 *
 * Keys are never returned to the client — only used server-side.
 */
export async function resolveProviderKeys(userId) {
  const { data: byok } = await supabase
    .from('byok_keys')
    .select('openai_key, elevenlabs_key')
    .eq('user_id', userId)
    .maybeSingle();

  const { data: global } = await supabase
    .from('global_settings')
    .select('openai_key, elevenlabs_key')
    .eq('id', 1)
    .maybeSingle();

  return {
    openaiKey: byok?.openai_key || global?.openai_key || process.env.OPENAI_API_KEY || '',
    elevenlabsKey:
      byok?.elevenlabs_key || global?.elevenlabs_key || process.env.ELEVENLABS_API_KEY || '',
    source: byok?.openai_key ? 'byok' : global?.openai_key ? 'global' : 'env',
  };
}
