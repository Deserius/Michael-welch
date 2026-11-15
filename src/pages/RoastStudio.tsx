import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../contexts/useAuth';
import { useToast } from '../contexts/useToast';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost } from '../lib/api';
import { useVoicePlayer, type RoastLine } from '../hooks/useVoicePlayer';
import HighlightReel from '../components/HighlightReel';

const MAX_PERSONAS = 5;
const MAX_IMAGES = 4;

interface Persona {
  id: string;
  name: string;
  displayName: string;
  tagline: string;
  color: string;
  image: string;
  gender: string;
  speech: { pitch: number; rate: number };
  tier?: string;
  comic_inspiration?: string;
  voice_settings?: { comedy_style?: string };
}

interface VisualProfile {
  expression?: string;
  hairstyle?: string;
  outfit?: string;
  pose?: string;
  style?: string;
  background?: string;
  energy?: string;
  visual_hooks?: string[];
  style_hooks?: string[];
  best_angles?: string[];
}

interface TranscriptLine {
  persona_id: string;
  line: string;
  phase?: string;
}

export default function RoastStudio() {
  const { profile, token, refreshProfile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const { activeIdx, speaking, playSequence, stop } = useVoicePlayer();

  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [subjectName, setSubjectName] = useState('');
  const [contextText, setContextText] = useState('');
  const [images, setImages] = useState<{ file: File; previewUrl: string; base64?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [loadingPersonas, setLoadingPersonas] = useState(true);
  const [duration, setDuration] = useState(5);
  const [intensity, setIntensity] = useState(3);
  const [explicit, setExplicit] = useState(true);
  const [premiumModel, setPremiumModel] = useState(false);
  const [elevenLabs, setElevenLabs] = useState(false);
  const [showReel, setShowReel] = useState(false);
  const [visualProfile, setVisualProfile] = useState<VisualProfile | null>(null);

  useEffect(() => {
    apiGet('/personas')
      .then((data) => setPersonas(data.personas || []))
      .catch((e) => toast('Failed to load personas: ' + e.message, 'error'))
      .finally(() => setLoadingPersonas(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const personaById = useMemo(() => {
    const m: Record<string, Persona> = {};
    personas.forEach((p) => (m[p.id] = p));
    return m;
  }, [personas]);

  const togglePersona = (id: string) => {
    setSelected((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length >= MAX_PERSONAS) {
        toast(`Max ${MAX_PERSONAS} roasters`, 'error');
        return cur;
      }
      return [...cur, id];
    });
  };

  // Dice button: pick 5 random personas
  const randomize = () => {
    const shuffled = [...personas].sort(() => Math.random() - 0.5);
    setSelected(shuffled.slice(0, MAX_PERSONAS).map((p) => p.id));
    toast('🎲 5 random roasters selected!', 'success');
  };

  const onPickImages = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).slice(0, MAX_IMAGES - images.length);
    const next = files.map((f) => {
      const previewUrl = URL.createObjectURL(f);
      return { file: f, previewUrl, base64: undefined as string | undefined };
    });
    setImages((c) => [...c, ...next].slice(0, MAX_IMAGES));
    e.target.value = '';
  };

  // Convert file to base64 for image analysis
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });
  };

  const removeImage = (idx: number) => {
    setImages((c) => {
      const x = [...c];
      URL.revokeObjectURL(x[idx]?.previewUrl);
      x.splice(idx, 1);
      return x;
    });
  };

  // Calculate cost — mirrors api/_pricing.js exactly.
  const selectedPersonas = selected.map((id) => personaById[id]).filter(Boolean);
  const premiumCount = selectedPersonas.filter((p) => p.tier === 'premium').length;
  const isSubscriber = !!profile?.subscription_tier;
  const breakdown = {
    base: 1,
    premiumPersonas: premiumCount,
    premiumModel: premiumModel ? 2 : 0,
    premiumVoices: elevenLabs ? 1 : 0,
  };
  const totalCost = isSubscriber
    ? 0
    : breakdown.base + breakdown.premiumPersonas + breakdown.premiumModel + breakdown.premiumVoices;

  const generate = async () => {
    if (selected.length === 0) return toast('Pick at least 1 roaster', 'error');
    if (images.length === 0) return toast('Upload at least 1 subject photo', 'error');
    if (!token) return toast('Not signed in', 'error');
    if ((profile?.credits ?? 0) < totalCost) {
      toast(`Need ${totalCost} credits. You have ${profile?.credits ?? 0}.`, 'error');
      navigate('/credits');
      return;
    }

    setBusy(true);
    setTranscript([]);
    setVisualProfile(null);
    stop();
    try {
      // Convert first image to base64 for analysis
      let imageBase64: string | undefined;
      if (images[0]) {
        imageBase64 = await fileToBase64(images[0].file);
      }

      const data = await apiPost(
        '/roast',
        {
          persona_ids: selected.join(','),
          subject_name: subjectName || undefined,
          user_context: contextText || undefined,
          duration,
          intensity,
          explicit,
          premium_model: premiumModel,
          elevenlabs: elevenLabs,
          images: imageBase64 ? [imageBase64] : undefined,
        },
        token
      );
      setTranscript(data.transcript || []);
      setVisualProfile(data.visual_profile || null);
      await refreshProfile();

      // Build voice playback lines
      const voiceLines: RoastLine[] = (data.transcript || []).map((line: TranscriptLine) => {
        const p = personaById[line.persona_id] || personas[0];
        return {
          text: line.line,
          gender: p?.gender || 'male',
          speech: p?.speech || { pitch: 1, rate: 1 },
          phase: line.phase,
          persona_id: line.persona_id,
          line: line.line,
        };
      });

      setTimeout(() => playSequence(voiceLines, () => {}, undefined), 600);
      toast(`Roast generated! ${data.credits_spent} credits used.`, 'success');
    } catch (e) {
      const msg = (e as Error).message;
      toast('Roast failed: ' + msg, 'error');
      if (msg.includes('credits')) navigate('/credits');
    } finally {
      setBusy(false);
    }
  };

  const replay = () => {
    const voiceLines: RoastLine[] = transcript.map((line) => {
      const p = personaById[line.persona_id] || personas[0];
      return {
        text: line.line,
        gender: p?.gender || 'male',
        speech: p?.speech || { pitch: 1, rate: 1 },
        phase: line.phase,
        persona_id: line.persona_id,
        line: line.line,
      };
    });
    playSequence(voiceLines, () => {}, undefined);
  };

  return (
    <div className="workspace" data-testid="roast-studio">
      {/* LEFT: Controls */}
      <section>
        <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="badge-live">LIVE ROAST</span>
            <span className="text-muted" style={{ fontSize: 12 }}>
              {selected.length}/{MAX_PERSONAS} roasters
            </span>
          </div>
          <h2 style={{ marginTop: 12 }}>Subject</h2>
          <label className="label">Their name (optional)</label>
          <input
            className="input"
            placeholder="e.g., 'My boy Marcus'"
            value={subjectName}
            onChange={(e) => setSubjectName(e.target.value)}
            data-testid="subject-name-input"
          />
          <label className="label" style={{ marginTop: 12 }}>
            Context / inside jokes (optional)
          </label>
          <textarea
            className="textarea"
            placeholder="Tell the roasters about him/her: job, quirks, recent L's, hobbies, anything they can weaponize…"
            value={contextText}
            onChange={(e) => setContextText(e.target.value)}
            data-testid="context-textarea"
          />

          {/* Duration Slider */}
          <label className="label" style={{ marginTop: 16 }}>
            Roast Duration: <span style={{ color: 'var(--accent-main)', fontWeight: 800 }}>{duration} min</span>
          </label>
          <div className="duration-slider-row">
            <span className="duration-tick">3m</span>
            <input type="range" min={3} max={10} step={1} value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="duration-slider" data-testid="duration-slider" />
            <span className="duration-tick">10m</span>
          </div>

          {/* Intensity Slider */}
          <label className="label" style={{ marginTop: 14 }}>
            Roast Intensity: <span style={{ color: 'var(--accent-main)', fontWeight: 800 }}>
              {['', 'Mild', 'Moderate', 'Spicy', 'Savage', 'Nuclear'][intensity]}
            </span>
          </label>
          <div className="duration-slider-row">
            <span className="duration-tick">1</span>
            <input type="range" min={1} max={5} step={1} value={intensity}
              onChange={(e) => setIntensity(Number(e.target.value))}
              className="duration-slider intensity-slider" data-testid="intensity-slider" />
            <span className="duration-tick">5</span>
          </div>

          {/* Toggles */}
          <div className="toggle-row" style={{ marginTop: 14 }}>
            <label className="toggle-label">
              <span className="toggle-text">Explicit Language 🔞</span>
              <div className={`toggle-switch ${explicit ? 'on' : ''}`} onClick={() => setExplicit(!explicit)}>
                <div className="toggle-knob" />
              </div>
            </label>
          </div>
          <div className="toggle-row">
            <label className="toggle-label">
              <span className="toggle-text">Premium AI (GPT-4o) 🧠 <span className="toggle-cost">+2 credits</span></span>
              <div className={`toggle-switch ${premiumModel ? 'on' : ''}`} onClick={() => setPremiumModel(!premiumModel)}>
                <div className="toggle-knob" />
              </div>
            </label>
          </div>
          <div className="toggle-row">
            <label className="toggle-label">
              <span className="toggle-text">ElevenLabs Voices 🎙️ <span className="toggle-cost">+1 credit</span></span>
              <div className={`toggle-switch ${elevenLabs ? 'on' : ''}`} onClick={() => setElevenLabs(!elevenLabs)}>
                <div className="toggle-knob" />
              </div>
            </label>
          </div>
        </div>

        <div className="panel">
          <h2>Upload Photos ({images.length}/{MAX_IMAGES})</h2>
          <div className="upload-zone" onClick={() => fileRef.current?.click()} data-testid="upload-zone">
            <div className="icon">📸</div>
            <div style={{ marginTop: 6 }}>Click to upload subject photo(s)</div>
            <div className="hint">JPG / PNG · up to {MAX_IMAGES} images · AI vision analysis enabled</div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
            onChange={onPickImages} data-testid="image-file-input" />
          {images.length > 0 && (
            <div className="image-preview-row" data-testid="image-preview-row">
              {images.map((im, idx) => (
                <div key={idx} className="image-preview">
                  <img src={im.previewUrl} alt="" />
                  <button onClick={() => removeImage(idx)} aria-label="remove" data-testid={`remove-image-${idx}`}>×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="panel">
          {/* Cost breakdown */}
          <div className="cost-breakdown">
            <div className="cost-row"><span>Base roast</span><span>{breakdown.base} credit</span></div>
            {breakdown.premiumPersonas > 0 && <div className="cost-row"><span>Premium personas ({premiumCount})</span><span>+{breakdown.premiumPersonas}</span></div>}
            {breakdown.premiumModel > 0 && <div className="cost-row"><span>Premium AI (GPT-4o)</span><span>+{breakdown.premiumModel}</span></div>}
            {breakdown.premiumVoices > 0 && <div className="cost-row"><span>ElevenLabs voices</span><span>+{breakdown.premiumVoices}</span></div>}
            {isSubscriber ? (
              <div className="cost-row total"><span>Total cost</span><span>Free (subscriber)</span></div>
            ) : (
              <div className="cost-row total"><span>Total cost</span><span>{totalCost} credits</span></div>
            )}
          </div>
          <button className="btn-primary" style={{ width: '100%', padding: '16px', marginTop: 8 }}
            onClick={generate} disabled={busy} data-testid="generate-roast-btn">
            {busy ? <><span className="spinner" /> &nbsp;Cookin'…</> : '🔥 ROAST \'EM'}
          </button>
          <p className="text-muted" style={{ textAlign: 'center', marginTop: 8, fontSize: 12 }}>
            You have {profile?.credits ?? 0} credits
          </p>
        </div>
      </section>

      {/* RIGHT: Personas + Transcript */}
      <section>
        <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}>Pick Your Roasters</h2>
            <button className="dice-btn" onClick={randomize} title="Pick 5 random roasters" data-testid="dice-btn">
              🎲
            </button>
          </div>
          {loadingPersonas ? (
            <div className="empty-state"><span className="spinner" /> Loading roasters…</div>
          ) : (
            <div className="persona-grid" data-testid="persona-grid">
              {personas.map((p) => {
                const idx = selected.indexOf(p.id);
                return (
                  <div key={p.id}
                    className={`persona-card ${idx >= 0 ? 'selected' : ''} ${p.tier === 'premium' ? 'premium-card' : ''}`}
                    onClick={() => togglePersona(p.id)} data-testid={`persona-card-${p.id}`}
                    style={idx >= 0 ? { borderColor: p.color, boxShadow: `0 0 0 3px ${p.color}40, 0 10px 30px ${p.color}55` } : {}}>
                    {idx >= 0 && <div className="badge-num" style={{ background: p.color }}>{idx + 1}</div>}
                    {p.tier === 'premium' && <div className="badge-premium" title="Premium Persona">★</div>}
                    <img src={`/${p.image}`} alt={p.displayName} />
                    <div className="name">{p.displayName}</div>
                    <div className="tagline">{p.tagline}</div>
                    {p.comic_inspiration && (
                      <div className="persona-inspiration" style={{ color: p.color }}>
                        inspired by {p.comic_inspiration}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ margin: 0 }}>Live Transcript</h2>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {transcript.length > 0 && (
                <button className="btn-secondary" onClick={() => setShowReel(true)} data-testid="highlight-reel-btn">
                  🎬 Highlight Reel
                </button>
              )}
              {transcript.length > 0 && (
                speaking ? (
                  <button className="btn-secondary" onClick={stop} data-testid="stop-playback-btn">⏹ Stop</button>
                ) : (
                  <button className="btn-secondary" onClick={replay} data-testid="replay-btn">▶ Replay</button>
                )
              )}
            </div>
          </div>

          {visualProfile && (
            <div className="visual-profile-box">
              <div className="vp-title">🔍 AI Visual Analysis</div>
              <div className="vp-grid">
                {visualProfile.expression && <div className="vp-item"><span>Expression:</span> {visualProfile.expression}</div>}
                {visualProfile.hairstyle && <div className="vp-item"><span>Hair:</span> {visualProfile.hairstyle}</div>}
                {visualProfile.outfit && <div className="vp-item"><span>Outfit:</span> {visualProfile.outfit}</div>}
                {visualProfile.style && <div className="vp-item"><span>Style:</span> {visualProfile.style}</div>}
                {visualProfile.energy && <div className="vp-item"><span>Energy:</span> {visualProfile.energy}</div>}
              </div>
              {visualProfile.visual_hooks && (
                <div className="vp-hooks">
                  <span>Roast hooks:</span> {visualProfile.visual_hooks.join(' · ')}
                </div>
              )}
            </div>
          )}

          <div className="transcript" data-testid="transcript">
            {transcript.length === 0 && !busy && (
              <div className="empty-state">No roast yet. Pick your roasters, upload a photo, and hit ROAST 'EM.</div>
            )}
            {busy && <div className="empty-state"><span className="spinner" /> Generating your roast…</div>}
            {transcript.map((line, i) => {
              const p = personaById[line.persona_id] || {};
              return (
                <div key={i} className={`transcript-line ${activeIdx === i ? 'active' : ''} ${line.phase ? `phase-${line.phase}` : ''}`}
                  data-testid={`transcript-line-${i}`}>
                  <img className="avatar" src={`/${p.image || ''}`} alt={p.displayName || ''}
                    style={{ borderColor: p.color }} />
                  <div className="body">
                    <div className="name" style={{ color: p.color }}>
                      {p.displayName || p.name}
                      {line.phase && <span className="phase-badge">{line.phase}</span>}
                    </div>
                    <div className="text">{line.line}</div>
                    {activeIdx === i && speaking && (
                      <div className="speaking-indicator">
                        <span className="wave-bar" /> <span className="wave-bar" /> <span className="wave-bar" />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {showReel && transcript.length > 0 && (
        <HighlightReel
          transcript={transcript}
          personas={personaById}
          subjectName={subjectName || 'Unknown'}
          subjectImage={images[0]?.previewUrl}
          onClose={() => setShowReel(false)}
        />
      )}
    </div>
  );
}
