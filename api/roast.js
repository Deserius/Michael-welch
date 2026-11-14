import supabase from './db-client.js';
import { getPersonasByIds } from './personas-data.js';
import { requireUser, resolveProviderKeys } from './_auth.js';
import { calcRoastCost, clampDuration, clampIntensity, linesPerPersona } from './_pricing.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const auth = await requireUser(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const { user } = auth;

  try {
    if (req.method === 'GET') {
      const { data: roasts, error } = await supabase
        .from('roasts')
        .select('id, subject_name, persona_ids, transcript, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return res.status(200).json({ roasts: roasts || [] });
    }

    if (req.method === 'POST') {
      const {
        persona_ids, subject_name, user_context, image_hints,
        duration, intensity, explicit, premium_model, elevenlabs, images,
      } = req.body || {};
      const ids = (persona_ids || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (ids.length === 0) return res.status(400).json({ error: 'Pick at least 1 roaster' });

      const durationMin = clampDuration(duration);
      const intensityLevel = clampIntensity(intensity);
      const explicitMode = explicit !== false; // default true
      const usePremiumModel = !!premium_model;

      const personas = getPersonasByIds(ids);
      if (personas.length === 0) {
        return res.status(400).json({ error: 'None of those roasters exist' });
      }

      // Subscribers get roasts for free.
      const { data: subRow } = await supabase
        .from('profiles')
        .select('subscription_tier')
        .eq('user_id', user.id)
        .maybeSingle();

      const { total: totalCost, breakdown } = calcRoastCost({
        personas,
        premiumModel: usePremiumModel,
        premiumVoices: !!elevenlabs,
        subscriber: !!subRow?.subscription_tier,
      });

      // Charge atomically. The V4 code did select-then-update, so two
      // concurrent requests could both pass the balance check and double-spend.
      // spend_credits() re-checks and decrements in one statement and writes
      // the ledger row in the same transaction.
      const description = `Roast of ${subject_name || 'subject'} (${durationMin}min, intensity ${intensityLevel}${usePremiumModel ? ', premium AI' : ''})`;

      let creditsRemaining;
      const { data: spent, error: spendErr } = await supabase.rpc('spend_credits', {
        p_user_id: user.id,
        p_amount: totalCost,
        p_description: description,
      });

      if (spendErr) {
        const isBroke = /insufficient_credits/.test(spendErr.message || '');
        const { data: profile } = await supabase
          .from('profiles')
          .select('credits')
          .eq('user_id', user.id)
          .maybeSingle();

        if (isBroke) {
          return res.status(402).json({
            error: `Need ${totalCost} credits (base: ${breakdown.base}, premium personas: ${breakdown.premium_personas}, premium AI: ${breakdown.premium_model}, premium voices: ${breakdown.premium_voices}). You have ${profile?.credits || 0}.`,
            credits_needed: totalCost,
            credits_have: profile?.credits || 0,
          });
        }
        throw spendErr;
      }
      creditsRemaining = spent;

      const subject = (subject_name || 'this poor soul').trim();
      const context = (user_context || '').trim();
      const hints = (image_hints || '').trim();

      const linesEach = linesPerPersona(durationMin, personas.length);

      // ---- IMAGE ANALYSIS PIPELINE ----
      // BYOK first, then the global key, then the environment. V4 only ever
      // read process.env here, so a user's own key was silently ignored.
      let visualProfile = null;
      const { openaiKey } = await resolveProviderKeys(user.id);
      if (openaiKey && images && images.length > 0) {
        try {
          visualProfile = await analyzeImage(openaiKey, images[0], usePremiumModel);
        } catch (e) {
          console.error('Image analysis failed:', e.message);
          visualProfile = null;
        }
      }

      // ---- ROAST GENERATION ----
      let transcript = null;
      if (openaiKey) {
        try {
          transcript = await generateWithOpenAI(openaiKey, personas, subject, context, hints, visualProfile, linesEach, intensityLevel, explicitMode, usePremiumModel);
        } catch (e) {
          console.error('OpenAI roast failed, falling back:', e.message);
          transcript = null;
        }
      }

      if (!transcript) {
        transcript = generateLocalRoast(personas, subject, context, linesEach, intensityLevel, explicitMode);
      }

      // Save roast
      const insertData = {
        user_id: user.id,
        subject_name: subject,
        persona_ids: ids,
        transcript,
        duration_min: durationMin,
      };
      const { data: saved, error: saveErr } = await supabase
        .from('roasts')
        .insert(insertData)
        .select('id')
        .single();
      // Saving history is best-effort: the user already paid for the roast, so
      // a persistence failure must not turn into a 500 with credits consumed.
      if (saveErr) console.error('roast save failed:', saveErr.message);

      return res.status(201).json({
        roast_id: saved?.id || null,
        transcript,
        credits_remaining: creditsRemaining,
        credits_spent: totalCost,
        visual_profile: visualProfile,
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('roast error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ---- IMAGE ANALYSIS (OpenAI Vision) ----
async function analyzeImage(apiKey, base64Image, usePremium) {
  const model = usePremium ? 'gpt-4o' : 'gpt-4o-mini';
  const base64Data = base64Image.includes(',') ? base64Image.split(',')[1] : base64Image;

  const prompt = `You are a comedy roast visual analyst. Analyze this person's VISIBLE presentation only — no invented facts.
Return a JSON object with these fields:
{
  "expression": "what their face looks like (smug, bored, trying too hard, etc.)",
  "hairstyle": "describe the hair",
  "outfit": "describe what they're wearing",
  "pose": "body language and posture",
  "style": "overall style vibe (try-hard, basic, overdone, etc.)",
  "background": "what's behind them",
  "energy": "overall energy they're giving off",
  "visual_hooks": ["3-5 specific roastable visual details"],
  "style_hooks": ["2-3 style-based roast angles"],
  "best_angles": ["2-3 best comedy angles to attack from"]
}
Be specific, observant, and brutally honest. This is for a comedy roast — find the funny in their appearance.`;

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You are a visual comedy analyst. Return only valid JSON.' },
        { role: 'user', content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Data}` } },
        ]},
      ],
      max_tokens: 800,
      temperature: 0.7,
      response_format: { type: 'json_object' },
    }),
  });

  if (!resp.ok) throw new Error(`Vision API ${resp.status}`);
  const data = await resp.json();
  return JSON.parse(data.choices?.[0]?.message?.content || '{}');
}

// ---- OPENAI ROAST GENERATION ----
async function generateWithOpenAI(apiKey, personas, subject, context, hints, visualProfile, linesPerPersona, intensity, explicit, usePremium) {
  const model = usePremium ? 'gpt-4o' : 'gpt-4o-mini';
  const personaBrief = personas.map((p) =>
    `- ${p.displayName} (${p.role}, inspired by ${p.comic_inspiration}): ${p.quirks_prompt} Lingo: ${p.lingo.join(', ')}. Voice: ${p.voice_settings.comedy_style}.`
  ).join('\n');

  const intensityMap = { 1: 'mild and teasing', 2: 'moderate and sharp', 3: 'spicy and biting', 4: 'savage and brutal', 5: 'nuclear and absolutely devastating' };
  const intensityDesc = intensityMap[intensity] || intensityMap[3];

  const visualContext = visualProfile ? `
VISUAL ANALYSIS (from photo):
- Expression: ${visualProfile.expression || 'N/A'}
- Hairstyle: ${visualProfile.hairstyle || 'N/A'}
- Outfit: ${visualProfile.outfit || 'N/A'}
- Pose: ${visualProfile.pose || 'N/A'}
- Style: ${visualProfile.style || 'N/A'}
- Energy: ${visualProfile.energy || 'N/A'}
- Visual hooks: ${(visualProfile.visual_hooks || []).join('; ')}
- Best comedy angles: ${(visualProfile.best_angles || []).join('; ')}
USE THESE VISUAL DETAILS to make the roast personal and specific.` : '';

  const explicitInstruction = explicit
    ? 'EXPLICIT MODE ON: Use raw, uncensored, R-rated adult language. Sexual innuendo, bedroom jokes, and savage personal attacks are EXPECTED and ENCOURAGED. No filters, no apologies. This is a Comedy Central roast for adults.'
    : 'Keep it sharp but PG-13. No explicit sexual content. Still funny and biting.';

  const systemPrompt = `You are the head writer for "Da RoastBox", an uncensored adult comedy roast show (18+).
${explicitInstruction}
Intensity level: ${intensityDesc}.

SCRIPT STRUCTURE (follow this flow):
1. OPEN: The first persona delivers a dynamic opening — "WELCOME TO DA ROASTBOX!" — introduces the show, names the roasters participating, and introduces the subject being roasted. Make it feel like a real roast show opening.
2. OBSERVATION: Each persona uses the strongest visual/contextual details to observe → punchline.
3. BUILD: Energy increases. Use callbacks, misdirection, rule of three, escalation.
4. RAPID FIRE: Fast observation → punchline → pause → reaction format.
5. FINALE: The last persona returns to the strongest joke, delivers a final callback, signs off, and thanks everyone for coming to Da RoastBox.

Generate ${linesPerPersona} roast lines per persona. Each line is 1-3 sentences, in-character, genuinely funny.
The roast must fill approximately ${linesPerPersona * personas.length} total lines to last the full duration.
Return ONLY a JSON array: [{"persona_id":"persona_1","line":"...","phase":"open|observation|build|rapidfire|finale"}]
The first line must have phase "open" and the last line must have phase "finale".
Distribute lines so personas alternate.`;

  const userPrompt = `Subject: ${subject}
${context ? `Context / inside jokes: ${context}` : ''}
${hints ? `Additional notes: ${hints}` : ''}
${visualContext}

Roasters:
${personaBrief}

Write the full roast now. JSON array only. Make it personal, original, and devastating.`;

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.95,
      max_tokens: Math.min(4000, 400 * personas.length * linesPerPersona),
      response_format: { type: 'json_object' },
    }),
  });

  if (!resp.ok) throw new Error(`OpenAI ${resp.status}`);
  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content || '{}';
  let parsed;
  try { parsed = JSON.parse(content); } catch { parsed = { lines: JSON.parse(content) }; }
  const arr = Array.isArray(parsed) ? parsed : (parsed.lines || parsed.roasts || parsed.array || []);
  if (!Array.isArray(arr) || arr.length === 0) throw new Error('Empty response');
  return arr.map((item) => ({
    persona_id: item.persona_id,
    line: item.line,
    phase: item.phase || 'observation',
  })).filter((x) => x.persona_id && x.line);
}

// ---- LOCAL COMEDY ENGINE ----
function generateLocalRoast(personas, subject, context, linesPerPersona, intensity, explicit) {
  const name = subject;
  const firstName = name.split(/\s+/)[0];
  const intensityPrefix = ['', '', '', '', 'Listen up, ', 'Alright motherfucker, '][intensity] || '';

  const POOLS = {
    persona_1: [
      `Check this, ${firstName} — baby, you look like the 'before' picture nobody asked to see. Real talk, your whole vibe is a cautionary tale with bad lighting.`,
      `${firstName}, playa, sex with you must feel like waitin' on customer service — long, awkward, and no resolution at the end. Ohhh sheeeeit.`,
      `Look at ${firstName} — got more filters than personality, baby. That ain't drip, that's a leak.`,
      `${firstName}, you got that "almost famous" energy. The kind of charisma that fills a thimble and empties a room. Real talk.`,
    ],
    persona_2: [
      `Bless your heart, sweetie — your sex life sounds like my dial-up internet: loud, slow, and embarrassing for everyone in the house.`,
      `${firstName}, dear, I had three husbands die on me — and even they hung in longer than you last in bed.`,
      `Oh honey, your Tinder profile says 'looking for adventure' but your browser history says 'looking for validation.'`,
      `Sweetie, ${firstName}, I've seen more ambition in a jar of mayonnaise. And the mayonnaise had better dating prospects.`,
    ],
    persona_3: [
      `Bro, your OnlyFans is your mom — and even she muted notifications. Deadass.`,
      `${firstName} is literally a human pop-up ad — nobody asked for you, everyone tries to close you. Down bad.`,
      `Yo ${firstName}, your dating life is like a Pornhub category nobody clicks on. Literally tragic.`,
      `Bro, you're not 'low T,' you're just unfuckable. Different problem entirely. Couldn't be me.`,
    ],
    persona_4: [
      `${firstName}, let's circle back to your career trajectory — it's a downward dog, and not the yoga kind.`,
      `I've seen better performance from a dial-up modem, ${firstName} — and at least that had an excuse to be slow.`,
      `${firstName}, your ambition filed for an extension and got denied. The board voted: unanimous no.`,
      `Your bedroom KPIs are in the red, ${firstName}. Take this offline. Permanently.`,
    ],
    persona_5: [
      `Yo ${firstName}, dog, I wrote a verse about your bedroom game — but even the beat fell asleep. Ya dig?`,
      `${firstName}, nephew, your whole existence is a footnote without a hook. Fo shizzle, that's real talk.`,
      `Check it, ${firstName} — you're a metaphor for mediocrity, and the metaphor's generous. Even the pen quit.`,
      `Dog, your sex life is a broken record — same sad track, same weak verse, no remix.`,
    ],
    persona_6: [
      `GG, ${firstName} — your sex life has worse FPS than a dial-up Game Boy. Get clapped.`,
      `Yo ${firstName}, you'd lag out of your own destiny. Touch grass, bro. Actually, touch a woman first.`,
      `${firstName}, your stats are all dumped into 'exists.' Zero charisma, zero rizz, max cringe. GG: Gone and Gone.`,
      `Bro, you're the tutorial level of a person — easy mode, no boss, no loot, no point.`,
    ],
    persona_7: [
      `${firstName}... your personality is like your sex life — brief, disappointing, and nobody talks about it after. Hmm.`,
      `Breathe, ${firstName}. Now exhale your whole personality. It was small enough to fit in one breath.`,
      `${firstName}... I'm not saying you're ugly, but your reflection looks away first. Let that sit.`,
      `Interesting, ${firstName}. Your dating history is a masterclass in settling. Breathe through that.`,
    ],
    persona_8: [
      `AND ON THIS STAGE — ${firstName}! Sip tea, honey, because your dating profile says 'adventure' but your history says 'validation.' How you doin? TRAGIC.`,
      `${firstName}, honey, I've seen more chemistry in a bottle of water than in your last relationship. Plot twist: STILL boring!`,
      `Hot topic: ${firstName}'s entire existence! Your sex life is a cancelled pilot — nobody picked it up.`,
      `How you doin, ${firstName}? Not good, clearly. The receipts don't lie, baby!`,
    ],
    persona_9: [
      `${firstName}, you're a decaf human in a double-shot world — weak, bitter, and nobody orders you twice.`,
      `Order up for ${firstName}: a tall cup of 'tries too hard' with a splash of 'nobody asked.' No foam, no flavor.`,
      `${firstName}, your sex life is like a broken espresso machine — all noise, no extraction. Extra shot of sadness.`,
      `Bitter, like your excuses, ${firstName}. Decaf energy, oat milk personality. I've seen more chemistry in instant coffee.`,
    ],
    persona_10: [
      `Ladies and germs, direct from obscurity — ${firstName}! You bring a butter knife to a gunfight and call it strategy, pal.`,
      `Step right up, ${firstName}, you hockey puck! I've seen better-looking people on a milk carton.`,
      `${firstName}, big shot, you belong in sepia tone — outdated, faded, nobody's watching. Your sex life is AM radio.`,
      `I've seen more action in a retirement bingo hall than in your entire dating life, pal. Tough guy? More like tough luck.`,
    ],
    persona_11: [
      `Fascinating specimen, ${firstName}! Your personality failed peer review — and the reviewers were your own friends. Cackle.`,
      `${firstName}, my calculations show your charisma index is statistically insignificant. The control group — empty space — outperformed you.`,
      `Experiment ${firstName}: hypothesis 'interesting.' Result: null. Conclusion: publish nothing.`,
      `I've studied your dating history under a microscope: the only thing I found was desperation. Fascinating.`,
    ],
    persona_12: [
      `${firstName}, your vibe forgot the BPM — and so did your partner, repeatedly. Ambient failure, always on loop.`,
      `Yo ${firstName}, you're the skip button's favorite track — even on shuffle, the algorithm avoids you.`,
      `${firstName}, your whole mix is static — white noise in human form. No remix can save you.`,
      `Your bedroom rhythm is off-beat, off-tempo, and off-putting, ${firstName}. Nobody's pressing play on that.`,
    ],
    persona_13: [
      `${firstName}, I BELIEVE in you — I just don't believe you'll DO anything about it! NO EXCUSES! Level up or log off!`,
      `Your goals called, ${firstName} — they're filing for a restraining order! You haven't shown up since 2019!`,
      `${firstName}, potential is a down payment, and you DEFAULTED! The bank of hustle foreclosed on your dreams!`,
      `Your bedroom stamina needs a breakthrough — and a defibrillator! GRIT? You don't even have gravel!`,
    ],
    persona_14: [
      `${firstName}, dear, your pedigree reads like a discount parade — everyone showed up, nobody was impressed. How quaint.`,
      `One simply cannot with ${firstName}. A commoner masquerading as a character. The crown rejects you, churl.`,
      `${firstName}, your taste is a clearance rack in a thunderstorm — drenched, discounted, deeply undignified.`,
      `How delightfully tragic, ${firstName} — you've peaked, and the peak was a speed bump. That's not a climax, dear.`,
    ],
    persona_15: [
      `${firstName}, let's unpack this — starting with why nobody texts you back. How does that feel? Processing? Good.`,
      `${firstName}, I'm sensing a pattern: you. Your attachment style is 'avoidant' — people avoid you.`,
      `We need to talk about boundaries, ${firstName} — specifically, how yours keep the good things out.`,
      `Have you tried not being this, ${firstName}? Insurance won't cover it, but it's worth a shot.`,
    ],
    persona_16: [
      `TURN UP — wait, no, turn it DOWN for ${firstName}! You crashed the vibe like an offbeat hi-hat! Crowd asked for a refund!`,
      `${firstName}, you're the feedback at the festival nobody booked! The whole crowd looked at each other!`,
      `Ayo ${firstName}, your energy's a dead mic at a sold-out show! Hype? More like NOPE!`,
      `Your moves are so confused, even the DJ switched genres to escape you, ${firstName}! Wildin!`,
    ],
    persona_17: [
      `${firstName} is a tragic amateur hour disguised as art — and the artist is the tragedy. No nuance can save this piece.`,
      `The composition of ${firstName}: unbalanced, overexposed, signed by nobody of note. A critique of emptiness.`,
      `${firstName}, your whole presence lacks nuance — a blunt object in a gallery of fine instruments.`,
      `Your dating history is an installation piece titled 'Desperation in Three Acts.' The gallery closed it early.`,
    ],
    persona_18: [
      `Yo ${firstName}, your hustle looks like warm-up sets — and your sex life looks like the rest period! Zero gainz!`,
      `${firstName}, you're the guy flexing in the mirror between zero reps! Cardio? More like 'cardi-nope!'`,
      `Your protein shake is 90% excuses, ${firstName}! You skip leg day, arm day, AND personality day!`,
      `Your bedroom stamina is a warm-up set that never progresses — no PR, no gainz, no second round. Weak!`,
    ],
    persona_19: [
      `${firstName}, the cosmos sighed when you were born — and it's been holding its breath ever since. Your destiny filed a complaint.`,
      `The stars align for no one, ${firstName} — but they actively scatter for you. Mercury isn't in retrograde; it's embarrassed.`,
      `${firstName}, your star chart is a warning label. Every planet said 'nope' the moment they saw your trajectory.`,
      `Your sex life is a black hole — nothing escapes, nothing enters, and it's very, very dark, ${firstName}.`,
    ],
    persona_20: [
      `${firstName}. Brevity served you better than ambition. One word: ouch.`,
      `${firstName}. You. That's the roast. It's enough.`,
      `${firstName}. Short. Sharp. Done. Like your potential. And your stamina.`,
      `${firstName}. Your dating life in three words: no, no, and no. That's it.`,
    ],
    persona_21: [
      `LET'S GOOO! Wait — no, let's NOT, because ${firstName} just killed the vibe! Hatin ass energy! Your bedroom game is a cancelled tour!`,
      `Yo ${firstName}, playa, you couldn't hype up an empty room! Your sex life is a soundcheck nobody attended! Pimpin? Simpin!`,
      `Ayo ${firstName}, the crowd took one look at you and asked for a refund — and they got in FREE! Flame? Wet match!`,
      `${firstName}, your whole existence is a flop single that never charted! Let's gooo... without you!`,
    ],
    persona_22: [
      `Ooh honey, ${firstName}... the shade I'm throwing could power a solar farm, and you're still in the dark! Mop the floor? The floor deserves better.`,
      `${firstName}, darling, I've seen better contouring on a potato. You're giving 'before picture' energy. NOT cute.`,
      `Listen ${firstName}, the tea is: your sex life is a closed venue — no occupancy, no audience, no show. Serving? Nothing.`,
      `The only thing serving tonight is ME, ${firstName} — you're serving cafeteria leftovers at a Michelin restaurant.`,
    ],
    persona_23: [
      `Arrr, ${firstName}... ye're the chum that didn't even attract sharks — too bland for the fish! Even the barnacles want off!`,
      `${firstName}, ye scallywag, your sex life is like fishing with no bait — ye cast the line and nothing bites!`,
      `Aye, ${firstName}... I've seen more action in a deserted lagoon than in your entire dating history. The sea rejects ye.`,
      `Even the seagulls turned up their beaks at ye, ${firstName}. That's the ocean saying 'no thanks, we have standards.'`,
    ],
    persona_24: [
      `Darling, ${firstName}... your spotlight is a nightlight — and even that's on a timer. I've seen bigger stars at Walmart.`,
      `${firstName}, sweetie, the paparazzi took one photo of you and deleted it to save space. Even the lens was bored.`,
      `Oh ${firstName}, darling... your sex life is a box office flop: no audience, no reviews, no sequel. Tragic.`,
      `I've walked more red carpets than you've walked to the fridge, ${firstName}. And I looked better doing both.`,
    ],
    persona_25: [
      `LISTEN UP, ${firstName.toUpperCase()}! You're a walking court-martial of personality! DROP AND GIVE ME TWENTY — you can't even give ONE!`,
      `MAGGOT! That's your new name, ${firstName}! Even your shadow went AWOL! Your bedroom performance is a failed operation!`,
      `${firstName}, you're the reason they invented 'dishonorable discharge!' TEN-LEAVE! Your whole existence is a uniform violation!`,
      `Sound off? You can't even sound ON, ${firstName}! Your sex life is a failed mission with zero casualties because nobody was there!`,
    ],
    persona_26: [
      `${firstName}... your alibi for being interesting just fell apart. The only mystery here is why you showed up. Case closed.`,
      `I followed the clues, ${firstName}. They all led to nowhere. Your dating history is a crime scene with no suspects.`,
      `The rain came down like ${firstName}'s chances of being memorable — hard, cold, going nowhere. Another dead end.`,
      `Your sex life is a cold case nobody's investigating, ${firstName}. Nothing happened. There's nothing to solve.`,
    ],
    persona_27: [
      `GIVE ME A D! Give me an I! Give me an S! What's that spell? ${firstName} is a DISAPPOINTMENT! WOO! Go squad!`,
      `Ready? OK! ${firstName}, your spirit is a zero on the scoreboard! Even the mascot quit — and the mascot doesn't get paid!`,
      `Hey ${firstName}! I tried to spell your name in a cheer but I ran out of letters that spell 'boring!' LET'S GOOO... away!`,
      `Your sex life is a benchwarmer who never gets in the game, ${firstName} — and the coach isn't even looking!`,
    ],
    persona_28: [
      `Yo ${firstName}, brah... you wiped out before you even caught the wave. That's not a bail, that's a lifestyle, dude.`,
      `${firstName}, your vibe is a flat ocean, bro — no waves, no wind, no action. Just... nothing. Bogus.`,
      `Brah, ${firstName}... you're like a beach with no sand. You showed up to the ocean and forgot how to swim, dude.`,
      `Your bedroom performance is a beach closed for contamination, ${firstName}. Nobody's swimming in that. Gnarly.`,
    ],
    persona_29: [
      `${firstName}, your performance earns a failing grade in the subject of Existing — see me after class. Permanently.`,
      `I've taught better students in an empty classroom, ${firstName}. Your sex life is an F minus — and I'm being generous.`,
      `${firstName}, report to the headmaster's office. Bring your dignity — oh, you can't. It was confiscated in term one.`,
      `Your marks are so low they've applied for excavation rights, ${firstName}. Detention for your ego. Expulsion for your sex life.`,
    ],
    persona_30: [
      `Ay, ${firstName}, mi amor... you dance through life with two left feet and no rhythm — and the dance is horizontal. Fuego? Fue-no.`,
      `${firstName}, corazón, your sex life is a tango with no partner — just you stumbling alone. Pasión? You have the passion of a DMV line.`,
      `Escucha, ${firstName}... your rhythm is a broken metronome. Your bedroom performance is a dance recital nobody attended.`,
      `Your passion is a candle, ${firstName}; mine is a wildfire. You bring the match; I bring the inferno. Ay ay ay, tragic.`,
    ],
  };

  const contextFlavor = context ? ` And don't think we forgot — ${context.split(/[.!?\n]/)[0].slice(0, 80)}. Yeah. That.` : '';

  // Build the full roast with OPEN → BODY → FINALE structure
  const transcript = [];

  // OPEN: First persona delivers the intro
  const firstPersona = personas[0];
  const introLine = buildIntro(firstPersona, personas, subject, explicit);
  transcript.push({ persona_id: firstPersona.id, line: introLine, phase: 'open' });

  // BODY: Interleaved roast lines
  const perPersonaLines = personas.map((p) => {
    const pool = POOLS[p.id] || [`${firstName}, you're a walking punchline waiting for a setup.`];
    const used = new Set();
    const lines = [];
    const count = linesPerPersona - 1; // -1 because first persona already has intro
    for (let i = 0; i < count; i++) {
      let line;
      let attempts = 0;
      do {
        line = pool[Math.floor(Math.random() * pool.length)];
        attempts++;
      } while (used.has(line) && attempts < 10 && pool.length > used.size);
      used.add(line);
      if (contextFlavor && Math.random() > 0.6) line += contextFlavor;
      lines.push({ persona_id: p.id, line, phase: i < count / 2 ? 'observation' : 'rapidfire' });
    }
    return lines;
  });

  // Interleave body lines round-robin
  const maxBodyLines = Math.max(...perPersonaLines.map((l) => l.length));
  for (let i = 0; i < maxBodyLines; i++) {
    for (let p = 0; p < personas.length; p++) {
      if (perPersonaLines[p][i]) transcript.push(perPersonaLines[p][i]);
    }
  }

  // FINALE: Last persona delivers the closing
  const lastPersona = personas[personas.length - 1];
  const outroLine = buildOutro(lastPersona, personas, subject, explicit);
  transcript.push({ persona_id: lastPersona.id, line: outroLine, phase: 'finale' });

  return transcript;
}

function buildIntro(persona, allPersonas, subject, explicit) {
  const personaNames = allPersonas.map((p) => p.displayName).join(', ');
  const styles = {
    suave: `Check this, baby — WELCOME TO DA ROASTBOX! Tonight's roast squad: ${personaNames}. And tonight's target? ${subject}. Ohhh sheeeeit. This gonna be good.`,
    maternal: `Oh honey, welcome to Da RoastBox! Bless your heart for showing up. Tonight's roasters: ${personaNames}. And our guest of dishonor? ${subject}. Sweetie, you should've stayed home.`,
    edgy: `Yo. WELCOME TO DA ROASTBOX. Bro, tonight we got ${personaNames} ready to destroy ${subject}. Literally about to be the worst night of their life. Let's gooo.`,
    professional: `Good evening. Welcome to Da RoastBox. Tonight's panel: ${personaNames}. Tonight's subject for performance review: ${subject}. Let's circle back to why you're here.`,
    'smooth-verse': `Yo, welcome to Da RoastBox, dog. Tonight's rhyme squad: ${personaNames}. And tonight's target? ${subject}. Ya dig? This about to be a hit track, and you're the punchline.`,
    'lobby-join': `GG everyone, welcome to Da RoastBox! Party lobby: ${personaNames}. And tonight's noob getting clapped? ${firstName(subject)}. Get ready, bro. This is ranked.`,
    calm: `Welcome to Da RoastBox. Hmm. Tonight... ${personaNames}. And the subject... ${subject}. Breathe. This will hurt. Interesting.`,
    'hot-topic': `HOW YOU DOIN! Welcome to Da RoastBox, honey! Tonight's hot topic: ${subject}. And the panel ready to spill the tea? ${personaNames}. Sip this, baby.`,
    'order-up': `Order up! Welcome to Da RoastBox! Tonight's roast squad: ${personaNames}. And today's special? ${subject}. Extra shot of devastation, no foam, no mercy.`,
    'ladies-germs': `Ladies and germs, welcome to Da RoastBox! Tonight's panel: ${personaNames}. And tonight's hockey puck? ${subject}. Big shot, you're in trouble, pal.`,
    'wild-hypothesis': `Fascinating! Welcome to Da RoastBox! Tonight's experiment: roasting ${subject}. Our lab team: ${personaNames}. Hypothesis: this will be devastating. Cackle.`,
    'track-fade-in': `Yo... welcome to Da RoastBox. Tonight's lineup: ${personaNames}. And the subject? ${subject}. Track one, side A. Let's drop the needle.`,
    'pump-up': `WELCOME TO DA ROASTBOX! NO EXCUSES! Tonight's squad: ${personaNames}! And tonight's target: ${subject}! PUT IN THE WORK? More like PUT UP WITH THE PAIN!`,
    'royal-decree': `Welcome, peasants, to Da RoastBox. Tonight's court: ${personaNames}. And the accused? ${subject}. How quaint. The crown will see you now, dear.`,
    'intake-form': `Welcome to Da RoastBox. Let's begin our session. Tonight's group: ${personaNames}. And our patient? ${subject}. How does that make you feel? Let's unpack.`,
    'backstage-rush': `TURN UP! Welcome to Da RoastBox! Tonight's wildin squad: ${personaNames}! And tonight's victim? ${subject}! Ain't no party like a RoastBox party!`,
    'gallery-opening': `Welcome to Da RoastBox. Tonight's exhibition: ${personaNames}. And the subject of our critique? ${subject}. The gallery is open. The reviews will be savage.`,
    'gym-entrance': `Yo, welcome to Da RoastBox! Tonight's spot squad: ${personaNames}. And tonight's weak link? ${subject}. Zero gainz incoming. Let's get it!`,
    'star-chart': `Welcome to Da RoastBox. The stars have aligned. Tonight's cosmic panel: ${personaNames}. And tonight's subject? ${subject}. The universe is watching. And judging.`,
    'one-sentence': `Welcome to Da RoastBox. ${personaNames}. ${subject}. That's the setup. Done.`,
    'pyro-entrance': `LET'S GOOO! WELCOME TO DA ROASTBOX! Tonight's flame squad: ${personaNames}! And tonight's kindling? ${subject}! Hatin ass energy incoming!`,
    'runway-walk': `Ooh honey, WELCOME to Da RoastBox! *sashay* Tonight's serving: ${personaNames}. And tonight's read? ${subject}. The runway is ready. The shade is loaded.`,
    'dock-rant': `WELCOME TO DA ROASTBOX, ye scallywags! Tonight's crew: ${personaNames}. And tonight's chum? ${subject}. Aye, this is gonna be a bloodbath. ARRR!`,
    'limo-arrival': `Darling, welcome to Da RoastBox. Tonight's A-list: ${personaNames}. And tonight's D-list subject? ${subject}. The paparazzi aren't here for you, sweetie.`,
    'drill-cadence': `TEN-HUT! WELCOME TO DA ROASTBOX, MAGGOTS! Tonight's drill squad: ${personaNames}! And tonight's target? ${subject}! SOUND OFF! This is NOT a drill!`,
    'case-file-open': `Welcome to Da RoastBox. Case file: ${subject}. Investigators: ${personaNames}. The evidence is mounting. The verdict will be devastating.`,
    'cheer-chant': `READY? OK! WELCOME TO DA ROASTBOX! Give me an R, give me an O, give me an A! Tonight's squad: ${personaNames}! And tonight's spirit-killer? ${subject}! LET'S GOOO!`,
    'beach-arrival': `Yo, welcome to Da RoastBox, brah. Tonight's wave riders: ${personaNames}. And tonight's wipeout? ${subject}. Gnarly. This is gonna be sick.`,
    'assembly-hall': `Welcome to Da RoastBox. Assembly hall, term begins. Tonight's faculty: ${personaNames}. And tonight's failing pupil? ${subject}. See me after class.`,
    'rose-in-mouth': `Ay, welcome to Da RoastBox, mi amor. Tonight's dancers: ${personaNames}. And tonight's subject? ${subject}. The tango of destruction begins. Fuego.`,
  };
  const introStyle = persona.voice_settings?.intro_style || 'suave';
  return styles[introStyle] || styles.suave;
}

function buildOutro(persona, allPersonas, subject, explicit) {
  const styles = {
    'mic-drop': `And that's the roast, baby. ${subject}, you just got cooked. Welcome to Da RoastBox. Check this... mic drop. Goodnight, everybody!`,
    'bless-your-heart': `Bless your heart, ${subject}. You took it like a champ. A sad, confused champ, but a champ. Thanks for coming to Da RoastBox, honey. Drive safe.`,
    'buffering-out': `And that's a wrap, bro. ${subject}, you just got absolutely rekt. GG. Thanks for coming to Da RoastBox. ${subject} has disconnected. Literally.`,
    'youre-fired': `And that concludes the performance review, ${subject}. You're fired. From everything. Thanks for coming to Da RoastBox. Take this offline. Permanently.`,
    'final-bar': `And that's the last verse, dog. ${subject}, you just got bodied on this track. Thanks for coming to Da RoastBox. Ya dig? Goodnight.`,
    disconnect: `GG, ${subject}. You got clapped. Thanks for coming to Da RoastBox. ${subject} has left the lobby. Permanently.`,
    'walk-away': `And that's it, ${firstName(subject)}. Thanks for coming to Da RoastBox. Hmm. Breathe. You survived. Barely.`,
    'sip-and-stare': `And that's the tea, honey. ${subject}, you just got spilled. Sip. Thanks for coming to Da RoastBox. How you doin? Traumatized? Good.`,
    'next-customer': `And that's your order, ${subject}. Completely roasted. Thanks for coming to Da RoastBox. Next!`,
    'sign-off': `And that's the show, folks! ${subject}, you belong in the discount bin. Thanks for coming to Da RoastBox. This is Big Mic signing off. Goodnight, ladies and germs!`,
    'experiment-concluded': `Experiment concluded, ${subject}. Results: devastating. Thanks for coming to Da RoastBox. Publish nothing. Cackle. Goodnight!`,
    'outro-fade': `And that's the outro, ${firstName(subject)}. Track faded. Thanks for coming to Da RoastBox. You've been remixed. Goodnight.`,
    'whistle-blow': `And that's the whistle, ${subject}! Game over! You gave zero effort and got zero results! Thanks for coming to Da RoastBox! NO EXCUSES! Goodnight!`,
    dismissed: `You are dismissed, ${subject}. The court has ruled. Thanks for coming to Da RoastBox. How quaint. Goodnight, dear.`,
    'session-over': `Our session is over, ${subject}. Time's up. Thanks for coming to Da RoastBox. How does that feel? Devastated? Processing? Good.`,
    'mic-throw': `And that's the show! ${subject}, you just got wildin'd! Thanks for coming to Da RoastBox! AIN'T NO PARTY LIKE A ROASTBOX PARTY! *mic throw*`,
    'review-published': `And the review is published, ${subject}. Zero stars. Thanks for coming to Da RoastBox. The gallery has closed. Goodnight.`,
    'last-set': `And that's the last set, ${firstName(subject)}. Zero gainz, zero results. Thanks for coming to Da RoastBox. Spot me? Nah, you can't even spot yourself.`,
    'prophecy-complete': `And the prophecy is complete, ${subject}. The stars have spoken. Thanks for coming to Da RoastBox. Your destiny is... this. Goodnight.`,
    'walk-off': `Thanks for coming to Da RoastBox, ${firstName(subject)}. That's it. Done.`,
    'mic-explosion': `AND THAT'S THE ROAST, FAM! ${subject}, you just got NUKED! Thanks for coming to Da RoastBox! LET'S GOOO! *mic explosion* Goodnight!`,
    'sashay-away': `And that's the read, honey. ${subject}, you've been mopped. Thanks for coming to Da RoastBox. *sashay away* The runway is closed.`,
    'storm-out': `AND THAT'S IT, YE BARNACLE! ${subject}, ye've been sunk! Thanks for coming to Da RoastBox! ARRR! *storms off the dock*`,
    'paparazzi-leave': `And that's a wrap, darling. ${subject}, you've been roasted. Thanks for coming to Da RoastBox. *limo door closes* The paparazzi have left.`,
    'dismissed-maggot': `DISMISSED, ${firstName(subject).toUpperCase()}! You've been roasted, maggot! Thanks for coming to Da RoastBox! TEN-HUT! Now GET OUT!`,
    'case-closed': `Case closed, ${subject}. Verdict: roasted. Thanks for coming to Da RoastBox. The file is sealed. Goodnight, detective.`,
    'final-cheer': `And that's the final cheer, ${firstName(subject)}! GIVE ME A W! W is for WRECKED! Thanks for coming to Da RoastBox! LET'S GOOO! Goodnight squad!`,
    'paddle-out': `And that's the session, brah. ${subject}, you wiped out hard. Thanks for coming to Da RoastBox. Paddle out. Good vibes only... for everyone except you.`,
    expelled: `You are expelled, ${subject}. From Da RoastBox, from dignity, from self-respect. Thanks for coming. See me never. Goodnight.`,
    'final-dip': `And that's the final dip, mi amor. ${subject}, you've been danced to death. Thanks for coming to Da RoastBox. The tango is over. Fuego out. Goodnight.`,
  };
  const outroStyle = persona.voice_settings?.ending_style || 'mic-drop';
  return styles[outroStyle] || styles['mic-drop'];
}

function firstName(full) {
  return (full || '').split(/\s+/)[0] || 'you';
}
