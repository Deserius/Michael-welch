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
import {
  resolveKeys,
  complete,
  elevenLabsSpeech,
  openaiSpeech,
  openaiVoiceFor,
  openrouterStatus,
  TEXT_MODELS,
} from './_providers.js';

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
  if (error) {
    if (/fetch failed|ECONN|ENOTFOUND|socket/i.test(error.message || '')) {
      console.error('[auth] login could not reach Supabase:', error.message);
      return { status: 503, body: { error: 'Sign-in is temporarily unavailable' } };
    }
  }
  if (error || !data?.session) {
    return { status: 401, body: { error: 'Invalid email or password' } };
  }
  return { status: 200, body: { session_token: data.session.access_token } };
}

/**
 * POST /auth/email/register -- sign up with email + password.
 *
 * The bundle sends only `{ email }` and expects a message back; we create the
 * account with a generated password and email a confirmation when SMTP is
 * configured. With `mailer_autoconfirm` on (as in this project) the account is
 * usable immediately, so we return a session token straight away.
 */
async function registerWithEmail(body) {
  const email = String(body?.email || '').trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { status: 400, body: { error: 'Enter a valid email address' } };
  }

  const password =
    typeof body?.password === 'string' && body.password.length >= 6
      ? body.password
      : crypto.randomUUID().replace(/-/g, '') + 'Aa1!';

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error) {
    const message = error.message || '';
    const exists = /already registered|already been registered|duplicate/i.test(message);
    // Do not disclose whether an address is registered.
    if (exists) {
      return { status: 200, body: { message: 'If that address can be used, check your email.' } };
    }
    // Never leak transport internals to the client.
    if (/fetch failed|ECONN|ENOTFOUND|socket/i.test(message)) {
      console.error('[auth] register could not reach Supabase:', message);
      return { status: 503, body: { error: 'Sign-up is temporarily unavailable' } };
    }
    return { status: 400, body: { error: message } };
  }

  // Give the new account its starter credits.
  if (data?.user?.id) {
    await supabase.rpc('grant_credits', {
      p_user_id: data.user.id,
      p_amount: 10,
      p_type: 'starter',
      p_description: 'Welcome credits',
    });
  }

  const { data: session } = await supabase.auth.signInWithPassword({ email, password });
  return {
    status: 200,
    body: {
      message: 'Account created.',
      session_token: session?.session?.access_token || undefined,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* roast generation                                                           */
/* -------------------------------------------------------------------------- */


/** Deterministic offline line, used only when no AI provider is configured. */
function localLine(persona, subject) {
  const punch = persona.punchlines?.[0] || 'bless your heart';
  const style = persona.voice_settings?.comedy_style || 'dry';
  return `${subject}, ${persona.displayName || persona.name} here — ${style} as ever. ${punch}`;
}

const REACTIONS = ['ooh', 'groan', 'cheer', 'laugh'];

/**
 * Ask the configured text provider for a transcript.
 * Returns an array of segments, or null when no provider is configured.
 */
async function aiTranscript({ keys, chosen, subject, tier, battle, battleStyle, lineCount }) {
  const roster = chosen
    .map(
      (p) =>
        `- ${p.id} | ${p.displayName || p.name} | ${p.role} | comic energy: ${p.comic_inspiration}. Lingo: ${(p.lingo || []).join(', ')}`
    )
    .join('\n');

  const system =
    'You are a comedy writing engine for a roast show. Return ONLY JSON, no prose, no markdown fences.';

  const format = battle
    ? `Two fighters alternate ${battleStyle} battle bars aimed at each other, escalating.`
    : `Each roaster delivers one or more jokes about the subject, in the style of their character.`;

  const user = `Write ${lineCount} transcript lines total.

Subject: ${subject}
${battle ? `Format: ${battleStyle} rap-style battle.` : 'Format: group roast.'}
${format}

Roasters available (use their exact id):
${roster}

Return JSON of this exact shape:
{"lines":[{"persona_id":"persona_1","text":"the joke","type":"joke","reaction":"ooh","laugh_after":"none"}]}

Rules:
- "type" is one of: joke, punchline, setup, reaction.
- "reaction" is one of: ooh, groan, cheer, laugh.
- "laugh_after" is one of: none, light, medium, big.
- Keep each line under 240 characters and genuinely funny, not hateful.
- Vary the persona_id according to who wrote the line.`;

  const raw = await complete({
    keys,
    tier,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    maxTokens: 1200,
    temperature: 1.0,
  });
  if (!raw) return null;

  // Tolerate stray fences or leading prose around the JSON object.
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Provider did not return JSON');
  const parsed = JSON.parse(match[0]);
  const lines = Array.isArray(parsed?.lines) ? parsed.lines : [];

  return lines
    .filter((l) => l && typeof l.text === 'string' && l.text.trim())
    .map((l) => ({
      // Map back onto a real persona; fall back to the first selected one.
      persona_id: chosen.some((p) => p.id === l.persona_id) ? l.persona_id : chosen[0].id,
      text: String(l.text).trim().slice(0, 400),
      type: ['joke', 'punchline', 'setup', 'reaction'].includes(l.type) ? l.type : 'joke',
      reaction: REACTIONS.includes(l.reaction) ? l.reaction : 'laugh',
      laugh_after: ['none', 'light', 'medium', 'big'].includes(l.laugh_after)
        ? l.laugh_after
        : 'none',
    }));
}

/**
 * Synthesise speech for each line when a speech key exists.
 * Mutates segments to carry `audio_url` and reports which provider was used.
 */
async function attachSpeech({ keys, segments, chosen, premiumVoice }) {
  const byId = Object.fromEntries(chosen.map((p) => [p.id, p]));
  let provider = 'none';
  let fellBack = false;

  for (const seg of segments) {
    const persona = byId[seg.persona_id];
    const speed = persona?.voice_settings?.speed || 1;

    if (premiumVoice && keys.elevenlabsKey) {
      try {
        seg.audio_url = await elevenLabsSpeech({
          apiKey: keys.elevenlabsKey,
          text: seg.text,
          voiceId: persona?.voice_settings?.elevenlabs_voice_id,
          speed,
        });
        provider = 'elevenlabs';
        continue;
      } catch (e) {
        // Premium speech is an add-on; a failure must not fail the roast.
        console.error('[roast] ElevenLabs failed, falling back:', e.message);
        fellBack = true;
      }
    }

    if (keys.openaiKey) {
      try {
        seg.audio_url = await openaiSpeech({
          apiKey: keys.openaiKey,
          text: seg.text,
          voice: openaiVoiceFor(seg.persona_id),
          speed,
        });
        if (provider === 'none') provider = 'openai';
      } catch (e) {
        console.error('[roast] OpenAI TTS failed:', e.message);
      }
    }
  }

  return { provider, fellBack };
}

/**
 * Generate a roast or battle and charge for it.
 *
 * Charges through the atomic spend_credits RPC, so a concurrent request cannot
 * double-spend. Speech failures never roll back a charge the user did receive
 * text for; an add-on that fails is refunded by charging the base rate only.
 */
async function generateRoast(body, user, profile) {
  const subject = String(body?.subject || body?.subjectName || 'this legend').trim();
  const battle = !!body?.battle || body?.mode === 'battle';
  const battleStyle = String(body?.battle_style || 'classic');
  const requested = Array.isArray(body?.persona_ids) ? body.persona_ids : [];
  const chosen = requested.length
    ? PERSONAS.filter((p) => requested.includes(p.id))
    : PERSONAS.slice(0, 2);

  if (!chosen.length) {
    return { status: 400, body: { error: 'Select at least one roaster' } };
  }

  const premiumVoice = !!body?.premium_voice;
  const shaped = shapeUser(user, profile);

  // Premium speech is gated on entitlement, exactly like /api/tts.
  const voiceAllowed = premiumVoice && shaped.premium_voices_unlocked;

  const quote = quoteFor(
    {
      roast_tier: body?.roast_tier || 'standard',
      premium_voice: String(voiceAllowed),
      premium_persona: String(chosen.some((p) => p.tier === 'premium')),
    },
    shaped
  );

  const cost = quote.credits;
  if ((profile?.credits ?? 0) < cost) {
    return {
      status: 402,
      body: { error: 'Insufficient credits', credits: profile?.credits ?? 0, required: cost },
    };
  }

  const keys = await resolveKeys(user.id);

  // Write the transcript before charging, so a provider outage costs nothing.
  let segments;
  let textProvider = keys.textProvider;
  const lineCount = battle ? 8 : Math.max(3, chosen.length * 2);
  const tier = body?.roast_tier === 'premium' ? 'premium' : 'free';

  try {
    const ai = await aiTranscript({
      keys,
      chosen,
      subject,
      tier,
      battle,
      battleStyle,
      lineCount,
    });
    if (ai && ai.length) {
      segments = ai;
    } else {
      textProvider = 'local';
      segments = Array.from({ length: lineCount }, (_, i) => {
        const persona = chosen[i % chosen.length];
        return {
          persona_id: persona.id,
          text: localLine(persona, subject),
          type: 'joke',
          reaction: 'laugh',
          laugh_after: 'light',
        };
      });
    }
  } catch (e) {
    console.error('[roast] text generation failed, using local engine:', e.message);
    textProvider = 'local';
    segments = Array.from({ length: lineCount }, (_, i) => {
      const persona = chosen[i % chosen.length];
      return {
        persona_id: persona.id,
        text: localLine(persona, subject),
        type: 'joke',
        reaction: 'laugh',
        laugh_after: 'light',
      };
    });
  }

  const speech = await attachSpeech({ keys, segments, chosen, premiumVoice: voiceAllowed });

  // Charge atomically; the RPC raises if the balance moved underneath us.
  let remaining = profile?.credits ?? 0;
  if (cost > 0) {
    const { data, error } = await supabase.rpc('spend_credits', {
      p_user_id: user.id,
      p_amount: cost,
      p_description: battle ? `Battle: ${subject}` : `Roast: ${subject}`,
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

  const personaIds = chosen.map((p) => p.id);
  const { data: saved } = await supabase
    .from('roasts')
    .insert({
      user_id: user.id,
      subject_name: subject,
      persona_ids: personaIds,
      transcript: segments,
      duration_min: Math.max(1, Math.round((body?.duration_sec || 30) / 60)),
    })
    .select('id')
    .maybeSingle();

  return {
    status: 200,
    body: {
      roast_id: saved?.id ?? null,
      id: saved?.id ?? `roast_${Date.now()}`,
      subject_name: subject,
      persona_ids: personaIds,
      transcript: segments,
      mode: battle ? 'battle' : 'roast',
      battle_style: battle ? battleStyle : undefined,
      image_count: 0,
      credits_spent: cost,
      credits_remaining: remaining,
      was_free_roast: false,
      // Only report a fallback when premium speech was actually requested.
      premium_voice_fallback: voiceAllowed && speech.fellBack,
      generation_meta: {
        text_provider: textProvider,
        text_model:
          textProvider === 'openrouter'
            ? TEXT_MODELS[tier] || TEXT_MODELS.free
            : textProvider === 'openai'
              ? TEXT_MODELS.openai
              : 'local-engine',
        speech_provider: speech.provider,
        premium_voice: voiceAllowed,
        battle,
      },
    },
  };
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

  'POST /auth/email/register': async (_req, _res, { body }) => registerWithEmail(body),

  'POST /auth/email/forgot': async (_req, _res, { body }) => {
    const email = String(body?.email || '').trim().toLowerCase();
    if (email) {
      // Fire-and-forget; never disclose whether the address exists.
      await supabase.auth.resetPasswordForEmail(email).catch(() => {});
    }
    return { status: 200, body: { message: 'If that address can be used, check your email.' } };
  },

  // Google sign-in lands back on /auth-complete.html, which either posts
  // {session_id} (popup) or redirects to /auth/callback. Both exchange a
  // Supabase session for the bearer token the bundle stores.
  'POST /auth/session': async (_req, _res, { body }) => {
    const sessionId = String(body?.session_id || '');
    if (!sessionId) return { status: 400, body: { error: 'Missing session_id' } };
    const { data, error } = await supabase.auth.exchangeCodeForSession(sessionId);
    if (error || !data?.session) {
      return { status: 401, body: { error: 'Could not verify that sign-in' } };
    }
    return { status: 200, body: { session_token: data.session.access_token } };
  },

  'GET /auth/google/start': async (_req, res) => {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    if (!clientId) {
      return { status: 503, body: { error: 'Google sign-in is not configured' } };
    }
    const query = new URL(_req.url, 'https://x').searchParams;
    const state = query.get('mode') || 'popup';
    const redirect = `${process.env.PUBLIC_SITE_URL || ''}/auth-complete.html?state=${
      query.get('state') || ''
    }&mode=${state}`;
    const url =
      'https://accounts.google.com/o/oauth2/v2/auth' +
      `?client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirect)}` +
      '&response_type=code&scope=openid%20email%20profile';
    res.setHeader('Location', url);
    res.status(302).end();
    return null;
  },

  'POST /auth/logout': async (req, res) => {
    res.setHeader('Set-Cookie', 'roastbox_session=; Path=/; Max-Age=0; SameSite=Lax');
    return { status: 200, body: { ok: true } };
  },

  'GET /configuration/status': async (_req, _res, { rawUser }) => {
    const keys = await resolveKeys(rawUser?.id);
    const googleConfigured = !!(
      process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET
    );
    const stripeKey = process.env.STRIPE_API_KEY || '';

    return {
      status: 200,
      body: {
        backend_configured: true,
        google: { configured: googleConfigured },
        email: { configured: true },
        speech: {
          configured: !!(keys.elevenlabsKey || keys.openaiKey),
          provider: keys.elevenlabsKey ? 'elevenlabs' : keys.openaiKey ? 'openai' : 'none',
          default: keys.elevenlabsKey ? 'elevenlabs' : 'openai',
        },
        text: { provider: keys.textProvider },
        openrouter: openrouterStatus(keys),
        stripe: {
          configured: !!stripeKey,
          // sk_test_ / rk_test_ keys are safe to exercise; live keys are not.
          test_key_format: /^(sk|rk)_test_/.test(stripeKey),
        },
      },
    };
  },

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

  'POST /battle/generate': async (_req, _res, { user, profile, body }) => {
    if (!user) return { status: 401, body: { error: 'Unauthorized' } };
    return generateRoast({ ...body, battle: true, mode: 'battle' }, user, profile);
  },

  'POST /battle': async (_req, _res, { user, profile, body }) => {
    if (!user) return { status: 401, body: { error: 'Unauthorized' } };
    return generateRoast({ ...body, battle: true, mode: 'battle' }, user, profile);
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

  // Save the caller's own provider keys. Never mirrors into global_settings.
  'POST /voice-settings/keys': async (_req, _res, { user, body }) => {
    if (!user) return { status: 401, body: { error: 'Unauthorized' } };
    const patch = {};
    if (typeof body?.openai_key === 'string') patch.openai_key = body.openai_key.trim() || null;
    if (typeof body?.elevenlabs_key === 'string')
      patch.elevenlabs_key = body.elevenlabs_key.trim() || null;
    if (typeof body?.openrouter_key === 'string')
      patch.openrouter_key = body.openrouter_key.trim() || null;
    if (!Object.keys(patch).length) {
      return { status: 400, body: { error: 'No keys provided' } };
    }
    const { error } = await supabase
      .from('byok_keys')
      .upsert({ user_id: user.id, ...patch }, { onConflict: 'user_id' });
    if (error) return { status: 500, body: { error: 'Could not save keys' } };
    return { status: 200, body: { ok: true } };
  },

  'DELETE /voice-settings/keys': async (_req, _res, { user }) => {
    if (!user) return { status: 401, body: { error: 'Unauthorized' } };
    await supabase.from('byok_keys').delete().eq('user_id', user.id);
    return { status: 200, body: { ok: true } };
  },

  'GET /voice-settings': async (_req, _res, { user }) => {
    if (!user) return { status: 401, body: { error: 'Unauthorized' } };
    const { data } = await supabase
      .from('byok_keys')
      .select('openai_key, elevenlabs_key, openrouter_key')
      .eq('user_id', user.id)
      .maybeSingle();
    // Never return the keys themselves -- only whether they are set.
    return {
      status: 200,
      body: {
        has_openai_key: !!data?.openai_key,
        has_elevenlabs_key: !!data?.elevenlabs_key,
        has_openrouter_key: !!data?.openrouter_key,
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
    // A route may write the response itself (e.g. a 302 redirect to Google)
    // and return null to signal that nothing further should be sent.
    if (!result) return;
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error(`[api] ${key} failed:`, err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
