import { AUTHCORE_BASE_URL } from '../config';
import { AuthCoreApiError, AuthErrorCode, isAuthCoreError } from './errors';

/**
 * 連携対象の外部 provider 種別。
 *
 * - `'x'`  — X (旧 Twitter)。AuthCore 仕様上 `SOCIAL_LINK_ONLY`、link 専用。
 * - `'google'` — Google。本拡張では link 動線のみを扱う。
 */
export type Provider = 'x' | 'google';

export interface ConnectAuthorizeResponse {
  authorize_url: string;
  state: string;
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

function throwApiError(status: number, body: unknown, fallbackMessage: string): never {
  if (isAuthCoreError(body)) {
    throw new AuthCoreApiError(status, body.error, body.message);
  }
  throw new AuthCoreApiError(status, AuthErrorCode.INTERNAL_SERVER_ERROR, fallbackMessage);
}

function isConnectAuthorizeResponse(value: unknown): value is ConnectAuthorizeResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.authorize_url === 'string' && typeof candidate.state === 'string';
}

/**
 * `/v1/auth/connect/{provider}` の authorize URL（provider の認可画面 URL）を取得する。
 *
 * `Accept: application/json` 指定時に AuthCore は 302 を返さず JSON で
 * `{ authorize_url, state }` を返す（body-mode 対応）。`final_redirect` は
 * AuthCore 側の `EXTENSION_REDIRECT_ALLOW_LIST` で完全一致検証されるため、
 * 拡張機能 ID 由来の `chrome.identity.getRedirectURL('cb')` を呼び出し側で渡す。
 */
export async function getConnectAuthorizeUrl(
  accessToken: string,
  provider: Provider,
  finalRedirect: string,
): Promise<string> {
  const params = new URLSearchParams({ final_redirect: finalRedirect });
  const url = `${AUTHCORE_BASE_URL}/v1/auth/connect/${provider}?${params.toString()}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network request failed';
    throw new AuthCoreApiError(0, AuthErrorCode.NETWORK_ERROR, message);
  }

  const body = await parseBody(response);
  if (!response.ok) {
    throwApiError(response.status, body, `Failed to start provider connect (${response.status})`);
  }
  if (!isConnectAuthorizeResponse(body)) {
    throw new AuthCoreApiError(
      response.status,
      AuthErrorCode.INTERNAL_SERVER_ERROR,
      'AuthCore did not return an authorize URL',
    );
  }
  return body.authorize_url;
}
