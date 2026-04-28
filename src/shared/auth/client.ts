import { AUTHCORE_BASE_URL } from '../config';
import { AuthCoreApiError, AuthErrorCode, isAuthCoreError } from './errors';
import type {
  LoginRequest,
  LoginResponse,
  MfaVerifyRequest,
  TokenResponse,
  User,
} from './types';

interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  cookieHeader?: string;
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
    ...(options.headers ?? {}),
  };
  if (options.body !== undefined && headers['Content-Type'] === undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.cookieHeader) {
    // chrome.runtime fetch does not auto-attach refresh_token cookie because the request
    // origin is `chrome-extension://<id>`. The background worker injects it manually.
    headers['Cookie'] = options.cookieHeader;
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
      credentials: 'include',
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
  cookieHeader?: string;
}

export async function refresh(options: RefreshOptions = {}): Promise<TokenResponse> {
  return request<TokenResponse>('/v1/auth/refresh', {
    method: 'POST',
    cookieHeader: options.cookieHeader,
  });
}

export async function logout(options: RefreshOptions = {}): Promise<void> {
  await request<unknown>('/v1/auth/logout', {
    method: 'POST',
    cookieHeader: options.cookieHeader,
  });
}

export async function getProfile(accessToken: string): Promise<User> {
  return request<User>('/v1/user/profile', {
    method: 'GET',
    bearerToken: accessToken,
  });
}

export async function verifyMfa(
  preToken: string,
  body: MfaVerifyRequest,
): Promise<TokenResponse> {
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
      credentials: 'include',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network request failed';
    throw new AuthCoreApiError(0, AuthErrorCode.NETWORK_ERROR, message);
  }

  const body = await parseBody(response);
  return { status: response.status, ok: response.ok, body };
}
