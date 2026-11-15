/**
 * Offline "AI" for the local preview.
 *
 * The sandbox cannot reach OpenRouter/OpenAI, so real generation is impossible
 * there regardless of keys. This produces a genuinely varied, persona-flavoured
 * transcript from local material so the preview demonstrates the full flow:
 * selection -> cost quote -> generation -> transcript -> history.
 *
 * It is clearly labelled `provider: "local"` in generation_meta, so nobody
 * mistakes it for the real model's output.
 */
import { PERSONAS } from './_personas-data.js';

/** Deterministic-but-varied pick, seeded by the call so output is not static. */
function pick(list, seed) {
  if (!list?.length) return '';
  const n = Math.abs(hash(seed)) % list.length;
  return list[n];
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < String(str).length; i += 1) {
    h ^= String(str).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h;
}

const OPENERS = [
  'Let me be honest with you,',
  'Look,',
  'Somebody had to say it:',
  'No disrespect, but',
  'Real talk —',
];

const CLOSERS = [
  'and I mean that with love.',
  'bless your heart.',
  "I'd say get help, but help would ask questions.",
  'somebody check on them.',
  'and that is coming from a professional.',
];

const REACTIONS = ['ooh', 'groan', 'cheer', 'laugh'];
const LAUGHS = ['none', 'light', 'medium', 'big'];

/**
 * Build a transcript.
 *
 * @param {object} opts
 * @param {Array} opts.chosen        persona objects
 * @param {string} opts.subject      roast subject
 * @param {boolean} opts.battle      battle mode
 * @param {string} opts.battleStyle  battle style label
 * @param {number} opts.lineCount    how many lines to produce
 */
export function localTranscript({ chosen, subject, battle, battleStyle, lineCount }) {
  const lines = [];
  const seedBase = `${subject}:${Date.now()}`;

  for (let i = 0; i < lineCount; i += 1) {
    // In battle mode the two fighters alternate; otherwise rotate the roster.
    const persona = battle
      ? chosen[i % chosen.length]
      : chosen[i % chosen.length];

    const punch = pick(persona.punchlines, `${seedBase}:${i}:punch`) || '';
    const lingo = pick(persona.lingo, `${seedBase}:${i}:lingo`) || '';
    const style = persona.voice_settings?.comedy_style || persona.role || 'deadpan';

    const opener = pick(OPENERS, `${seedBase}:${i}:open`);
    const closer = pick(CLOSERS, `${seedBase}:${i}:close`);

    let text;
    if (battle) {
      text = `${subject}! ${opener} your whole game is ${style} — ${punch} ${closer}`;
    } else {
      text = `${opener} ${subject}, ${punch} ${closer}`;
    }
    if (lingo && i % 3 === 0) {
      text = `${text} (${lingo}. Yeah, I said it.)`;
    }

    lines.push({
      persona_id: persona.id,
      text: text.replace(/\s+/g, ' ').trim().slice(0, 400),
      type: i === 0 ? 'setup' : 'joke',
      reaction: pick(REACTIONS, `${seedBase}:${i}:reaction`),
      laugh_after: pick(LAUGHS, `${seedBase}:${i}:laugh`),
      // No network: speech cannot be synthesised offline. The client falls back
      // to its own browser speech synthesis when audio_url is absent.
      audio_url: null,
    });
  }

  return lines;
}

/** Exposed for tests: proves output varies with the seed. */
export function localTranscriptFor(subject, personaId = 'persona_1', lineCount = 3) {
  const persona = PERSONAS.find((p) => p.id === personaId) || PERSONAS[0];
  return localTranscript({
    chosen: [persona],
    subject,
    battle: false,
    battleStyle: 'classic',
    lineCount,
  });
}
