import { useEffect, useState, useCallback } from 'react';
import { apiGet, apiPost } from '../lib/api';
import { useAuth } from '../contexts/useAuth';
import { useToast } from '../contexts/useToast';
import { Crown, Star, Zap, Check } from 'lucide-react';

interface Pack {
  id: string;
  credits: number;
  amount_usd: number;
  name: string;
}

interface Sub {
  id: string;
  name: string;
  monthly_usd: number;
  annual_usd: number;
  description: string;
  tier: string;
}

interface Txn {
  amount: number;
  type: string;
  description: string;
  created_at: string;
}

export default function CreditsPage() {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [balance, setBalance] = useState(0);
  const [subTier, setSubTier] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('monthly');
  const { token, refreshProfile } = useAuth();
  const { toast } = useToast();

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const data = await apiGet('/credits', token);
      setPacks(data.packs || []);
      setSubs(data.subscriptions || []);
      setTxns(data.transactions || []);
      setBalance(data.balance || 0);
      setSubTier(data.subscription_tier || null);
    } catch (e) {
      toast('Failed to load: ' + (e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [token, toast]);

  useEffect(() => {
    let cancelled = false;
    if (!token) return;
    apiGet('/credits', token)
      .then((data) => {
        if (cancelled) return;
        setPacks(data.packs || []);
        setSubs(data.subscriptions || []);
        setTxns(data.transactions || []);
        setBalance(data.balance || 0);
        setSubTier(data.subscription_tier || null);
      })
      .catch((e) => {
        if (!cancelled) toast('Failed to load: ' + (e as Error).message, 'error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, toast]);

  const buy = async (pack_id: string, isSub = false) => {
    if (!token) return;
    setBusy(pack_id + (isSub ? billingPeriod : ''));
    try {
      const body = isSub ? { pack_id, billing_period: billingPeriod } : { pack_id };
      const data = await apiPost('/credits', body, token);
      if (data.checkout_url) {
        window.location.assign(data.checkout_url);
        return;
      }
      toast(isSub ? 'Subscription activated! 🔥' : `+${data.credits_added} credits added! 🔥`, 'success');
      setBalance(data.credits_balance ?? balance);
      await refreshProfile();
      await load();
    } catch (e) {
      toast('Purchase failed: ' + (e as Error).message, 'error');
    } finally {
      setBusy('');
    }
  };

  if (loading)
    return <div className="empty-state" style={{ minHeight: 200 }}><span className="spinner" /> Loading…</div>;

  const subIcons: Record<string, React.ReactNode> = {
    premium_personas: <Star size={20} style={{ color: '#ffd700' }} />,
    premium_voices: <Zap size={20} style={{ color: '#6bd3ff' }} />,
    all_access: <Crown size={20} style={{ color: '#ff5c2a' }} />,
  };

  return (
    <div className="workspace" style={{ gridTemplateColumns: '1fr' }} data-testid="credits-page">
      {/* Balance */}
      <div className="panel" style={{ maxWidth: 1100, margin: '0 auto', width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ margin: 0 }}>🔥 Stock Up on Roasts</h2>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {subTier && <span className="sub-badge">{subTier.replace(/_/g, ' ').toUpperCase()}</span>}
            <span className="credit-pill">🔥 {balance} Roasts</span>
          </div>
        </div>
      </div>

      {/* Subscriptions */}
      <div className="panel" style={{ maxWidth: 1100, margin: '16px auto 0', width: '100%' }}>
        <h2>Subscription Passes</h2>
        <p className="text-muted" style={{ marginTop: 4, fontSize: 13 }}>
          Unlock premium features with a monthly or annual subscription. No credit charges for subscribed features.
        </p>

        {/* Billing toggle */}
        <div className="billing-toggle">
          <button className={`billing-btn ${billingPeriod === 'monthly' ? 'active' : ''}`} onClick={() => setBillingPeriod('monthly')}>Monthly</button>
          <button className={`billing-btn ${billingPeriod === 'annual' ? 'active' : ''}`} onClick={() => setBillingPeriod('annual')}>Annual <span className="save-badge">2 months free</span></button>
        </div>

        <div className="packs-grid" style={{ marginTop: 16 }}>
          {subs.map((s) => {
            const price = billingPeriod === 'annual' ? s.annual_usd : s.monthly_usd;
            const isActive = subTier === s.tier;
            return (
              <div key={s.id} className={`pack-card sub-card ${s.tier === 'all_access' ? 'featured' : ''}`}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>{subIcons[s.tier]}</div>
                <div className="pack-title">{s.name}</div>
                <div className="pack-credits">${price.toFixed(2)}<span>/{billingPeriod === 'annual' ? 'year' : 'month'}</span></div>
                <p className="text-muted" style={{ fontSize: 12, minHeight: 48 }}>{s.description}</p>
                <button
                  className={`btn-primary ${isActive ? 'btn-disabled' : ''}`}
                  onClick={() => !isActive && buy(s.id, true)}
                  disabled={busy === s.id + billingPeriod || isActive}
                  style={{ width: '100%' }}
                  data-testid={`sub-${s.id}-btn`}
                >
                  {isActive ? <><Check size={16} /> Active</> :
                   busy === s.id + billingPeriod ? <><span className="spinner" /> Processing…</> :
                   'Subscribe'}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* One-time packs */}
      <div className="panel" style={{ maxWidth: 1100, margin: '16px auto 0', width: '100%' }}>
        <h2>Credit Packs</h2>
        <p className="text-muted" style={{ marginTop: 4, fontSize: 13 }}>One-time purchases. Credits never expire.</p>
        <div className="packs-grid" style={{ marginTop: 16 }}>
          {packs.map((p) => (
            <div key={p.id} className={`pack-card ${p.id === 'pro' ? 'featured' : ''} ${p.id === 'boss' ? 'boss-card' : ''}`} data-testid={`pack-${p.id}`}>
              <div className="pack-title">{p.name}</div>
              <div className="pack-credits">{p.credits}<span> roasts</span></div>
              <div className="pack-price">${p.amount_usd.toFixed(2)}</div>
              <button
                className="btn-primary"
                onClick={() => buy(p.id)}
                disabled={busy === p.id}
                style={{ width: '100%' }}
                data-testid={`buy-${p.id}-btn`}
              >
                {busy === p.id ? <><span className="spinner" /> Processing…</> : 'Buy Pack'}
              </button>
            </div>
          ))}
        </div>
        <p className="text-muted" style={{ marginTop: 24, fontSize: 12, textAlign: 'center' }}>
          Payments processed by Stripe. Test card: <code>4242 4242 4242 4242</code> · any future expiry & CVC.
        </p>
      </div>

      {/* Transactions */}
      {txns.length > 0 && (
        <div className="panel" style={{ maxWidth: 1100, margin: '16px auto 0', width: '100%' }}>
          <h2>Transaction History</h2>
          <div className="txn-list">
            {txns.map((t, i) => (
              <div key={i} className="txn-row">
                <span className={`txn-amount ${t.amount > 0 ? 'positive' : 'negative'}`}>
                  {t.amount > 0 ? '+' : ''}{t.amount}
                </span>
                <span className="txn-desc">{t.description}</span>
                <span className="txn-date">{new Date(t.created_at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
