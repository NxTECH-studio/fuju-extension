import { AUTHCORE_BASE_URL } from '../config';
import { AuthCoreApiError, AuthErrorCode, isAuthCoreError } from './errors';

/**
 * 連携対象の外部 provider 種別。
 *
 * - `'x'`  — X (旧 Twitter)。AuthCore 仕様上 `SOCIAL_LINK_ONLY`、link 専用。
 * - `'google'` — Google。本拡張では link 動線のみを扱う。
 */
export type Provider = 'x' | 'google';

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

/**
 * `/v1/auth/connect/{provider}` の authorize URL（provider の認可画面 URL）を取得する。
 *
 * AuthCore はこのエンドポイントで 302 を返して provider の認可画面にリダイレクトする
 * 仕様だが、`chrome.identity.launchWebAuthFlow` は任意ヘッダ（Authorization）を付け
 * られないため、background から `redirect: 'manual'` で fetch して `Location` ヘッダ
 * を取り出してから launchWebAuthFlow に渡す方針を取る。
 *
 * `response.type === 'opaqueredirect'` で Location が読めない場合、現状の AuthCore
 * 仕様では拡張側から authorize URL を取得する手段がないため、後段で対応可能なよう
 * `AuthCoreApiError` を投げる（サーバ側で JSON エンドポイント or 短期 query token
 * への切り替えが必要）。
 */
export async function getConnectAuthorizeUrl(
  accessToken: string,
  provider: Provider,
): Promise<string> {
  const url = `${AUTHCORE_BASE_URL}/v1/auth/connect/${provider}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      redirect: 'manual',
      credentials: 'include',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network request failed';
    throw new AuthCoreApiError(0, AuthErrorCode.NETWORK_ERROR, message);
  }

  // ブラウザの fetch は cross-origin の 30x リダイレクトを `redirect: 'manual'` で
  // 補足すると `type === 'opaqueredirect'` の不透明レスポンスを返し、`Location` を
  // ヘッダから読み出せない。この場合は AuthCore 側に JSON 形式 or 短期 query token
  // 形式での authorize URL 提供を依頼する必要がある。
  if (response.type === 'opaqueredirect') {
    throw new AuthCoreApiError(
      0,
      AuthErrorCode.INTERNAL_SERVER_ERROR,
      'AuthCore returned an opaque redirect; cannot read authorize URL. ' +
        'AuthCore must expose a JSON endpoint or short-lived query token for /v1/auth/connect/{provider}.',
    );
  }

  // 同一オリジン or CORS 許可下のリダイレクトなど、ヘッダが読めるパスを優先採用。
  // 一部の AuthCore デプロイでは将来的に JSON で `{ authorize_url }` を返す可能性も
  // あるため、その場合のフォールバックも用意しておく。
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('Location');
    if (location) {
      return location;
    }
  }

  if (response.ok) {
    const body = await parseBody(response);
    if (body && typeof body === 'object' && 'authorize_url' in body) {
      const candidate = (body as { authorize_url?: unknown }).authorize_url;
      if (typeof candidate === 'string' && candidate.length > 0) {
        return candidate;
      }
    }
    throw new AuthCoreApiError(
      response.status,
      AuthErrorCode.INTERNAL_SERVER_ERROR,
      'AuthCore did not return an authorize URL',
    );
  }

  const body = await parseBody(response);
  throwApiError(response.status, body, `Failed to start provider connect (${response.status})`);
}

/**
 * `chrome.identity.launchWebAuthFlow` の終了 redirect から得た `code` / `state` を
 * AuthCore の callback エンドポイントに送り、provider 連携を完了させる。
 */
export async function completeConnectCallback(
  accessToken: string,
  provider: Provider,
  code: string,
  state: string,
): Promise<void> {
  const params = new URLSearchParams({ code, state });
  const url = `${AUTHCORE_BASE_URL}/v1/auth/callback/${provider}?${params.toString()}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      credentials: 'include',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network request failed';
    throw new AuthCoreApiError(0, AuthErrorCode.NETWORK_ERROR, message);
  }

  if (response.ok) {
    return;
  }

  const body = await parseBody(response);
  throwApiError(response.status, body, `Failed to complete provider connect (${response.status})`);
}
