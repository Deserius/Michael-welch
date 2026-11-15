/**
 * Compatibility helpers for the RoastBox production bundle.
 *
 * The bundle that now fronts this app was built against a different backend
 * than the one in this repo. Rather than rewrite minified JavaScript, the
 * endpoints it calls are implemented here on top of the existing Supabase
 * schema, translating between the two contracts.
 *
 * Auth model
 * ----------
 * The bundle sends `Authorization: Bearer <token>` and also expects cookies
 * (`withCredentials: true`). Supabase access tokens are bearer JWTs, so they
 * are passed through unchanged and verified server-side. The token is also
 * mirrored into an httpOnly cookie so a reload can recover the session.
 */
import supabase from './_db-client.js';
import {
  supabaseReachable,
  userFromToken,
  profileFor,
} from './_local-store.js';

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/** Standard prelude for every handler. Returns true when the request is done. */
export function begin(req, res) {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

export function readCookie(req, name) {
  const raw = req.headers?.cookie || '';
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return '';
}

export function bearer(req) {
  const header = req.headers?.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

/**
 * Resolve the caller. Returns `{ user, profile }` or `{ error, status }`.
 * Accepts the token from the Authorization header or the session cookie.
 */
export async function resolveUser(req) {
  const token = bearer(req) || readCookie(req, 'roastbox_session');
  if (!token) return { error: 'Unauthorized', status: 401 };

  // Offline / preview mode: the token came from the local store instead.
  if (!(await supabaseReachable())) {
    const local = await userFromToken(token);
    if (!local) return { error: 'Unauthorized', status: 401 };
    return { user: { id: local.id, email: local.email }, profile: profileFor(local), token, local };
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return { error: 'Unauthorized', status: 401 };

  const user = data.user;
  let { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  // Self-heal: a user can exist in auth.users before their profile row.
  if (!profile) {
    const { data: created } = await supabase
      .from('profiles')
      .insert({ user_id: user.id, email: user.email, credits: 10 })
      .select()
      .maybeSingle();
    profile = created;
    if (profile) {
      await supabase.from('credit_transactions').insert({
        user_id: user.id,
        amount: 10,
        type: 'starter',
        description: 'Welcome credits',
      });
    }
  }

  return { user, profile, token };
}

const TIER_UNLOCKS = {
  premium_personas: { premium_personas_unlocked: true },
  premium_voices: { premium_voices_unlocked: true },
  all_access: {
    premium_personas_unlocked: true,
    premium_voices_unlocked: true,
    roast_battle_unlocked: true,
  },
};

/**
 * Shape a profiles row into the `user` object the bundle expects.
 * The bundle reads: id, email, credits, plan_tier, and the *_unlocked flags.
 */
export function shapeUser(user, profile) {
  const tier = profile?.subscription_tier || null;
  const unlocks = TIER_UNLOCKS[tier] || {};
  return {
    id: user.id,
    email: profile?.email || user.email || '',
    display_name: (profile?.email || user.email || '').split('@')[0] || 'Roaster',
    credits: profile?.credits ?? 0,
    plan_tier: tier === 'all_access' ? 'all_access' : tier || 'free',
    lifetime_founder: false,
    premium_personas_unlocked: !!unlocks.premium_personas_unlocked,
    premium_voices_unlocked: !!unlocks.premium_voices_unlocked,
    premium_speech_unlocked: !!unlocks.premium_voices_unlocked,
    roast_battle_unlocked: !!unlocks.roast_battle_unlocked,
    hd_export_unlocked: false,
    subjects_accepted: false,
    onboarding_complete: true,
  };
}
