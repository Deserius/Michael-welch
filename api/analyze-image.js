import { requireUser, resolveProviderKeys } from './_auth.js';

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
    const { images, use_premium_gpt } = req.body || {};
    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: 'No images provided' });
    }

    const { openaiKey } = await resolveProviderKeys(user.id);
    if (!openaiKey) {
      return res.status(200).json({
        analysis: JSON.stringify({
          face_shape: 'unknown',
          hair: 'unknown',
          eyes: 'unknown',
          expression: 'unknown',
          build: 'unknown',
          style: 'unknown',
          distinctive_features: 'unknown',
          age_guess: 'unknown',
          vibe: 'unknown',
          roast_ammo: ['subject appears to exist', 'they showed up', 'they have a face'],
        }),
      });
    }

    const model = use_premium_gpt ? 'gpt-4o' : 'gpt-4o-mini';

    // Analyze ALL uploaded images and combine the analysis
    const analyses = [];
    for (let i = 0; i < Math.min(images.length, 4); i++) {
      try {
        const result = await analyzeImageWithVision(openaiKey, images[i], model);
        analyses.push(result);
      } catch (e) {
        console.error(`Image ${i} analysis failed:`, e.message);
      }
    }

    // If multiple images, synthesize a combined profile
    let finalAnalysis;
    if (analyses.length > 1) {
      finalAnalysis = await synthesizeProfile(openaiKey, analyses, model);
    } else {
      finalAnalysis = analyses[0] || '{}';
    }

    return res.status(200).json({ analysis: finalAnalysis });
  } catch (err) {
    console.error('analyze-image error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ===== Multi-stage image analysis pipeline =====
// Stage 1: Extract raw physical features from each photo
async function analyzeImageWithVision(apiKey, imageBase64, model) {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: `You are a forensic comedy analyst specializing in extracting every visible physical detail from a person's photo for a comedy roast. You are brutally honest, extremely specific, and miss NOTHING.

Analyze EVERY aspect of this person's appearance:

FACE:
- Face shape (oval, round, square, heart, long, wide, narrow)
- Jawline (strong, weak, receding, double chin, defined, soft)
- Forehead (size, shape, wrinkles, receding hairline)
- Eyebrows (thick, thin, unruly, plucked, mono-brow, arched, flat)
- Eyes (size, shape, color, bags, tired, close-set, wide-set, squinting, lazy)
- Nose (size, shape, crooked, bulbous, pointed, wide, broken)
- Lips (thin, full, chapped, smirk, frown, teeth visible, gap, overbite)
- Ears (size, shape, sticking out, pinned)
- Cheekbones (high, flat, hollow, prominent)
- Skin (texture, acne, scars, pores, shine, redness, age spots)

HAIR:
- Style (buzz, fade, mullet, bald, receding, combover, long, short, messy, greasy)
- Color (natural, dyed, greying, thinning)
- Hairline (intact, receding, widow's peak, bald spot, shaved)

EXPRESSION & DEMEANOR:
- Expression (smug, nervous, confident, bored, trying too hard, dead inside, fake smile)
- Body language (slouching, rigid, relaxed, tense, confident pose, awkward)
- Eye contact (direct, avoiding, squinting, dead-eyed)

STYLE & GROOMING:
- Clothing (style, fit, condition, trendiness, appropriateness, effort level)
- Accessories (glasses, jewelry, hats, watches, chains)
- Grooming (beard, stubble, clean-shaven, unkempt, over-groomed, messy)
- Fitness level (fit, skinny, overweight, muscular, average, dad bod)

VIBE:
- Overall energy (tries too hard, doesn't try enough, confused, confident but wrong)
- Age guess (be specific)
- "Type" (gym bro, tech nerd, wannabe, has-been, never-was, try-hard, edgelord, basic)
- Most mockable feature (the ONE thing a comedian would target first)

Return ONLY a JSON object with this exact structure:
{
  "face_shape": "detailed description",
  "jawline": "detailed description",
  "forehead": "detailed description",
  "eyebrows": "detailed description",
  "eyes": "detailed description",
  "nose": "detailed description",
  "lips_teeth": "detailed description",
  "ears": "detailed description",
  "skin": "detailed description",
  "hair": "detailed description",
  "hairline": "detailed description",
  "expression": "detailed description",
  "body_language": "detailed description",
  "clothing": "detailed description",
  "accessories": "detailed description",
  "grooming": "detailed description",
  "fitness": "detailed description",
  "age_guess": "specific number or range",
  "vibe": "2-3 word vibe",
  "type": "their stereotype",
  "most_mockable": "the single most roastable feature",
  "roast_ammo": ["specific detail 1", "specific detail 2", "specific detail 3", "specific detail 4", "specific detail 5", "specific detail 6", "specific detail 7", "specific detail 8"]
}`,
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Analyze this person for roast comedy material. Be EXTREMELY specific about every facial feature, expression, and appearance detail. Miss nothing. Every detail is ammunition.' },
            { type: 'image_url', image_url: { url: imageBase64, detail: 'high' } },
          ],
        },
      ],
      max_tokens: 1500,
      temperature: 0.7,
      response_format: { type: 'json_object' },
    }),
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Vision API ${resp.status}: ${t}`);
  }
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '{}';
}

// Stage 2: Synthesize multiple image analyses into a unified roast profile
async function synthesizeProfile(apiKey, analyses, model) {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: `You are a comedy roast director. You have received multiple photo analyses of the same person from different angles/photos. Synthesize them into a single unified roast profile that a team of comedians will use to write personalized, devastating roast material.

Combine the analyses, resolve any conflicts, and create the most comprehensive roast profile possible. Focus on the details that are most useful for comedy — the most visible, most mockable, most specific features.

Return ONLY a JSON object:
{
  "unified_profile": "3-5 sentence detailed description of this person's appearance and vibe",
  "face_shape": "consolidated description",
  "hair": "consolidated description", 
  "eyes": "consolidated description",
  "expression": "consolidated description",
  "build": "consolidated description",
  "style": "consolidated description",
  "distinctive_features": "the most notable/unique features",
  "age_guess": "best estimate",
  "vibe": "overall vibe in 2-3 words",
  "type": "their stereotype/type",
  "most_mockable": "the #1 most roastable thing about them",
  "roast_ammo": ["the 10 best specific details for comedy roasting, ranked by roast potential"]
}`,
        },
        {
          role: 'user',
          content: `Here are ${analyses.length} photo analyses of the same person:\n\n${analyses.map((a, i) => `PHOTO ${i + 1}:\n${a}`).join('\n\n')}\n\nSynthesize these into a unified roast profile.`,
        },
      ],
      max_tokens: 1200,
      temperature: 0.7,
      response_format: { type: 'json_object' },
    }),
  });

  if (!resp.ok) throw new Error(`Synthesis API ${resp.status}`);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || analyses[0] || '{}';
}
