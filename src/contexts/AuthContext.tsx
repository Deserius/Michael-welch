import { useState, useEffect, useCallback, type ReactNode } from 'react';
import supabase from '../lib/supabase';
import { apiGet } from '../lib/api';
import { AuthContext, type Profile } from './auth-context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshProfile = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const tok = session?.access_token || null;
    setToken(tok);
    if (!tok) {
      setProfile(null);
      return;
    }
    try {
      setProfile(await apiGet('/profile', tok));
    } catch (e) {
      console.error('profile fetch error:', e);
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const tok = session?.access_token || null;
      setToken(tok);
      setUser(session?.user ? { id: session.user.id, email: session.user.email || '' } : null);
      if (tok) {
        apiGet('/profile', tok)
          .then(setProfile)
          .catch(() => setProfile(null))
          .finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const tok = session?.access_token || null;
      setToken(tok);
      setUser(session?.user ? { id: session.user.id, email: session.user.email || '' } : null);
      if (tok) {
        apiGet('/profile', tok)
          .then(setProfile)
          .catch(() => setProfile(null))
          .finally(() => setLoading(false));
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setToken(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, profile, loading, token, refreshProfile, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
