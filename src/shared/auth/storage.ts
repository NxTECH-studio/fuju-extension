import type { User } from './types';

export const STORAGE_KEYS = {
  accessToken: 'auth.accessToken',
  refreshToken: 'auth.refreshToken',
  accessTokenExp: 'auth.accessTokenExp',
  user: 'auth.user',
} as const;

export interface PersistedAuthState {
  accessToken: string | null;
  refreshToken: string | null;
  accessTokenExp: number | null;
  user: User | null;
}

interface RawStorage {
  [STORAGE_KEYS.accessToken]?: string;
  [STORAGE_KEYS.refreshToken]?: string;
  [STORAGE_KEYS.accessTokenExp]?: number;
  [STORAGE_KEYS.user]?: User;
}

export interface AuthTokenSnapshot {
  accessToken: string;
  accessTokenExp: number;
  refreshToken?: string | null;
}

function getLocal(): chrome.storage.LocalStorageArea {
  return chrome.storage.local;
}

export async function getAuthState(): Promise<PersistedAuthState> {
  const raw = (await getLocal().get([
    STORAGE_KEYS.accessToken,
    STORAGE_KEYS.refreshToken,
    STORAGE_KEYS.accessTokenExp,
    STORAGE_KEYS.user,
  ])) as RawStorage;
  return {
    accessToken: raw[STORAGE_KEYS.accessToken] ?? null,
    refreshToken: raw[STORAGE_KEYS.refreshToken] ?? null,
    accessTokenExp: raw[STORAGE_KEYS.accessTokenExp] ?? null,
    user: raw[STORAGE_KEYS.user] ?? null,
  };
}

export async function getRefreshToken(): Promise<string | null> {
  const state = await getAuthState();
  return state.refreshToken;
}

export async function setTokens(snapshot: AuthTokenSnapshot): Promise<void> {
  const payload: RawStorage = {
    [STORAGE_KEYS.accessToken]: snapshot.accessToken,
    [STORAGE_KEYS.accessTokenExp]: snapshot.accessTokenExp,
  };
  if (snapshot.refreshToken) {
    payload[STORAGE_KEYS.refreshToken] = snapshot.refreshToken;
  }
  await getLocal().set(payload);
}

export async function setUser(user: User | null): Promise<void> {
  if (user) {
    await getLocal().set({ [STORAGE_KEYS.user]: user });
  } else {
    await getLocal().remove(STORAGE_KEYS.user);
  }
}

export async function clearAuthState(): Promise<void> {
  await getLocal().remove([
    STORAGE_KEYS.accessToken,
    STORAGE_KEYS.refreshToken,
    STORAGE_KEYS.accessTokenExp,
    STORAGE_KEYS.user,
  ]);
}
