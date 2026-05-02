import { completeConnectCallback, getConnectAuthorizeUrl } from '../shared/auth/providers';
import type { Provider } from '../shared/auth/providers';
import { ensureAccessToken } from './auth-manager';

/**
 * `/v1/auth/connect/{provider}` の authorize URL を取得して popup に返す。
 * popup 側はこの URL を `chrome.identity.launchWebAuthFlow` に渡す。
 */
export async function handleGetConnectUrl(provider: Provider): Promise<{ authorizeUrl: string }> {
  const accessToken = await ensureAccessToken();
  const authorizeUrl = await getConnectAuthorizeUrl(accessToken, provider);
  return { authorizeUrl };
}

/**
 * `launchWebAuthFlow` の終了 URL から popup が抽出した `code` / `state` を受け取り、
 * AuthCore の callback エンドポイントを叩いて provider 連携を完了させる。
 */
export async function handleCompleteConnect(
  provider: Provider,
  code: string,
  state: string,
): Promise<{ provider: Provider }> {
  const accessToken = await ensureAccessToken();
  await completeConnectCallback(accessToken, provider, code, state);
  return { provider };
}
