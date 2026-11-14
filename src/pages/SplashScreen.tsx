import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';

export default function SplashScreen() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [muted, setMuted] = useState(false);

  const playAudio = () => {
    if (audioRef.current && !muted) {
      audioRef.current.volume = 0.4;
      audioRef.current.play().catch(() => {});
    }
  };

  useRef(() => {
    const tryPlay = setTimeout(() => playAudio(), 300);
    const onFirstClick = () => { playAudio(); };
    window.addEventListener('click', onFirstClick, { once: true });
    window.addEventListener('touchstart', onFirstClick, { once: true });
    return () => {
      clearTimeout(tryPlay);
      window.removeEventListener('click', onFirstClick);
      window.removeEventListener('touchstart', onFirstClick);
    };
  });

  const toggleMute = () => {
    setMuted((m) => {
      const newMuted = !m;
      if (audioRef.current) {
        if (newMuted) {
          audioRef.current.pause();
        } else {
          audioRef.current.volume = 0.4;
          audioRef.current.play().catch(() => {});
        }
      }
      return newMuted;
    });
  };

  const handleContinue = () => {
    playAudio();
    if (!loading && user) {
      navigate('/studio', { replace: true });
    } else {
      navigate('/login', { replace: true });
    }
  };

  return (
    <div
      className="splash splash-full"
      data-testid="splash-screen"
      style={{ ['--splash-bg' as string]: "url('/assets/splash_bg.png')" }}
    >
      <audio ref={audioRef} loop preload="auto">
        <source src="/assets/sfx/intro.mp3" type="audio/mpeg" />
      </audio>

      <button
        className="splash-sound-toggle"
        onClick={toggleMute}
        aria-label={muted ? 'Unmute' : 'Mute'}
        data-testid="splash-sound-toggle"
      >
        {muted ? '🔇' : '🔊'}
      </button>

      <div className="splash-overlay" />
      {/* No title text — just the splash image, tagline, and button pushed down */}
      <div className="splash-content splash-content-lower">
        <p className="splash-tagline splash-tagline-sm">Where they come for laughs and leave crispy.</p>
        <button
          className="btn-purple-glow splash-enter-btn splash-enter-btn-sm"
          onClick={handleContinue}
          data-testid="splash-enter-btn"
        >
          🔥 Continue
        </button>
        <p className="text-muted splash-hint splash-hint-sm">
          {loading ? 'Loading…' : user ? 'Welcome back — enter the roast studio' : 'Sign in to roast and get roasted'}
        </p>
      </div>
    </div>
  );
}
