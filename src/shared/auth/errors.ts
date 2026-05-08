import type { AuthCoreError } from './types';

export const AuthErrorCode = {
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  USER_ALREADY_EXISTS: 'USER_ALREADY_EXISTS',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  TOKEN_REVOKED: 'TOKEN_REVOKED',
  TOKEN_MALFORMED: 'TOKEN_MALFORMED',
  MFA_REQUIRED: 'MFA_REQUIRED',
  MFA_NOT_ENABLED: 'MFA_NOT_ENABLED',
  MFA_NOT_PENDING: 'MFA_NOT_PENDING',
  INVALID_TOTP: 'INVALID_TOTP',
  PRE_TOKEN_INVALID: 'PRE_TOKEN_INVALID',
  PRE_TOKEN_EXPIRED: 'PRE_TOKEN_EXPIRED',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  // social link 失敗系。AuthCore が `/v1/auth/connect/{provider}` callback fragment や
  // 関連 API のエラーレスポンスで返すコード。
  SOCIAL_ALREADY_LINKED: 'SOCIAL_ALREADY_LINKED',
  SOCIAL_ALREADY_LINKED_TO_OTHER_USER: 'SOCIAL_ALREADY_LINKED_TO_OTHER_USER',
  INVALID_REQUEST: 'INVALID_REQUEST',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  NETWORK_ERROR: 'NETWORK_ERROR',
  /**
   * @deprecated 本タスク（support-mfa-login）以降、TOTP MFA は通常フローで対応済み。
   *   このコードは下記用途のために残置している:
   *     - recovery code 等、本拡張ではまだ未対応の MFA サブケースのフォールバック
   *     - 将来 MFA 全体を一時的に無効化（feature flag 等）したい場合の再利用
   *   通常の TOTP MFA フローでは throw しない。
   */
  MFA_NOT_SUPPORTED: 'MFA_NOT_SUPPORTED',
} as const;

export type AuthErrorCode = (typeof AuthErrorCode)[keyof typeof AuthErrorCode];

export function isAuthCoreError(value: unknown): value is AuthCoreError {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.error === 'string' && typeof candidate.message === 'string';
}

export class AuthCoreApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'AuthCoreApiError';
    this.status = status;
    this.code = code;
  }
}
