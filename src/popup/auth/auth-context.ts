import { createContext } from 'react';
import type { AuthErrorPayload } from '../../shared/auth/messages';
import type { LoginRequest, MfaChallenge, MfaVerifyRequest, User } from '../../shared/auth/types';

export interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  loading: boolean;
  error: AuthErrorPayload | null;
  mfaChallenge: MfaChallenge | null;
  login: (request: LoginRequest) => Promise<void>;
  verifyMfa: (request: MfaVerifyRequest) => Promise<void>;
  cancelMfa: () => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
