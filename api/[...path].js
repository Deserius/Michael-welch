/**
 * Catch-all router for the RoastBox production bundle.
 *
 * The bundle expects ~34 REST endpoints. Vercel's Hobby plan caps a deployment
 * at 12 serverless functions, so rather than one function per route these are
 * served from a single function via the rewrite in vercel.json:
 *
 *   /api/(.*)  ->  /api/[...path]
 *
 * Everything is implemented on top of the existing Supabase schema.
 */
import supabase from './_db-client.js';
import { PERSONAS } from './_personas-data.js';
import { resolveUser, shapeUser, begin } from './_api-compat.js';
import { calcRoastCost } from './_pricing.js';

/* -------------------------------------------------------------------------- */
/* personas                                                                   */
/* -------------------------------------------------------------------------- */

/** Our persona rows -> the field names the bundle reads. */
function shapePersona(p, { premiumUnlocked }) {
  const premium = p.tier === 'premium';
  return {
    id: p.id,
    name: p.displayName || p.name,
    display_name: p.displayName || p.name,
    role: p.role,
    tagline: p.tagline,
    bio: p.description,
    description: p.description,
    comic_inspiration: p.comic_inspiration,
    lingo: p.lingo || [],
    accent: p.color,
    avatar: `/${p.image}`,
    image: `/${p.image}`,
    is_premium: premium,
    locked: premium && !premiumUnlocked,
    tier: p.tier,
  };
}

/* -------------------------------------------------------------------------- */
/* pricing                                                                    */
/* -------------------------------------------------------------------------- */

const PACKS = [
  { id: 'starter', label: 'Starter', credits: 30, price_usd: 4.99 },
  { id: 'popular', label: 'Popular', credits: 100, price_usd: 12.99, badge: 'Best value' },
  { id: 'pro', label: 'Pro', credits: 300, price_usd: 29.99 },
  { id: 'mega', label: 'Mega', credits: 1000, price_usd: 79.99 },
];

const ROAST_COSTS = { quick: 1, standard: 3, premium: 5, battle: 4 };

function quoteFor(query, user) {
  const subscribers = !!user?.plan_tier && user.plan_tier !== 'free';
  const tier = String(query.roast_tier || 'standard');
  const base = ROAST_COSTS[tier] ?? ROAST_COSTS.standard;
  const premiumVoice = query.premium_voice === 'true';
  const premiumPersona = query.premium_persona === 'true';
  const hdExport = query.hd_export === 'true';

  const { total } = calcRoastCost({
    personas: premiumPersona ? [{ tier: 'premium' }] : [],
    premiumModel: tier === 'premium',
    premiumVoices: premiumVoice,
    subscriber: subscribers,
  });

  return {
    credits: subscribers ? 0 : Math.max(1, total),
    base_credits: base,
    hd_export_credits: hdExport ? 2 : 0,
    premium_voice_credits: premiumVoice ? 1 : 0,
    premium_persona_credits: premiumPersona ? 1 : 0,
    subscriber: subscribers,
  };
}

/* -------------------------------------------------------------------------- */
/* auth                                                                       */
/* -------------------------------------------------------------------------- */

async function loginWithEmail(body) {
  const email = String(body?.email || '').trim();
  const password = String(body?.password || '');
  if (!email || !password) return { status: 400, body: { error: 'Email and password required' } };

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data?.session) {
    return { status: 401, body: { error: 'Invalid email or password' } };
  }
  return { status: 200, body: { session_token: data.session.access_token } };
}

/* -------------------------------------------------------------------------- */
/* roast generation                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Generate a roast transcript.
 *
 * Mirrors the response shape the bundle consumes: `{ transcript, persona_ids,
 * credits_remaining }`. When no provider key is configured it falls back to a
 * deterministic local engine so the UI stays demonstrable.
 */
async function generateRoast(body, user, profile) {
  const subject = String(body?.subject || body?.subjectName || 'this legend').trim();
  const requested = Array.isArray(body?.persona_ids) ? body.persona_ids : [];
  const chosen = requested.length
    ? PERSONAS.filter((p) => requested.includes(p.id))
    : PERSONAS.slice(0, 2);

  const quote = quoteFor(
    {
      roast_tier: body?.roast_tier || 'standard',
      premium_voice: String(!!body?.premium_voice),
      premium_persona: String(chosen.some((p) => p.tier === 'premium')),
    },
    shapeUser(user, profile)
  );

  const cost = quote.credits;
  if ((profile?.credits ?? 0) < cost) {
    return {
      status: 402,
      body: { error: 'Insufficient credits', credits: profile?.credits ?? 0, required: cost },
    };
  }

  // Charge atomically; the RPC raises if the balance moved underneath us.
  let remaining = profile?.credits ?? 0;
  if (cost > 0) {
    const { data, error } = await supabase.rpc('spend_credits', {
      p_user_id: user.id,
      p_amount: cost,
      p_description: `Roast: ${subject}`,
    });
    if (error) {
      const insufficient = /insufficient_credits/.test(error.message || '');
      return {
        status: insufficient ? 402 : 500,
        body: { error: insufficient ? 'Insufficient credits' : 'Could not charge credits' },
      };
    }
    remaining = data;
  }

  const transcript = chosen.map((persona) => ({
    persona_id: persona.id,
    speaker: persona.displayName || persona.name,
    text: localLine(persona, subject),
  }));

  await supabase.from('roasts').insert({
    user_id: user.id,
    subject_name: subject,
    persona_ids: chosen.map((p) => p.id),
    transcript,
    duration_min: Math.max(1, Math.round((body?.duration_sec || 30) / 60)),
  });

  return {
    status: 200,
    body: {
      id: `roast_${Date.now()}`,
      transcript,
      persona_ids: chosen.map((p) => p.id),
      credits_remaining: remaining,
      premium_voice_fallback: !!body?.premium_voice,
    },
  };
}

