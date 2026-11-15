import { useState, useEffect } from 'react';
import { apiPost, apiDelete, apiGet } from '../lib/api';
import { useAuth } from '../contexts/useAuth';
import { useToast } from '../contexts/useToast';
import supabase from '../lib/supabase';

export default function SettingsPage() {
  const { profile, token, refreshProfile, signOut } = useAuth();
  const { toast } = useToast();
  const [openaiKey, setOpenaiKey] = useState('');
  const [elevenKey, setElevenKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [globalStatus, setGlobalStatus] = useState<{
    has_openai: boolean;
    has_elevenlabs: boolean;
    has_byok_openai?: boolean;
    has_byok_elevenlabs?: boolean;
    global_openai?: boolean;
    global_elevenlabs?: boolean;
  } | null>(null);

  useEffect(() => {
    if (token) {
      apiGet('/voice-settings', token)
        .then((data) => setGlobalStatus(data))
        .catch(() => {});
    }
  }, [token]);

  const save = async () => {
    if (!token) return;
    setBusy(true);
    try {
      await apiPost('/voice-settings', {
        openai_key: openaiKey || undefined,
        elevenlabs_key: elevenKey || undefined,
      }, token);
      await refreshProfile();
      setOpenaiKey('');
      setElevenKey('');
      toast('Your API keys saved. They are used for your account only.', 'success');
      // Refresh key status
      const data = await apiGet('/voice-settings', token);
      setGlobalStatus(data);
    } catch (e) {
      toast('Failed: ' + (e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const clearAll = async () => {
    if (!token) return;
    setBusy(true);
    try {
      await apiDelete('/voice-settings', token);
      await refreshProfile();
      toast('Your keys were removed. Falling back to the app key.', 'success');
    } catch (e) {
      toast('Failed: ' + (e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async () => {
    if (!profile?.email) return;
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(profile.email, {
        redirectTo: window.location.origin + '/login',
      });
      if (error) throw error;
      toast('Password reset email sent', 'success');
    } catch (e) {
      toast('Failed: ' + (e as Error).message, 'error');
    }
  };

  return (
    <div className="workspace" style={{ gridTemplateColumns: '1fr' }} data-testid="settings-page">
      <div className="panel" style={{ maxWidth: 720, margin: '0 auto', width: '100%' }}>
        <h2>Account</h2>
        <p>Signed in as <strong>{profile?.email}</strong></p>
        <p>Current credits: <strong>{profile?.credits ?? 0}</strong></p>
        <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
          <button className="btn-secondary" onClick={resetPassword} data-testid="reset-pw-btn">Reset Password</button>
          <button className="btn-secondary" onClick={signOut} data-testid="settings-logout-btn">Sign Out</button>
        </div>

        <div className="divider" />
        <h2>Your API Keys (BYOK)</h2>
        <p className="text-muted" style={{ fontSize: 13 }}>
          Bring your own OpenAI / ElevenLabs keys. They are stored server-side, are used{' '}
          <strong>only for your account</strong>, and are never sent back to the browser. Leave both
          fields blank to use the app's shared key.
        </p>

        {/* Global Status */}
        {globalStatus && (
          <div className="global-key-status" style={{ marginTop: 12 }}>
            <div className="key-status-row">
              <span>OpenAI (Script Gen + Image Analysis + TTS):</span>
              <span className={`key-badge ${globalStatus.has_openai ? 'active' : 'inactive'}`}>
                {globalStatus.has_openai ? '✓ Active' : '✗ Not Set'}
              </span>
            </div>
            <div className="key-status-row">
              <span>ElevenLabs (Premium Voices):</span>
              <span className={`key-badge ${globalStatus.has_elevenlabs ? 'active' : 'inactive'}`}>
                {globalStatus.has_elevenlabs ? '✓ Active' : '✗ Not Set'}
              </span>
            </div>
          </div>
        )}

        <label className="label" style={{ marginTop: 16 }}>
          OpenAI API Key{' '}
          {globalStatus?.has_byok_openai ? (
            <span className="text-accent">(your key active)</span>
          ) : globalStatus?.global_openai ? (
            <span className="text-accent">(app key active)</span>
          ) : null}
        </label>
        <input className="input" placeholder="sk-..." type="password"
          value={openaiKey} onChange={(e) => setOpenaiKey(e.target.value)}
          data-testid="openai-key-input" />

        <label className="label" style={{ marginTop: 12 }}>
          ElevenLabs API Key{' '}
          {globalStatus?.has_byok_elevenlabs ? (
            <span className="text-accent">(your key active)</span>
          ) : globalStatus?.global_elevenlabs ? (
            <span className="text-accent">(app key active)</span>
          ) : null}
        </label>
        <input className="input" placeholder="xxxx..." type="password"
          value={elevenKey} onChange={(e) => setElevenKey(e.target.value)}
          data-testid="elevenlabs-key-input" />

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button className="btn-primary" onClick={save} disabled={busy} data-testid="save-keys-btn">
            Save My Keys
          </button>
          <button className="btn-secondary" onClick={clearAll} disabled={busy} data-testid="clear-keys-btn">
            Clear My Keys
          </button>
        </div>

        <div className="divider" />
        <h2>How AI Pipeline Works</h2>
        <div style={{ fontSize: 13, color: 'var(--text-soft)', lineHeight: 1.7 }}>
          <p><strong style={{ color: 'var(--accent-alt)' }}>1. Image Analysis:</strong> The uploaded photo is analyzed using GPT-4o (premium) or GPT-4o-mini (standard) to extract facial features, expression, fashion, and body language. This creates a personalized profile for targeted roasting.</p>
          <p><strong style={{ color: 'var(--accent-alt)' }}>2. Script Generation:</strong> The roast script (intro + body + outro) is generated using the analyzed image data + context. Premium mode uses GPT-4o for the best quality. Standard mode uses GPT-4o-mini.</p>
          <p><strong style={{ color: 'var(--accent-alt)' }}>3. Voice Synthesis:</strong> Premium voices use ElevenLabs with distinct voice IDs per persona. If ElevenLabs fails or runs out of credits, it automatically falls back to OpenAI TTS with 6 distinct voices mapped across all 30 personas.</p>
          <p><strong style={{ color: 'var(--accent-alt)' }}>4. Fallback Chain:</strong> If no API keys are configured, the app uses a built-in local comedy engine with 150+ persona-specific roast templates.</p>
        </div>

        <div className="divider" />
        <h2>Credit Pricing</h2>
        <div style={{ fontSize: 13, color: 'var(--text-soft)', lineHeight: 1.8 }}>
          <p>• <strong>1 credit</strong> base per roast</p>
          <p>• <strong>+1 credit</strong> per premium persona roaster</p>
          <p>• <strong>+2 credits</strong> for premium AI (GPT-4o script + image analysis)</p>
          <p>• <strong>+1 credit</strong> for premium ElevenLabs voices</p>
          <p>• <strong>0 credits</strong> for active subscribers</p>
          <p className="text-muted" style={{ fontSize: 12, marginTop: 6 }}>
            Duration affects the length of the roast, not the price.
          </p>
        </div>

        <div className="divider" />
        <h2>Documentation</h2>
        <p className="text-muted" style={{ fontSize: 13, marginBottom: 10 }}>
          Download setup guides, architecture docs, and deployment instructions.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a className="btn-secondary" href="/docs/setup-guide.md" download>Setup Guide</a>
          <a className="btn-secondary" href="/docs/deployment-guide.md" download>Deployment Guide</a>
          <a className="btn-secondary" href="/docs/architecture.md" download>Architecture</a>
          <a className="btn-secondary" href="/docs/run-locally.md" download>Run Locally</a>
          <a className="btn-secondary" href="/docs/changelog.md" download>Changelog</a>
          <a className="btn-secondary" href="/docs/environment-template.env" download>Env Template</a>
        </div>
      </div>
    </div>
  );
}
