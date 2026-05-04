import { getSocialAccounts } from '../shared/auth/client';
import { getConnectAuthorizeUrl } from '../shared/auth/providers';
import type { Provider } from '../shared/auth/providers';
import type { SocialAccount } from '../shared/auth/types';
import { ensureAccessToken } from './auth-manager';

/**
 * `/v1/auth/connect/{provider}` の authorize URL を取得して popup に返す。
 * popup 側はこの URL を `chrome.identity.launchWebAuthFlow` に渡す。
 *
 * `final_redirect` は拡張機能 ID 由来の `chrome.identity.getRedirectURL('cb')` を
 * background 側で生成する。AuthCore の `EXTENSION_REDIRECT_ALLOW_LIST` に登録された
 * URL と完全一致する必要がある。
 */
export async function handleGetConnectUrl(provider: Provider): Promise<{ authorizeUrl: string }> {
  const accessToken = await ensureAccessToken();
  const finalRedirect = chrome.identity.getRedirectURL('cb');
  const authorizeUrl = await getConnectAuthorizeUrl(accessToken, provider, finalRedirect);
  return { authorizeUrl };
}

/**
 * AuthCore `GET /v1/user/social-accounts` を叩いて、ログイン中ユーザーに紐づく
 * 連携済み social account 一覧を popup に返す。`display_name` を含む。
 */
export async function handleGetSocialAccounts(): Promise<{ accounts: SocialAccount[] }> {
  const accessToken = await ensureAccessToken();
  const response = await getSocialAccounts(accessToken);
  return { accounts: response.accounts };
}
