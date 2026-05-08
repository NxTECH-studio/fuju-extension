import { AUTHCORE_BASE_URL } from '../config';
import { AuthCoreApiError, AuthErrorCode, isAuthCoreError } from './errors';
import type {
  LoginRequest,
  LoginResponse,
  MfaVerifyRequest,
  SocialAccountsResponse,
  TokenResponse,
  User,
} from './types';

interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  bearerToken?: string;
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = `${AUTHCORE_BASE_URL}${path}`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    // body-mode opt-in. AuthCore は X-Token-Delivery: body 指定時に Set-Cookie を返さず
    // refresh_token を JSON body に乗せる。本拡張は cookie 経路を撤廃済みのため常に body を要求する。
    'X-Token-Delivery': 'body',
    ...(options.headers ?? {}),
  };
  if (options.body !== undefined && headers['Content-Type'] === undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.bearerToken) {
    headers['Authorization'] = `Bearer ${options.bearerToken}`;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      // body-mode では refresh_token を JSON body で授受するため cookie 不要。
      // 旧 cookie-mode の残存 cookie が同行することによる transport 混在を避けるため omit。
      credentials: 'omit',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network request failed';
    throw new AuthCoreApiError(0, AuthErrorCode.NETWORK_ERROR, message);
  }

  const body = await parseBody(response);

  if (!response.ok) {
    if (isAuthCoreError(body)) {
      throw new AuthCoreApiError(response.status, body.error, body.message);
    }
    throw new AuthCoreApiError(
      response.status,
      AuthErrorCode.INTERNAL_SERVER_ERROR,
      `Unexpected response (${response.status})`,
    );
  }

  return body as T;
}

export async function login(payload: LoginRequest): Promise<LoginResponse> {
  return request<LoginResponse>('/v1/auth/login', {
    method: 'POST',
    body: payload,
  });
}

export interface RefreshOptions {
  refreshToken: string | null;
}

export async function refresh(options: RefreshOptions): Promise<TokenResponse> {
  if (!options.refreshToken) {
    // body-mode では refresh_token を必ず body に詰める必要がある。storage に無ければ
    // family は既に失効していると見なし、cookie フォールバックは持たない。
    throw new AuthCoreApiError(401, AuthErrorCode.TOKEN_REVOKED, 'No refresh token available');
  }
  return request<TokenResponse>('/v1/auth/refresh', {
    method: 'POST',
    body: { refresh_token: options.refreshToken },
  });
}

export async function logout(options: RefreshOptions): Promise<void> {
  // refresh_token が無い場合でもサーバ側は idempotent に 200 を返す。
  const body = options.refreshToken ? { refresh_token: options.refreshToken } : {};
  await request<unknown>('/v1/auth/logout', {
    method: 'POST',
    body,
  });
}

export async function getProfile(accessToken: string): Promise<User> {
  return request<User>('/v1/user/profile', {
    method: 'GET',
    bearerToken: accessToken,
  });
}

/**
 * AuthCore `GET /v1/user/social-accounts` を叩き、連携済み social account 一覧を取得する。
 *
 * AuthCore 側が `display_name` 列を含めて返す（migration 後）。レスポンス形は
 * `SocialAccountsResponse` を参照。
 */
export async function getSocialAccounts(accessToken: string): Promise<SocialAccountsResponse> {
  return request<SocialAccountsResponse>('/v1/user/social-accounts', {
    method: 'GET',
    bearerToken: accessToken,
  });
}

export async function verifyMfa(preToken: string, body: MfaVerifyRequest): Promise<TokenResponse> {
  // AuthCore 仕様: /v1/auth/mfa/verify は pre_token を `Authorization: Bearer` で受け取る
  // (openapi.yaml: securityScheme `preToken`)。
  return request<TokenResponse>('/v1/auth/mfa/verify', {
    method: 'POST',
    bearerToken: preToken,
    body,
  });
}

export async function fetchWithAccessToken(
  path: string,
  accessToken: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; ok: boolean; body: unknown }> {
  const url = `${AUTHCORE_BASE_URL}${path}`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
    ...(init?.headers ?? {}),
  };
  if (init?.body !== undefined && headers['Content-Type'] === undefined) {
    headers['Content-Type'] = 'application/json';
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: init?.method ?? 'GET',
      headers,
      body: init?.body,
      // body-mode では refresh_token を JSON body で授受するため cookie 不要。
      // 旧 cookie-mode の残存 cookie が同行することによる transport 混在を避けるため omit。
      credentials: 'omit',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network request failed';
    throw new AuthCoreApiError(0, AuthErrorCode.NETWORK_ERROR, message);
  }

  const body = await parseBody(response);
  return { status: response.status, ok: response.ok, body };
}