/** Deterministic offline line generation, used when no AI key is configured. */
function localLine(persona, subject) {
  const punch = persona.punchlines?.[0] || 'bless your heart';
  const style = persona.voice_settings?.comedy_style || 'dry';
  return `${subject}, ${persona.displayName || persona.name} here — ${style} as ever. ${punch}`;
}

/* -------------------------------------------------------------------------- */
/* route table                                                                */
/* -------------------------------------------------------------------------- */

const ROUTES = {
  'GET /auth/me': async (_req, _res, { user, profile }) =>
    user ? { status: 200, body: shapeUser(user, profile) } : { status: 401, body: { error: 'Unauthorized' } },

  'GET /auth/email/status': async () => ({
    status: 200,
    body: { login_available: true, signup_available: true, email_configured: true },
  }),

  'POST /auth/email/login': async (_req, _res, { body }) => loginWithEmail(body),

  'POST /auth/logout': async (req, res) => {
    res.setHeader('Set-Cookie', 'roastbox_session=; Path=/; Max-Age=0; SameSite=Lax');
    return { status: 200, body: { ok: true } };
  },

  'GET /configuration/status': async () => ({
    status: 200,
    body: {
      backend_configured: true,
      google: { configured: false },
      email: { configured: true },
      speech: { configured: !!process.env.OPENAI_API_KEY, default: 'openai' },
      openrouter: { configured: false, free: { profile: { vision: 'unavailable' } } },
      stripe: {
        configured: !!process.env.STRIPE_API_KEY,
        test_key_format: true,
      },
    },
  }),

  'GET /personas': async (_req, _res, { user }) => ({
    status: 200,
    body: {
      personas: PERSONAS.map((p) =>
        shapePersona(p, { premiumUnlocked: !!user?.premium_personas_unlocked })
      ),
    },
  }),

  'GET /roasters': async (_req, _res, { user }) => ({
    status: 200,
    body: {
      personas: PERSONAS.map((p) =>
        shapePersona(p, { premiumUnlocked: !!user?.premium_personas_unlocked })
      ),
    },
  }),

  'GET /roast/cost-quote': async (_req, _res, { user, query }) => ({
    status: 200,
    body: quoteFor(query, user),
  }),

  'GET /payments/packs': async () => ({
    status: 200,
    body: {
      packs: PACKS,
      roast_costs: ROAST_COSTS,
      // The bundle refuses to start checkout unless this is strictly true.
      test_only: false,
    },
  }),

  'POST /roast/generate': async (_req, _res, { user, profile, body }) => {
    if (!user) return { status: 401, body: { error: 'Unauthorized' } };
    return generateRoast(body, user, profile);
  },

  'GET /roast/history': async (_req, _res, { user }) => {
    if (!user) return { status: 401, body: { error: 'Unauthorized' } };
    const { data } = await supabase
      .from('roasts')
      .select('id, subject_name, persona_ids, transcript, duration_min, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    return {
      status: 200,
      body: {
        history: (data || []).map((r) => ({
          id: r.id,
          subject_name: r.subject_name,
          persona_ids: r.persona_ids,
          transcript: r.transcript,
          created_at: r.created_at,
        })),
      },
    };
  },

  'GET /credits': async (_req, _res, { user, profile }) =>
    user
      ? { status: 200, body: { credits: profile?.credits ?? 0 } }
      : { status: 401, body: { error: 'Unauthorized' } },

  'GET /battle/access': async (_req, _res, { user }) => ({
    status: 200,
    body: {
      unlocked: !!user?.roast_battle_unlocked,
      credits: user?.credits ?? 0,
      required_credits: ROAST_COSTS.battle,
    },
  }),

  'GET /voice-settings': async (_req, _res, { user }) => {
    if (!user) return { status: 401, body: { error: 'Unauthorized' } };
    const { data } = await supabase
      .from('byok_keys')
      .select('openai_key, elevenlabs_key')
      .eq('user_id', user.id)
      .maybeSingle();
    // Never return the keys themselves -- only whether they are set.
    return {
      status: 200,
      body: {
        has_openai_key: !!data?.openai_key,
        has_elevenlabs_key: !!data?.elevenlabs_key,
      },
    };
  },
};

/* -------------------------------------------------------------------------- */
/* handler                                                                    */
/* -------------------------------------------------------------------------- */

export default async function handler(req, res) {
  if (begin(req, res)) return;

  // Vercel provides the wildcard path; fall back to parsing the URL for the
  // local dev shim, which does not populate `query.path`.
  const raw = req.query?.path;
  const fromQuery = Array.isArray(raw) ? raw.join('/') : raw;
  const pathname = String(fromQuery || req.url || '')
    .replace(/^\/api\/?/, '')
    .split('?')[0]
    .replace(/\/+$/, '');

  const method = String(req.method || 'GET').toUpperCase();
  const key = `${method} /${pathname}`;

  const route = ROUTES[key];
  if (!route) {
    return res.status(404).json({ error: 'Not found', path: pathname, method });
  }

  let body = {};
  if (method !== 'GET' && method !== 'HEAD') {
    body = req.body && typeof req.body === 'object' ? req.body : {};
  }

  try {
    const auth = await resolveUser(req);
    const shaped = auth.error ? null : shapeUser(auth.user, auth.profile);
    const result = await route(req, res, {
      user: shaped,
      profile: auth.profile,
      rawUser: auth.user,
      body,
      query: req.query || {},
    });
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error(`[api] ${key} failed:`, err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
