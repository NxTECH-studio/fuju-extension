import {
  fetchWithAccessToken,
  getProfile,
  login as loginRequest,
  logout as logoutRequest,
  refresh as refreshRequest,
} from '../shared/auth/client';
import { AuthCoreApiError, AuthErrorCode } from '../shared/auth/errors';
import {
  clearAuthState,
  getAuthState,
  setRefreshToken,
  setTokens,
  setUser,
} from '../shared/auth/storage';
import { decodeJwt, isExpired } from '../shared/auth/tokens';
import { isPreTokenResponse } from '../shared/auth/types';
import type {
  AuthState,
  LoginRequest,
  TokenResponse,
  User,
} from '../shared/auth/types';
import {
  AUTHCORE_BASE_URL,
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
} from '../shared/config';

const REFRESH_ALARM_NAME = 'auth.refresh';
const REFRESH_LEAD_SECONDS = 60;

function buildCookieUrl(): string {
  return `${AUTHCORE_BASE_URL}${REFRESH_COOKIE_PATH}`;
}

async function readRefreshCookie(): Promise<string | null> {
  if (!chrome.cookies?.get) {
    return null;
  }
  try {
    const cookie = await chrome.cookies.get({
      url: buildCookieUrl(),
      name: REFRESH_COOKIE_NAME,
    });
    return cookie?.value ?? null;
  } catch (error) {
    console.warn('[auth-manager] failed to read refresh cookie', error);
    return null;
  }
}

async function buildCookieHeader(): Promise<string | undefined> {
  const cookieValue = await readRefreshCookie();
  if (cookieValue) {
    return `${REFRESH_COOKIE_NAME}=${cookieValue}`;
  }
  const persisted = await getAuthState();
  if (persisted.refreshToken) {
    return `${REFRESH_COOKIE_NAME}=${persisted.refreshToken}`;
  }
  return undefined;
}

async function persistTokenResponse(token: TokenResponse): Promise<number> {
  const payload = decodeJwt(token.access_token);
  await setTokens({
    accessToken: token.access_token,
    accessTokenExp: payload.exp,
  });
  const refreshCookie = await readRefreshCookie();
  if (refreshCookie) {
    await setRefreshToken(refreshCookie);
  } else {
    // host_permissions / cookies permission が抜けているか、AuthCore 側で Set-Cookie が
    // 返っていない可能性が高い。Cookie が読めない場合は次回ブラウザ再起動後の自動復元が
    // 不可能になるため、警告だけ出して進める。
    console.warn(
      '[auth-manager] refresh_token cookie not found; verify host_permissions and AuthCore Set-Cookie',
    );
  }
  await scheduleRefresh(token.expires_in);
  return payload.exp;
}

async function scheduleRefresh(expiresInSeconds: number): Promise<void> {
  if (!chrome.alarms?.create) {
    return;
  }
  await chrome.alarms.clear(REFRESH_ALARM_NAME);
  const delayMinutes = Math.max((expiresInSeconds - REFRESH_LEAD_SECONDS) / 60, 0.5);
  chrome.alarms.create(REFRESH_ALARM_NAME, { delayInMinutes: delayMinutes });
}

async function clearRefreshAlarm(): Promise<void> {
  if (!chrome.alarms?.clear) {
    return;
  }
  await chrome.alarms.clear(REFRESH_ALARM_NAME);
}

async function loadCurrentState(): Promise<AuthState> {
  const persisted = await getAuthState();
  const isAuthenticated = Boolean(
    persisted.accessToken && persisted.user && !isExpired(persisted.accessToken),
  );
  return {
    user: persisted.user,
    isAuthenticated,
  };
}

export async function init(): Promise<void> {
  const persisted = await getAuthState();
  if (!persisted.accessToken) {
    return;
  }
  if (!isExpired(persisted.accessToken)) {
    const remaining = Math.max(
      (persisted.accessTokenExp ?? 0) - Math.floor(Date.now() / 1000),
      REFRESH_LEAD_SECONDS,
    );
    await scheduleRefresh(remaining);
    return;
  }
  try {
    await refreshTokens();
  } catch (error) {
    console.warn('[auth-manager] refresh on init failed', error);
    await clearAll();
  }
}

export async function handleLogin(request: LoginRequest): Promise<{ user: User }> {
  const response = await loginRequest(request);
  if (isPreTokenResponse(response)) {
    throw new AuthCoreApiError(
      403,
      AuthErrorCode.MFA_NOT_SUPPORTED,
      'MFA login is not supported in this version',
    );
  }
  await persistTokenResponse(response);
  const user = await getProfile(response.access_token);
  await setUser(user);
  return { user };
}

let refreshInflight: Promise<TokenResponse> | null = null;

export async function refreshTokens(): Promise<TokenResponse> {
  // AuthCore の Refresh Token Rotation は 1 family 内で有効な refresh は 1 本のみ。
  // 並行発火させると再利用検知で family ごと無効化されるため、in-flight の Promise を共有する。
  if (refreshInflight) {
    return refreshInflight;
  }
  refreshInflight = (async () => {
    try {
      const cookieHeader = await buildCookieHeader();
      const response = await refreshRequest({ cookieHeader });
      await persistTokenResponse(response);
      return response;
    } finally {
      refreshInflight = null;
    }
  })();
  return refreshInflight;
}

export async function handleLogout(): Promise<void> {
  const cookieHeader = await buildCookieHeader();
  try {
    await logoutRequest({ cookieHeader });
  } catch (error) {
    console.warn('[auth-manager] logout request failed', error);
  }
  await clearAll();
}

export async function getState(): Promise<AuthState> {
  return loadCurrentState();
}

export async function ensureAccessToken(): Promise<string> {
  const persisted = await getAuthState();
  if (persisted.accessToken && !isExpired(persisted.accessToken)) {
    return persisted.accessToken;
  }
  const refreshed = await refreshTokens();
  return refreshed.access_token;
}

export async function authenticatedFetch(
  path: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; ok: boolean; body: unknown }> {
  const accessToken = await ensureAccessToken();
  const result = await fetchWithAccessToken(path, accessToken, init);
  if (result.status !== 401) {
    return result;
  }
  // Token may have been revoked mid-flight; attempt one refresh and retry.
  try {
    const refreshed = await refreshTokens();
    return fetchWithAccessToken(path, refreshed.access_token, init);
  } catch (error) {
    await clearAll();
    throw error;
  }
}

async function clearAll(): Promise<void> {
  await clearAuthState();
  await clearRefreshAlarm();
}

export function registerAlarmHandler(): void {
  if (!chrome.alarms?.onAlarm) {
    return;
  }
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== REFRESH_ALARM_NAME) {
      return;
    }
    refreshTokens().catch(async (error) => {
      console.warn('[auth-manager] scheduled refresh failed', error);
      await clearAll();
    });
  });
}
