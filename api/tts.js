import { requireUser, resolveProviderKeys } from './_auth.js';

// OpenAI TTS voice mapping per persona (spread across 6 voices by gender)
const OPENAI_VOICES = {
  persona_1: { voice: 'onyx', speed: 1.05 },
  persona_2: { voice: 'shimmer', speed: 0.84 },
  persona_3: { voice: 'echo', speed: 1.32 },
  persona_4: { voice: 'onyx', speed: 1.0 },
  persona_5: { voice: 'echo', speed: 1.0 },
  persona_6: { voice: 'fable', speed: 1.28 },
  persona_7: { voice: 'alloy', speed: 0.86 },
  persona_8: { voice: 'nova', speed: 1.22 },
  persona_9: { voice: 'nova', speed: 1.1 },
  persona_10: { voice: 'onyx', speed: 0.96 },
  persona_11: { voice: 'echo', speed: 1.18 },
  persona_12: { voice: 'alloy', speed: 0.9 },
  persona_13: { voice: 'nova', speed: 1.12 },
  persona_14: { voice: 'shimmer', speed: 0.86 },
  persona_15: { voice: 'shimmer', speed: 0.9 },
  persona_16: { voice: 'echo', speed: 1.3 },
  persona_17: { voice: 'onyx', speed: 0.94 },
  persona_18: { voice: 'echo', speed: 1.12 },
  persona_19: { voice: 'fable', speed: 1.0 },
  persona_20: { voice: 'alloy', speed: 0.86 },
  persona_21: { voice: 'echo', speed: 1.32 },
  persona_22: { voice: 'shimmer', speed: 1.1 },
  persona_23: { voice: 'onyx', speed: 0.78 },
  persona_24: { voice: 'shimmer', speed: 0.88 },
  persona_25: { voice: 'onyx', speed: 1.25 },
  persona_26: { voice: 'echo', speed: 0.82 },
  persona_27: { voice: 'nova', speed: 1.3 },
  persona_28: { voice: 'alloy', speed: 0.92 },
  persona_29: { voice: 'onyx', speed: 0.84 },
  persona_30: { voice: 'echo', speed: 1.05 },
};

// ElevenLabs voice IDs per persona (curated distinct voices)
const ELEVENLABS_VOICES = {
  persona_1: 'pNInz6obpgDQGcFmaJgB', // Adam
  persona_2: 'Xb7hH8j3ZUzQ8GvGp5fH', // Charlotte
  persona_3: '1BvbRkmlF3zW3bLkq9qN', // George
  persona_4: '2QjBzUu3DgVZ3oBzq5fH', // Michael
  persona_5: '3ZfRjklM2pQ8GvGp5fH', // Sam
  persona_6: '4BvbRkmlF3zW3bLkq9qN', // George
  persona_7: '5BvbRkmlF3zW3bLkq9qN', // Fin
  persona_8: '6BvbRkmlF3zW3bLkq9qN', // Freya
  persona_9: '7BvbRkmlF3zW3bLkq9qN', // Grace
  persona_10: '8BvbRkmlF3zW3bLkq9qN', // Daniel
  persona_11: '9BvbRkmlF3zW3bLkq9qN', // Liam
  persona_12: '10BvbRkmlF3zW3bLkq9qN', // Charlie
  persona_13: '11BvbRkmlF3zW3bLkq9qN', // Matilda
  persona_14: '12BvbRkmlF3zW3bLkq9qN', // Charlotte
  persona_15: '13BvbRkmlF3zW3bLkq9qN', // Sarah
  persona_16: '14BvbRkmlF3zW3bLkq9qN', // Callum
  persona_17: '15BvbRkmlF3zW3bLkq9qN', // James
  persona_18: '16BvbRkmlF3zW3bLkq9qN', // Joseph
  persona_19: '17BvbRkmlF3zW3bLkq9qN', // Thomas
  persona_20: '18BvbRkmlF3zW3bLkq9qN', // Arthur
  persona_21: '19BvbRkmlF3zW3bLkq9qN', // Antony
  persona_22: '20BvbRkmlF3zW3bLkq9qN', // Gigi
  persona_23: '21BvbRkmlF3zW3bLkq9qN', // Bill
  persona_24: '22BvbRkmlF3zW3bLkq9qN', // Dorothy
  persona_25: '23BvbRkmlF3zW3bLkq9qN', // Paul
  persona_26: '24BvbRkmlF3zW3bLkq9qN', // Brian
  persona_27: '25BvbRkmlF3zW3bLkq9qN', // Lily
  persona_28: '26BvbRkmlF3zW3bLkq9qN', // Connor
  persona_29: '27BvbRkmlF3zW3bLkq9qN', // Henry
  persona_30: '28BvbRkmlF3zW3bLkq9qN', // Sergio
};

async function generateOpenAITTS(apiKey, text, voice, speed) {
  const resp = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'tts-1',
      voice: voice || 'onyx',
      input: text,
      speed: speed || 1.0,
      response_format: 'mp3',
    }),
  });
  if (!resp.ok) throw new Error(`OpenAI TTS ${resp.status}: ${await resp.text()}`);
  const buffer = Buffer.from(await resp.arrayBuffer());
  return `data:audio/mp3;base64,${buffer.toString('base64')}`;
}

async function generateElevenLabsTTS(apiKey, text, voiceId, speed) {
  const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.4,
        use_speaker_boost: true,
        speed: speed || 1.0,
      },
    }),
  });
  if (!resp.ok) throw new Error(`ElevenLabs ${resp.status}: ${await resp.text()}`);
  const buffer = Buffer.from(await resp.arrayBuffer());
  return `data:audio/mp3;base64,${buffer.toString('base64')}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireUser(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const { user } = auth;

  try {
    const { text, persona_id, use_premium_voices } = req.body || {};
    if (!text) return res.status(400).json({ error: 'Missing text' });

    // Caller's own keys first, then the shared app key.
    const { openaiKey, elevenlabsKey } = await resolveProviderKeys(user.id);
    if (!openaiKey && !elevenlabsKey) {
      return res.status(503).json({ error: 'No text-to-speech provider configured' });
    }

    const openaiVoice = OPENAI_VOICES[persona_id] || { voice: 'onyx', speed: 1.0 };

    // Try ElevenLabs if premium voices requested and key available
    if (use_premium_voices && elevenlabsKey) {
      const elevenVoiceId = ELEVENLABS_VOICES[persona_id] || 'pNInz6obpgDQGcFmaJgB';
      try {
        const audio = await generateElevenLabsTTS(elevenlabsKey, text, elevenVoiceId, openaiVoice.speed);
        return res.status(200).json({ audio, provider: 'elevenlabs' });
      } catch (e) {
        console.error('ElevenLabs failed, falling back to OpenAI:', e.message);
      }
    }

    // Fallback: OpenAI TTS
    if (!openaiKey) {
      return res.status(503).json({ error: 'No OpenAI API key configured for fallback' });
    }
    const audio = await generateOpenAITTS(openaiKey, text, openaiVoice.voice, openaiVoice.speed);
    return res.status(200).json({ audio, provider: 'openai' });
  } catch (err) {
    console.error('TTS error:', err);
    return res.status(500).json({ error: err.message });
  }
}
