/**
 * AI provider resolution.
 *
 * Priority: the caller's own key (BYOK) -> app-wide key in global_settings ->
 * process env. Everything degrades gracefully: with no keys at all the app
 * still runs on a deterministic local engine so the UI is demonstrable.
 *
 * Providers
 *  - OpenRouter (OpenAI-compatible chat completions) for roast text
 *  - OpenAI direct          for roast text (fallback) and TTS
 *  - ElevenLabs             for premium speech
 */
import supabase from './_db-client.js';

/* -------------------------------------------------------------------------- */
/* key resolution                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Resolve every provider key the server can legitimately use.
 * Keys are never returned to the browser -- callers only get booleans.
 */
export async function resolveKeys(userId) {
  let byok = null;
  let global = null;

  if (userId) {
    const { data } = await supabase
      .from('byok_keys')
      .select('openai_key, elevenlabs_key, openrouter_key')
      .eq('user_id', userId)
      .maybeSingle();
    byok = data;
  }

  const { data } = await supabase
    .from('global_settings')
    .select('openai_key, elevenlabs_key, openrouter_key')
    .eq('id', 1)
    .maybeSingle();
  global = data;

  const pick = (...vals) => vals.find((v) => typeof v === 'string' && v.trim()) || '';

  return {
    openaiKey: pick(byok?.openai_key, global?.openai_key, process.env.OPENAI_API_KEY),
    elevenlabsKey: pick(
      byok?.elevenlabs_key,
      global?.elevenlabs_key,
      process.env.ELEVENLABS_API_KEY
    ),
    openrouterKey: pick(
      byok?.openrouter_key,
      global?.openrouter_key,
      process.env.OPENROUTER_API_KEY
    ),
    // Which provider actually won, for the diagnostics panel.
    textProvider: pick(byok?.openrouter_key, global?.openrouter_key, process.env.OPENROUTER_API_KEY)
      ? 'openrouter'
      : pick(byok?.openai_key, global?.openai_key, process.env.OPENAI_API_KEY)
        ? 'openai'
        : 'local',
  };
}

/* -------------------------------------------------------------------------- */
/* text generation                                                            */
/* -------------------------------------------------------------------------- */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

/** Models the app is willing to use, cheapest-first within each tier. */
export const TEXT_MODELS = {
  free: 'meta-llama/llama-3.1-8b-instruct',
  premium: 'anthropic/claude-3.5-sonnet',
  openai: 'gpt-4o-mini',
};

/**
 * One chat completion. Returns the raw text, or throws.
 * `tier` selects a model; OpenRouter and OpenAI share the response shape.
 */
export async function complete({ keys, messages, tier = 'free', maxTokens = 800, temperature = 0.9 }) {
  const useOpenRouter = !!keys.openrouterKey;
  if (!useOpenRouter && !keys.openaiKey) return null;

  const url = useOpenRouter ? OPENROUTER_URL : OPENAI_URL;
  const model = useOpenRouter ? TEXT_MODELS[tier] || TEXT_MODELS.free : TEXT_MODELS.openai;

  const headers = { 'Content-Type': 'application/json' };
  if (useOpenRouter) {
    headers.Authorization = `Bearer ${keys.openrouterKey}`;
    // OpenRouter asks for these for attribution/ranking.
    headers['HTTP-Referer'] = process.env.PUBLIC_SITE_URL || 'https://da-roastbox-beta.vercel.app';
    headers['X-Title'] = 'Da RoastBox';
  } else {
    headers.Authorization = `Bearer ${keys.openaiKey}`;
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`${useOpenRouter ? 'OpenRouter' : 'OpenAI'} ${resp.status}: ${body.slice(0, 300)}`);
  }

  const json = await resp.json();
  const text = json?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error('Empty completion');
  return text.trim();
}

/* -------------------------------------------------------------------------- */
/* speech                                                                     */
/* -------------------------------------------------------------------------- */

const ELEVENLABS_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const DEFAULT_ELEVEN_VOICE = 'pNInz6obpgDQGcFmaJgB'; // Adam

const OPENAI_VOICES = {
  persona_1: 'onyx',
  persona_2: 'shimmer',
  persona_3: 'echo',
  persona_4: 'onyx',
  persona_5: 'echo',
  persona_6: 'fable',
  persona_7: 'alloy',
  persona_8: 'nova',
};

export function openaiVoiceFor(personaId) {
  return OPENAI_VOICES[personaId] || 'onyx';
}

/** ElevenLabs synthesis -> base64 mp3 data URI. */
export async function elevenLabsSpeech({ apiKey, text, voiceId, speed = 1 }) {
  const resp = await fetch(`${ELEVENLABS_URL}/${voiceId || DEFAULT_ELEVEN_VOICE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75, speed },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!resp.ok) throw new Error(`ElevenLabs ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  return `data:audio/mp3;base64,${buf.toString('base64')}`;
}

/** OpenAI TTS -> base64 mp3 data URI (the fallback path). */
export async function openaiSpeech({ apiKey, text, voice = 'onyx', speed = 1 }) {
  const resp = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'tts-1',
      voice,
      input: text,
      speed,
      response_format: 'mp3',
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!resp.ok) throw new Error(`OpenAI TTS ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  return `data:audio/mp3;base64,${buf.toString('base64')}`;
}

/* -------------------------------------------------------------------------- */
/* diagnostics shape                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The `openrouter` block the bundle's diagnostics panel reads.
 * `profile` per tier must expose `.vision` and `.writer` strings.
 */
export function openrouterStatus(keys) {
  const configured = !!keys.openrouterKey;
  const profile = {
    vision: configured ? TEXT_MODELS.free : 'not configured',
    writer: configured ? TEXT_MODELS.free : 'not configured',
  };
  return {
    configured,
    hosted_key: configured,
    free: { profile, available: configured },
    premium: {
      profile: {
        vision: configured ? TEXT_MODELS.premium : 'not configured',
        writer: configured ? TEXT_MODELS.premium : 'not configured',
      },
      available: configured,
    },
  };
}
