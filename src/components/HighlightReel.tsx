import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface HighlightLine {
  persona_id: string;
  line: string;
  phase?: string;
}

interface Persona {
  id: string;
  displayName: string;
  color: string;
  image: string;
}

interface HighlightReelProps {
  transcript: HighlightLine[];
  personas: Record<string, Persona>;
  subjectName: string;
  subjectImage?: string;
  onClose: () => void;
}

export default function HighlightReel({ transcript, personas, subjectName, subjectImage, onClose }: HighlightReelProps) {
  const [phase, setPhase] = useState<'splash' | 'reveal' | 'roast' | 'replay' | 'cta'>('splash');
  const [currentLine, setCurrentLine] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pick the best punchline (longest line that's not intro/outro).
  // Derived during render so there is no extra state-sync render pass.
  const bestLine: HighlightLine | null = useMemo(() => {
    const candidates = transcript.filter((l) => l.phase !== 'open' && l.phase !== 'finale');
    if (candidates.length === 0) return null;
    return candidates.reduce((a, b) => (b.line.length > a.line.length ? b : a));
  }, [transcript]);

  // Pick top 5 roast lines for the reel. Memoised because the phase timer
  // effect depends on it — a fresh array each render would re-arm the timer.
  const reelLines = useMemo(
    () =>
      [...transcript]
        .filter((l) => l.phase !== 'open' && l.phase !== 'finale')
        .sort((a, b) => b.line.length - a.line.length)
        .slice(0, 5),
    [transcript]
  );

  useEffect(() => {
    // Kick off the reel on mount; the timeout drives later phases.
    timerRef.current = setTimeout(() => setPhase('reveal'), 3000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  // Reveal: 3-8s
  useEffect(() => {
    if (phase === 'reveal') {
      timerRef.current = setTimeout(() => setPhase('roast'), 5000);
    }
  }, [phase]);

  // Roast: 8-45s (cycle through reel lines)
  useEffect(() => {
    if (phase === 'roast') {
      if (currentLine >= reelLines.length) {
        timerRef.current = setTimeout(() => setPhase('replay'), 1000);
        return;
      }
      const lineDuration = Math.max(4000, reelLines[currentLine]?.line.length * 60);
      timerRef.current = setTimeout(() => {
        setCurrentLine((c) => c + 1);
      }, lineDuration);
    }
  }, [phase, currentLine, reelLines]);

  // Replay: 45-55s
  useEffect(() => {
    if (phase === 'replay') {
      timerRef.current = setTimeout(() => setPhase('cta'), 10000);
    }
  }, [phase]);

  const handleClose = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    onClose();
  };

  const shareData = {
    title: `Da RoastBox! — ${subjectName} got ROASTED 🔥`,
    description: `${subjectName} just got absolutely destroyed by ${Object.values(personas).map(p => p.displayName).slice(0, 3).join(', ')}... Create your own roast at Da RoastBox!`,
  };

  const handleShare = async (platform: string) => {
    const url = window.location.origin;
    const text = `${subjectName} got ROASTED on Da RoastBox! 🔥 Create your own roast:`;
    if (platform === 'native' && navigator.share) {
      try {
        await navigator.share({ title: shareData.title, text, url });
      } catch {
        // user dismissed the native share sheet
      }
    } else {
      const shareUrls: Record<string, string> = {
        twitter: `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
        facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}&quote=${encodeURIComponent(text)}`,
        reddit: `https://reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(shareData.title)}`,
      };
      if (shareUrls[platform]) window.open(shareUrls[platform], '_blank');
    }
  };

  return (
    <div className="reel-overlay" onClick={handleClose}>
      <div className="reel-container" onClick={(e) => e.stopPropagation()}>
        <button className="reel-close" onClick={handleClose}>✕</button>

        <div className="reel-phone">
          <AnimatePresence mode="wait">
            {/* SPLASH: 0-3s */}
            {phase === 'splash' && (
              <motion.div
                key="splash"
                className="reel-phase reel-splash"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <motion.div
                  animate={{ scale: [0.5, 1.2, 1], rotate: [0, -5, 0] }}
                  transition={{ duration: 1.5 }}
                  className="reel-flame"
                >🔥</motion.div>
                <motion.h1
                  animate={{ y: [50, 0], opacity: [0, 1] }}
                  transition={{ delay: 0.5 }}
                  className="reel-title"
                >DA ROASTBOX!</motion.h1>
                <motion.p
                  animate={{ opacity: [0, 1] }}
                  transition={{ delay: 1.5 }}
                  className="reel-subtitle"
                >{subjectName} is about to get cooked…</motion.p>
              </motion.div>
            )}

            {/* REVEAL: 3-8s */}
            {phase === 'reveal' && (
              <motion.div
                key="reveal"
                className="reel-phase reel-reveal"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <motion.div
                  animate={{ scale: [0.3, 1.1, 1] }}
                  transition={{ duration: 1 }}
                  className="reel-subject-img"
                >
                  {subjectImage ? (
                    <img src={subjectImage} alt={subjectName} />
                  ) : (
                    <div className="reel-subject-placeholder">📸</div>
                  )}
                </motion.div>
                <motion.div
                  animate={{ y: [30, 0], opacity: [0, 1] }}
                  transition={{ delay: 1 }}
                  className="reel-subject-name"
                >
                  TONIGHT'S VICTIM
                  <div className="reel-subject-big">{subjectName}</div>
                </motion.div>
              </motion.div>
            )}

            {/* ROAST: 8-45s */}
            {phase === 'roast' && reelLines[currentLine] && (
              <motion.div
                key={`roast-${currentLine}`}
                className="reel-phase reel-roast"
                initial={{ opacity: 0, x: 100 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -100 }}
              >
                {(() => {
                  const p = personas[reelLines[currentLine].persona_id];
                  return p ? (
                    <>
                      <motion.div
                        animate={{ scale: [0.5, 1.2, 1] }}
                        transition={{ duration: 0.5 }}
                        className="reel-persona-avatar"
                      >
                        <img src={`/${p.image}`} alt={p.displayName} />
                      </motion.div>
                      <motion.div
                        initial={{ y: 20 }}
                        animate={{ y: 0 }}
                        className="reel-persona-name"
                        style={{ color: p.color }}
                      >{p.displayName}</motion.div>
                      <motion.div
                        className="reel-caption"
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.3 }}
                      >
                        {reelLines[currentLine].line}
                      </motion.div>
                    </>
                  ) : null;
                })()}
                <div className="reel-progress">
                  {reelLines.map((_, i) => (
                    <div key={i} className={`reel-dot ${i <= currentLine ? 'active' : ''}`} />
                  ))}
                </div>
              </motion.div>
            )}

            {/* REPLAY: 45-55s */}
            {phase === 'replay' && bestLine && (
              <motion.div
                key="replay"
                className="reel-phase reel-replay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <div className="reel-replay-label">🏆 BEST MOMENT</div>
                {(() => {
                  const p = personas[bestLine.persona_id];
                  return p ? (
                    <motion.img
                      animate={{ scale: [0.5, 1.3, 1] }}
                      transition={{ duration: 0.8 }}
                      className="reel-persona-avatar"
                      src={`/${p.image}`}
                      alt={p.displayName}
                    />
                  ) : null;
                })()}
                <motion.div
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 }}
                  className="reel-best-caption"
                >
                  {bestLine.line}
                </motion.div>
              </motion.div>
            )}

            {/* CTA: 55-60s */}
            {phase === 'cta' && (
              <motion.div
                key="cta"
                className="reel-phase reel-cta"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <motion.div
                  animate={{ scale: [0.5, 1.2, 1] }}
                  className="reel-flame"
                >🔥</motion.div>
                <h2 className="reel-cta-title">CREATE YOUR OWN ROAST</h2>
                <p className="reel-cta-sub">Da RoastBox! — Where they come for laughs and leave crispy.</p>
                <div className="reel-share-buttons">
                  <button onClick={() => handleShare('native')} className="reel-share-btn">📤 Share</button>
                  <button onClick={() => handleShare('twitter')} className="reel-share-btn">𝕏 Twitter</button>
                  <button onClick={() => handleShare('facebook')} className="reel-share-btn">📘 Facebook</button>
                  <button onClick={() => handleShare('reddit')} className="reel-share-btn">🔴 Reddit</button>
                </div>
                <div className="reel-watermark">Da RoastBox! 🔥</div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
