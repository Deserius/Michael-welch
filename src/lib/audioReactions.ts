/**
 * Dynamic AI-style reaction audio system for Da RoastBox.
 * Uses Web Audio API to generate unique reactions per joke —
 * no static MP3 files, every reaction is synthesized live.
 */

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (!audioCtx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// Generate a single laugh burst with natural pitch variation
function laughBurst(ctx: AudioContext, startTime: number, intensity: 'light' | 'big' | 'delayed') {
  const numHa = intensity === 'big' ? 5 : intensity === 'delayed' ? 3 : 2;
  const baseFreq = intensity === 'big' ? 180 : 220;
  const duration = intensity === 'big' ? 0.12 : 0.08;
  const gap = intensity === 'big' ? 0.09 : 0.07;
  const volume = intensity === 'big' ? 0.15 : intensity === 'delayed' ? 0.1 : 0.06;
  const delay = intensity === 'delayed' ? 0.3 : 0;

  for (let i = 0; i < numHa; i++) {
    const t = startTime + delay + i * gap;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = baseFreq + i * 30;
    filter.Q.value = 5;
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(baseFreq + i * 20, t);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.8, t + duration);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
    osc.start(t); osc.stop(t + duration + 0.02);
  }
}

// Crowd pop — rising energy swell
function crowdPop(ctx: AudioContext, startTime: number) {
  const duration = 1.2;
  const noise = ctx.createBufferSource();
  const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const progress = i / data.length;
    data[i] = (Math.random() * 2 - 1) * Math.pow(progress, 0.5) * 0.3;
  }
  noise.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(400, startTime);
  filter.frequency.exponentialRampToValueAtTime(2000, startTime + duration * 0.5);
  filter.frequency.exponentialRampToValueAtTime(800, startTime + duration);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(0.08, startTime + 0.3);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  noise.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
  noise.start(startTime); noise.stop(startTime + duration);
}

// Surprise — sharp intake
function surprise(ctx: AudioContext, startTime: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(800, startTime);
  osc.frequency.exponentialRampToValueAtTime(300, startTime + 0.15);
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(0.1, startTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.2);
  osc.connect(gain); gain.connect(ctx.destination);
  osc.start(startTime); osc.stop(startTime + 0.25);
}

// Host reaction — a knowing chuckle
function hostReaction(ctx: AudioContext, startTime: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(150, startTime);
  osc.frequency.linearRampToValueAtTime(120, startTime + 0.3);
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(0.05, startTime + 0.05);
  gain.gain.linearRampToValueAtTime(0.03, startTime + 0.15);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.4);
  osc.connect(gain); gain.connect(ctx.destination);
  osc.start(startTime); osc.stop(startTime + 0.45);
}

// Applause — sustained noise burst
function applause(ctx: AudioContext, startTime: number, duration: number = 2.0) {
  const noise = ctx.createBufferSource();
  const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const t = i / ctx.sampleRate;
    const clapRate = 4 + Math.sin(t * 8) * 2;
    const envelope = Math.sin(t * clapRate * Math.PI) ** 4;
    data[i] = (Math.random() * 2 - 1) * envelope * 0.4 * (1 - t / duration * 0.3);
  }
  noise.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 1500; filter.Q.value = 2;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.06, startTime);
  gain.gain.linearRampToValueAtTime(0.08, startTime + 0.3);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  noise.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
  noise.start(startTime); noise.stop(startTime + duration);
}

export type ReactionType = 'light_laugh' | 'big_laugh' | 'delayed_laugh' | 'silence' | 'crowd_pop' | 'surprise' | 'host_reaction' | 'applause';

export function playReaction(type: ReactionType) {
  try {
    const ctx = getCtx();
    if (!ctx) return;
    const now = ctx.currentTime + 0.02;
    switch (type) {
      case 'light_laugh': laughBurst(ctx, now, 'light'); break;
      case 'big_laugh': laughBurst(ctx, now, 'big'); break;
      case 'delayed_laugh': laughBurst(ctx, now, 'delayed'); break;
      case 'crowd_pop': crowdPop(ctx, now); break;
      case 'surprise': surprise(ctx, now); break;
      case 'host_reaction': hostReaction(ctx, now); break;
      case 'applause': applause(ctx, now, 2.5); break;
      case 'silence': break; // intentional pause
    }
  } catch {
    // Audio context not available — silently skip
  }
}

// Smart reaction selector — picks appropriate reaction based on joke intensity
export function smartReaction(jokeIntensity: number, isPunchline: boolean): ReactionType {
  if (!isPunchline) {
    return Math.random() > 0.7 ? 'host_reaction' : 'silence';
  }
  if (jokeIntensity >= 8) {
    const r = Math.random();
    if (r < 0.5) return 'big_laugh';
    if (r < 0.7) return 'crowd_pop';
    if (r < 0.85) return 'surprise';
    return 'applause';
  }
  if (jokeIntensity >= 5) {
    const r = Math.random();
    if (r < 0.5) return 'big_laugh';
    if (r < 0.8) return 'light_laugh';
    return 'delayed_laugh';
  }
  if (jokeIntensity >= 3) {
    const r = Math.random();
    if (r < 0.5) return 'light_laugh';
    if (r < 0.8) return 'delayed_laugh';
    return 'silence';
  }
  return Math.random() > 0.5 ? 'light_laugh' : 'silence';
}

export function playIntro() {
  playReaction('crowd_pop');
}

export function playOutro() {
  playReaction('applause');
}
