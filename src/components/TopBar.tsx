import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { useState } from 'react';
import HelpModal from './HelpModal';

export default function TopBar() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const navItem = (path: string, label: string, testId: string) => (
    <button
      className={`btn-ghost ${location.pathname === path ? 'active' : ''}`}
      onClick={() => {
        navigate(path);
        setMenuOpen(false);
      }}
      data-testid={testId}
    >
      {label}
    </button>
  );

  return (
    <>
      <header className="topbar">
        <Link to="/studio" className="brand" data-testid="brand-link">
          <span className="brand-flame">🔥</span>
          <span className="brand-text">DA ROASTBOX!</span>
        </Link>

        <div className="topbar-actions desktop-only">
          <span className="credit-pill" data-testid="credit-pill">
            🔥 {profile?.credits ?? 0} Roasts
          </span>
          {navItem('/studio', 'Studio', 'nav-studio-btn')}
          {navItem('/history', 'History', 'nav-history-btn')}
          {navItem('/credits', 'Buy Credits', 'nav-credits-btn')}
          {navItem('/settings', 'Settings', 'nav-settings-btn')}
          <button
            className="btn-ghost btn-help"
            onClick={() => setHelpOpen(true)}
            data-testid="help-btn"
            title="Help & Guide"
          >
            ❓ Help
          </button>
          <button className="btn-ghost" onClick={signOut} data-testid="logout-btn">
            Logout
          </button>
        </div>

        <div className="topbar-actions mobile-only">
          <button
            className="btn-ghost btn-help"
            onClick={() => setHelpOpen(true)}
            data-testid="help-btn-m"
            title="Help & Guide"
          >
            ❓
          </button>
          <button
            className="btn-ghost"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Menu"
          >
            ☰
          </button>
        </div>

        {menuOpen && (
          <div className="mobile-menu" onClick={() => setMenuOpen(false)}>
            <div className="mobile-menu-inner" onClick={(e) => e.stopPropagation()}>
              <span className="credit-pill mobile-credit">
                🔥 {profile?.credits ?? 0} Roasts
              </span>
              {navItem('/studio', 'Studio', 'nav-studio-btn-m')}
              {navItem('/history', 'History', 'nav-history-btn-m')}
              {navItem('/credits', 'Buy Credits', 'nav-credits-btn-m')}
              {navItem('/settings', 'Settings', 'nav-settings-btn-m')}
              <button
                className="btn-ghost"
                onClick={() => {
                  setHelpOpen(true);
                  setMenuOpen(false);
                }}
              >
                ❓ Help
              </button>
              <button
                className="btn-ghost"
                onClick={() => {
                  signOut();
                  setMenuOpen(false);
                }}
              >
                Logout
              </button>
            </div>
          </div>
        )}
      </header>

      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
    </>
  );
}
