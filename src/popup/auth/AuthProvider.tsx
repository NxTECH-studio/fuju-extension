import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AuthErrorCode } from '../../shared/auth/errors';
import { AuthMessageType } from '../../shared/auth/messages';
import type {
  AuthErrorPayload,
  AuthResponse,
  GetStateResponseData,
  LoginResponseData,
} from '../../shared/auth/messages';
import { STORAGE_KEYS } from '../../shared/auth/storage';
import type { LoginRequest, User } from '../../shared/auth/types';
import { AuthContext } from './auth-context';
import type { AuthContextValue } from './auth-context';

function sendMessage<T>(message: unknown): Promise<AuthResponse<T>> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: AuthResponse<T> | undefined) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        resolve({
          ok: false,
          error: {
            code: AuthErrorCode.NETWORK_ERROR,
            message: lastError.message ?? 'Failed to reach background',
          },
        });
        return;
      }
      if (!response) {
        resolve({
          ok: false,
          error: {
            code: AuthErrorCode.INTERNAL_SERVER_ERROR,
            message: 'Empty response from background',
          },
        });
        return;
      }
      resolve(response);
    });
  });
}

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AuthErrorPayload | null>(null);

  const refreshState = useCallback(async () => {
    const response = await sendMessage<GetStateResponseData>({
      type: AuthMessageType.GET_STATE,
    });
    if (response.ok) {
      setUser(response.data.user);
      setIsAuthenticated(response.data.isAuthenticated);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    refreshState().finally(() => {
      if (!cancelled) {
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [refreshState]);

  useEffect(() => {
    const listener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string,
    ) => {
      if (areaName !== 'local') {
        return;
      }
      const watched = [
        STORAGE_KEYS.accessToken,
        STORAGE_KEYS.user,
        STORAGE_KEYS.accessTokenExp,
      ];
      if (watched.some((key) => key in changes)) {
        void refreshState();
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => {
      chrome.storage.onChanged.removeListener(listener);
    };
  }, [refreshState]);

  const login = useCallback(async (request: LoginRequest) => {
    setLoading(true);
    setError(null);
    try {
      const response = await sendMessage<LoginResponseData>({
        type: AuthMessageType.LOGIN,
        payload: request,
      });
      if (response.ok) {
        setUser(response.data.user);
        setIsAuthenticated(true);
      } else {
        setError(response.error);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await sendMessage<undefined>({ type: AuthMessageType.LOGOUT });
      if (!response.ok) {
        setError(response.error);
      }
      setUser(null);
      setIsAuthenticated(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated,
      loading,
      error,
      login,
      logout,
      clearError,
    }),
    [user, isAuthenticated, loading, error, login, logout, clearError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
