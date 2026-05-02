import { AuthCoreApiError } from '../shared/auth/errors';
import { authenticatedFetch } from './auth-manager';

export type FujuLookupResult = { exists: boolean } | null;

/**
 * AuthCore の `/v1/users/lookup?provider=x&q=<userId>` を叩いて Fuju 登録ユーザーかを判定する。
 *
 * - 200: サーバーが返した `{ exists: boolean }` をそのまま返す。
 * - 404: 該当なしと解釈して `{ exists: false }` を返す。
 * - 401 / 認証なし / ネットワーク失敗: `null` (結果不明) を返す。content script は薄表示などにフォールバックする。
 */
export async function lookupFujuUser(userId: string): Promise<FujuLookupResult> {
  if (!userId) {
    return { exists: false };
  }
  const path = `/v1/users/lookup?provider=x&q=${encodeURIComponent(userId)}`;
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
