import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiGet } from '../lib/api';
import { useAuth } from '../contexts/useAuth';

export default function CheckoutSuccess() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session_id');
  const sub = searchParams.get('sub');
  const { token, refreshProfile } = useAuth();
  const [status, setStatus] = useState<'checking' | 'paid' | 'pending' | 'error'>(
    // Missing params means there is nothing to poll for — start in the error
    // state rather than setting it from inside the effect.
    sessionId ? 'checking' : 'error'
  );
  const [creditsAdded, setCreditsAdded] = useState(0);
  const [subTier, setSubTier] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !sessionId) return;
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 20; // Poll for up to 40 seconds

    const poll = async () => {
      if (cancelled) return;
      attempts++;
      try {
        const url = sub
          ? `/payment-status?session_id=${sessionId}&sub=${sub}`
          : `/payment-status?session_id=${sessionId}`;
        const data = await apiGet(url, token);

        if (data.payment_status === 'paid') {
          if (cancelled) return;
          setCreditsAdded(data.credits_added || 0);
          if (data.subscription_tier) setSubTier(data.subscription_tier);
          setStatus('paid');
          // CRITICAL: Refresh the profile so the credit balance updates everywhere
          await refreshProfile();
          return;
        }

        if (attempts < maxAttempts) {
          setTimeout(poll, 2000);
        } else {
          setStatus('pending');
        }
      } catch {
        if (attempts < maxAttempts) {
          setTimeout(poll, 2000);
        } else {
          setStatus('pending');
        }
      }
    };
    poll();

    return () => { cancelled = true; };
  }, [token, sessionId, sub, refreshProfile]);

  return (
    <div className="workspace" style={{ gridTemplateColumns: '1fr' }}>
      <div className="panel" style={{ maxWidth: 540, margin: '40px auto', textAlign: 'center' }}>
        {status === 'checking' && (
          <>
            <div className="spinner" style={{ width: 32, height: 32 }} />
            <h2>Verifying Payment…</h2>
            <p className="text-muted">Please wait while we confirm your purchase and update your credits.</p>
          </>
        )}
        {status === 'paid' && (
          <>
            <div style={{ fontSize: 48 }}>🎉</div>
            <h2>Payment Successful!</h2>
            {subTier && (
              <p className="text-muted">
                <strong style={{ color: 'var(--accent-main)' }}>{subTier.replace(/_/g, ' ').toUpperCase()}</strong> subscription activated!
              </p>
            )}
            {creditsAdded > 0 && (
              <p className="text-muted">
                <strong style={{ color: 'var(--accent-main)' }}>+{creditsAdded} credits</strong> added to your account!
              </p>
            )}
            <Link to="/studio" className="btn-primary" style={{ display: 'inline-block', marginTop: 16 }}>
              Back to Studio
            </Link>
          </>
        )}
        {status === 'pending' && (
          <>
            <div style={{ fontSize: 48 }}>⏳</div>
            <h2>Payment Processing</h2>
            <p className="text-muted">
              Your payment is being processed. Credits will appear in your account shortly.
              If you don't see them, try refreshing the page.
            </p>
            <Link to="/studio" className="btn-secondary" style={{ display: 'inline-block', marginTop: 16 }}>
              Back to Studio
            </Link>
          </>
        )}
        {status === 'error' && (
          <>
            <div style={{ fontSize: 48 }}>😕</div>
            <h2>Something went wrong</h2>
            <p className="text-muted">We couldn't verify your payment. Please contact support if credits don't appear.</p>
            <Link to="/credits" className="btn-secondary" style={{ display: 'inline-block', marginTop: 16 }}>
              Back to Credits
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
