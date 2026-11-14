import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import supabase from '../lib/supabase';
import { signInWithGoogle } from '../lib/googleAuth';
import { useToast } from '../contexts/useToast';
import { useAuth } from '../contexts/useAuth';

export default function Login() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();

  // When the auth context confirms a logged-in user, go to the studio.
  // This avoids a race where navigate() fires before onAuthStateChange
  // updates the context (which would cause ProtectedRoute to bounce back).
  useEffect(() => {
    if (user) navigate('/studio', { replace: true });
  }, [user, navigate]);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast('Enter email and password', 'error');
      return;
    }
    if (password.length < 6) {
      toast('Password must be at least 6 characters', 'error');
      return;
    }
    setBusy(true);
    try {
      if (resetMode) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + '/login',
        });
        if (error) throw error;
        toast('Password reset email sent — check your inbox', 'success');
        setResetMode(false);
        return;
      }
      if (isSignUp) {
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin + '/studio' },
        });
        if (signUpError) throw signUpError;

        // If Supabase returned a session immediately (email confirmation disabled),
        // the onAuthStateChange listener will fire and the useEffect navigates.
        if (signUpData.session) {
          toast('Account created! Welcome to Da RoastBox 🔥', 'success');
          return;
        }

        // No session yet — try to sign in immediately. This works when email
        // confirmation is disabled on the Supabase project (common for demos).
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (!signInError && signInData.session) {
          toast('Account created! Welcome to Da RoastBox 🔥', 'success');
          return;
        }

        // Email confirmation is required — tell the user to verify, then sign in.
        toast('Account created! Check your email to verify, then sign in.', 'success');
        setIsSignUp(false);
      } else {
        const { data: signInData, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        if (signInData.session) {
          toast('Welcome back! 🔥', 'success');
          // Navigation handled by the useEffect watching `user`.
        } else {
          toast('Check your email to verify your account, then sign in.', 'info');
        }
      }
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="splash" style={{ ['--splash-bg' as string]: "url('/assets/splash_bg.png')" }}>
      <div className="splash-card">
        <h1 className="splash-title" style={{ fontSize: 32 }}>
          {resetMode ? 'RESET PASSWORD' : isSignUp ? 'JOIN THE ROAST' : 'SIGN IN'}
        </h1>
        <p className="splash-subtitle">
          {resetMode ? 'We\'ll email you a reset link.' : 'Sign in to roast and get roasted.'}
        </p>

        <form onSubmit={handleEmailAuth} className="flex-col" style={{ marginTop: 8 }}>
          <input
            className="input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            data-testid="email-input"
          />
          {!resetMode && (
            <input
              className="input"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-testid="password-input"
            />
          )}
          <button
            className="btn-primary"
            type="submit"
            disabled={busy}
            data-testid="auth-submit-btn"
          >
            {busy ? <><span className="spinner" /> &nbsp;Please wait…</> : resetMode ? 'Send Reset Link' : isSignUp ? 'Create Account' : 'Sign In'}
          </button>
        </form>

        {!resetMode && (
          <>
            <div style={{ margin: '14px 0', textAlign: 'center', color: 'var(--text-soft)', fontSize: 13 }}>
              or
            </div>
            <button
              className="btn-secondary"
              onClick={() => signInWithGoogle('Da RoastBox')}
              disabled={busy}
              style={{ width: '100%' }}
              data-testid="google-signin-btn"
            >
              🔵 Continue with Google
            </button>
          </>
        )}

        <div style={{ marginTop: 16, textAlign: 'center', display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
          {!resetMode && (
            <button
              className="link-btn"
              onClick={() => setIsSignUp((s) => !s)}
              data-testid="toggle-auth-mode"
            >
              {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
            </button>
          )}
          <button className="link-btn" onClick={() => setResetMode((r) => !r)} data-testid="toggle-reset">
            {resetMode ? 'Back to sign in' : 'Forgot password?'}
          </button>
        </div>

        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <Link to="/" className="link-btn">← Back to splash</Link>
        </div>

        <p className="text-muted" style={{ textAlign: 'center', marginTop: 14, fontSize: 11 }}>
          Demo: <code>demo@roastbox.app</code> / <code>roastbox123</code>
        </p>
      </div>
    </div>
  );
}
