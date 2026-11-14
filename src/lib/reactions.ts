// Dynamic AI-generated comedy reactions using Web Audio API.
// Replaces static SFX with procedural, context-aware reaction sounds.

type ReactionType = 'light-laugh' | 'big-laugh' | 'delayed-laugh' | 'silence' | 'crowd-pop' | 'surprise' | 'host-reaction';

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor();
  }
  return audioCtx;
}

// Generate a synthetic laugh using filtered noise bursts
function synthLaugh(ctx: AudioContext, intensity: number, delay: number) {
  const now = ctx.currentTime + delay;
  const duration = 0.3 + intensity * 0.4;
  const numBursts = Math.floor(3 + intensity * 5);

  for (let i = 0; i < numBursts; i++) {
    const t = now + (i / numBursts) * duration;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180 + Math.random() * 120, t);
    osc.frequency.exponentialRampToValueAtTime(120, t + 0.05);

    filter.type = 'bandpass';
    filter.frequency.value = 600 + Math.random() * 400;
    filter.Q.value = 2;

    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.04 * intensity, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.1);
  }
}

// Generate a crowd pop (cheer) using noise + filter sweep
function synthCrowdPop(ctx: AudioContext, delay: number) {
  const now = ctx.currentTime + delay;
  const duration = 1.2;

  const bufferSize = ctx.sampleRate * duration;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * 0.3;
  }

  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(400, now);
  filter.frequency.linearRampToValueAtTime(2000, now + 0.3);
  filter.frequency.linearRampToValueAtTime(800, now + duration);
  filter.Q.value = 1.5;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.06, now + 0.1);
  gain.gain.linearRampToValueAtTime(0.04, now + 0.5);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  noise.start(now);
  noise.stop(now + duration);
}

// Generate a surprise gasp
function synthSurprise(ctx: AudioContext, delay: number) {
  const now = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(300, now);
  osc.frequency.exponentialRampToValueAtTime(600, now + 0.15);

  filter.type = 'lowpass';
  filter.frequency.value = 1500;

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.08, now + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.35);
}

export function playReaction(type: ReactionType, volume = 0.5) {
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume();

  const vol = Math.max(0, Math.min(1, volume));

  switch (type) {
    case 'light-laugh':
      synthLaugh(ctx, 0.4 * vol, 0);
      break;
    case 'big-laugh':
      synthLaugh(ctx, 0.8 * vol, 0);
      synthLaugh(ctx, 0.6 * vol, 0.15);
      break;
    case 'delayed-laugh':
      synthLaugh(ctx, 0.7 * vol, 0.4);
      break;
    case 'crowd-pop':
      synthCrowdPop(ctx, 0);
      break;
    case 'surprise':
      synthSurprise(ctx, 0);
      break;
    case 'host-reaction':
      synthLaugh(ctx, 0.5 * vol, 0.1);
      break;
    case 'silence':
    default:
      break;
  }
}

// Smart reaction picker — chooses appropriate reaction based on line content and phase
export function pickReaction(line: string, phase: string): ReactionType {
  const lower = line.toLowerCase();

  // Finale gets a big crowd pop
  if (phase === 'finale') return 'crowd-pop';
  if (phase === 'open') return 'host-reaction';

  // Strong punchline indicators
  const strongPunch = ['mic drop', 'destroyed', 'wrecked', 'cancelled', 'fired', 'guilty', 'expelled', 'sunk', 'rekt', 'clapped'];
  if (strongPunch.some((w) => lower.includes(w))) return 'big-laugh';

  // Surprise indicators
  const surpriseWords = ['plot twist', 'wait', 'actually', 'turns out', 'surprise'];
  if (surpriseWords.some((w) => lower.includes(w))) return 'surprise';

  // Sexual/explicit content gets a delayed laugh (shock then laugh)
  const explicitWords = ['sex', 'bed', 'bedroom', 'fuck', 'dick', 'ass', 'tinder', 'onlyfans'];
  if (explicitWords.some((w) => lower.includes(w))) return 'delayed-laugh';

  // Longer lines get a bigger laugh
  if (line.length > 120) return 'big-laugh';

  // Default: light laugh
  return 'light-laugh';
}
