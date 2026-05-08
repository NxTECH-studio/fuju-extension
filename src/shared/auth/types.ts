export interface LoginRequest {
  identifier: string;
  password: string;
}

// recovery code 対応は対象外。将来拡張する際に判別共用体化する。
export interface MfaVerifyRequest {
  code: string;
}

export interface MfaChallenge {
  // popup 側に渡す MFA 入力フェーズの情報。pre_token そのものは渡さない。
  expiresAt: number; // Unix seconds, pre_token の `exp`
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_expires_in: number;
}

export interface PreTokenResponse {
  pre_token: string;
  mfa_required: true;
  token_type: 'Bearer';
  expires_in: number;
}

export type LoginResponse = TokenResponse | PreTokenResponse;

export interface User {
  id: string;
  email: string;
  public_id: string;
  mfa_enabled: boolean;
  icon_url: string | null;
  created_at: string;
}

export interface AuthCoreError {
  error: string;
  message: string;
}

/**
 * AuthCore `GET /v1/user/social-accounts` が返す連携済み social account 1 件分。
 *
 * - `provider_user_id` は provider ごとに意味が変わる:
 *   - `'x'` — X user ID。
 *   - `'google'` — Google subject ID。
 *   - `'youtube'` — YouTube channel ID (`UC...`)。
 * - `display_name` は AuthCore 側 migration で追加された列で、provider ごとに以下を保存:
 *   - `'youtube'` — `youtube/v3/channels` `snippet.title`（チャンネル名）。
 *   - 他 provider — provider ごとの表示名。空の場合は空文字列が返る想定。
 *
 * AuthCore 側のレスポンス形が確定し次第、必要なら本型を上書きする。
 */
export interface SocialAccount {
  provider: 'x' | 'google' | 'youtube';
  provider_user_id: string;
  display_name: string;
}

export interface SocialAccountsResponse {
  accounts: SocialAccount[];
}

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
}

export function isPreTokenResponse(value: LoginResponse): value is PreTokenResponse {
  return (value as PreTokenResponse).mfa_required === true;
}
