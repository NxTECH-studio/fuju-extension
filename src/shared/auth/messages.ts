import type { AuthState, LoginRequest, MfaChallenge, MfaVerifyRequest, User } from './types';
import type { Provider } from './providers';

export const AuthMessageType = {
  LOGIN: 'AUTH_LOGIN',
  MFA_VERIFY: 'AUTH_MFA_VERIFY',
  MFA_CANCEL: 'AUTH_MFA_CANCEL',
  LOGOUT: 'AUTH_LOGOUT',
  GET_STATE: 'AUTH_GET_STATE',
  REFRESH: 'AUTH_REFRESH',
  FETCH: 'AUTH_FETCH',
  PROVIDER_GET_CONNECT_URL: 'PROVIDER_GET_CONNECT_URL',
  FUJU_USER_LOOKUP: 'FUJU_USER_LOOKUP',
} as const;

export type AuthMessageType = (typeof AuthMessageType)[keyof typeof AuthMessageType];

export interface AuthFetchPayload {
  path: string;
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  };
}

export interface AuthFetchResult {
  status: number;
  ok: boolean;
  body: unknown;
}

export interface ProviderGetConnectUrlPayload {
  provider: Provider;
}

export interface FujuUserLookupPayload {
  // X handle (screen name). サーバー側で normalize されるため、`@` 付きや URL でも可。
  userId: string;
}

export type AuthMessage =
  | { type: typeof AuthMessageType.LOGIN; payload: LoginRequest }
  | { type: typeof AuthMessageType.MFA_VERIFY; payload: MfaVerifyRequest }
  | { type: typeof AuthMessageType.MFA_CANCEL }
  | { type: typeof AuthMessageType.LOGOUT }
  | { type: typeof AuthMessageType.GET_STATE }
  | { type: typeof AuthMessageType.REFRESH }
  | { type: typeof AuthMessageType.FETCH; payload: AuthFetchPayload }
  | {
      type: typeof AuthMessageType.PROVIDER_GET_CONNECT_URL;
      payload: ProviderGetConnectUrlPayload;
    }
  | {
      type: typeof AuthMessageType.FUJU_USER_LOOKUP;
      payload: FujuUserLookupPayload;
    };

export interface AuthErrorPayload {
  code: string;
  message: string;
  status?: number;
}

export type AuthResponse<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: AuthErrorPayload };

export type LoginResponseData =
  | { kind: 'success'; user: User }
  | { kind: 'mfa_required'; challenge: MfaChallenge };

export type MfaVerifyResponseData = { user: User };

export type GetStateResponseData = AuthState;

export type FetchResponseData = AuthFetchResult;

export type ProviderGetConnectUrlResponseData = { authorizeUrl: string };

// `null` は「結果不明」(未ログイン or ネットワーク失敗 等)。
// `{ exists }` は AuthCore が 200 で返したルックアップ結果。
export type FujuUserLookupResponseData = { exists: boolean } | null;

export function isAuthMessage(value: unknown): value is AuthMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { type?: unknown };
  return (
    typeof candidate.type === 'string' &&
    (Object.values(AuthMessageType) as string[]).includes(candidate.type)
  );
}
