import { createContext } from 'react';

export interface Profile {
  id: string;
  user_id: string;
  email: string;
  credits: number;
  subscription_tier: string | null;
  has_byok_openai: boolean;
  has_byok_elevenlabs: boolean;
}

export interface AuthContextValue {
  user: { id: string; email: string } | null;
  profile: Profile | null;
  loading: boolean;
  token: string | null;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

/**
 * Declared in its own module so AuthContext.tsx only exports components,
 * which is what React Fast Refresh needs to hot-update cleanly.
 */
export const AuthContext = createContext<AuthContextValue>({
  user: null,
  profile: null,
  loading: true,
  token: null,
  refreshProfile: async () => {},
  signOut: async () => {},
});
