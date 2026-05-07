import { AuthCoreApiError } from '../shared/auth/errors';
import { authenticatedFetch } from './auth-manager';

export type FujuLookupResult = { exists: boolean } | null;

export interface LookupFujuUserParams {
  provider: 'x' | 'youtube';
  // x: handle (screen name) / youtube: handle (`mrbeast`) または channel ID (`UC…`)。
  // サーバ側で normalize されるため、ここでは生文字列を渡す。
  q: string;
}

/**
 * AuthCore の `/v1/users/lookup?provider=<provider>&q=<q>` を叩いて Fuju 登録ユーザーかを判定する。
 *
 * - 200: サーバーが返した `{ exists: boolean }` をそのまま返す。
 * - 404: 該当なしと解釈して `{ exists: false }` を返す。
 * - 401 / 認証なし / ネットワーク失敗: `null` (結果不明) を返す。content script は薄表示などにフォールバックする。
 */
export async function lookupFujuUser({
  provider,
  q,
}: LookupFujuUserParams): Promise<FujuLookupResult> {
  if (!q) {
    return { exists: false };
  }
  const path = `/v1/users/lookup?provider=${encodeURIComponent(provider)}&q=${encodeURIComponent(q)}`;
  let result: Awaited<ReturnType<typeof authenticatedFetch>>;
  try {
    result = await authenticatedFetch(path);
  } catch (error) {
    if (error instanceof AuthCoreApiError) {
      // 未ログイン / refresh 失敗。content script は登録判定なしで進める。
      return null;
    }
    throw error;
  }
  if (result.status === 404) {
    return { exists: false };
  }
  if (!result.ok) {
    return null;
  }
  const body = result.body as { exists?: unknown } | null;
  return { exists: body?.exists === true };
}
