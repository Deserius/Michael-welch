/**
 * Roast credit pricing — single source of truth.
 *
 * V4 computed this inline in both api/roast.js and src/pages/RoastStudio.tsx
 * while the Settings page advertised a completely different tariff
 * ("1 credit per minute", "3 credits per premium persona"). Extracting it
 * keeps the charge, the UI preview and the docs from drifting apart.
 */

export const BASE_COST = 1;
export const PREMIUM_PERSONA_COST = 1;
export const PREMIUM_MODEL_COST = 2;
export const ELEVENLABS_COST = 1;

/**
 * @param {object} opts
 * @param {Array<{tier?: string}>} opts.personas   selected roaster personas
 * @param {boolean} [opts.premiumModel]            GPT-4o instead of GPT-4o-mini
 * @param {boolean} [opts.premiumVoices]           ElevenLabs synthesis
 * @param {boolean} [opts.subscriber]              active subscription => free
 * @returns {{total: number, breakdown: Record<string, number>}}
 */
export function calcRoastCost({ personas = [], premiumModel = false, premiumVoices = false, subscriber = false } = {}) {
  const premiumPersonas = personas.filter((p) => p && p.tier === 'premium').length;

  const breakdown = {
    base: BASE_COST,
    premium_personas: premiumPersonas * PREMIUM_PERSONA_COST,
    premium_model: premiumModel ? PREMIUM_MODEL_COST : 0,
    premium_voices: premiumVoices ? ELEVENLABS_COST : 0,
  };

  // Subscribers bypass all credit charges.
  const total = subscriber ? 0 : Object.values(breakdown).reduce((a, b) => a + b, 0);

  return { total, breakdown };
}

/** Clamp the requested duration to a sane, billable window. */
export function clampDuration(value, fallback = 5) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(3, Math.min(10, n));
}

/** Clamp the requested intensity to 1–5. */
export function clampIntensity(value, fallback = 3) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(1, Math.min(5, n));
}

/** How many lines each persona gets, to fill the requested duration. */
export function linesPerPersona(durationMin, personaCount) {
  if (!personaCount || personaCount < 1) return 2;
  // ~15 seconds of speech per line.
  const totalLines = Math.ceil((durationMin * 60) / 15);
  return Math.max(2, Math.ceil(totalLines / personaCount));
}
