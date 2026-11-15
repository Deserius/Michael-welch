import { useState } from 'react';

const STORAGE_KEY = 'roastbox_disclaimer_accepted';

export default function DisclaimerModal() {
  // Initialise from storage rather than flipping state inside an effect,
  // which would render the modal closed first and then cascade a re-render.
  const [show, setShow] = useState(() => {
    try {
      return !localStorage.getItem(STORAGE_KEY);
    } catch {
      return true;
    }
  });
  const [agreed, setAgreed] = useState(false);

  const handleAccept = () => {
    if (!agreed) return;
    localStorage.setItem(STORAGE_KEY, 'true');
    setShow(false);
  };

  if (!show) return null;

  return (
    <div className="modal-overlay disclaimer-modal-overlay" data-testid="disclaimer-modal">
      <div className="modal disclaimer-modal">
        <div className="disclaimer-icon">🔞</div>
        <h3 style={{ textAlign: 'center', fontSize: 26 }}>18+ ENTERTAINMENT — DISCLAIMER</h3>
        <div className="disclaimer-body">
          <p>
            <strong style={{ color: 'var(--accent-alt)' }}>Da RoastBox!</strong> generates
            uncensored, adult comedic roast content for entertainment only.
          </p>
          <p>
            By using Da RoastBox you agree that the app and its creators are not liable for
            content generated or user actions. Do not target protected classes or harass real
            individuals.
          </p>
          <p style={{ color: 'var(--accent-main)', fontWeight: 700 }}>
            Roast responsibly. You've been warned.
          </p>
        </div>
        <label className="checkbox-row" style={{ justifyContent: 'center', marginTop: 16 }}>
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            data-testid="disclaimer-modal-checkbox"
          />
          <span>I'm 18+, I agree to the disclaimer and Terms of Use.</span>
        </label>
        <div className="modal-actions" style={{ justifyContent: 'center', marginTop: 20 }}>
          <button
            className="btn-primary"
            disabled={!agreed}
            onClick={handleAccept}
            data-testid="disclaimer-accept-btn"
            style={{ minWidth: 200 }}
          >
            🔥 Let's Roast
          </button>
        </div>
      </div>
    </div>
  );
}
