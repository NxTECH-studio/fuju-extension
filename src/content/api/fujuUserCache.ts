import { AUTHCORE_BASE_URL } from '../../shared/config';

export interface FujuLookupResult {
  exists: boolean;
}

/**
 * fujuユーザー情報のキャッシュ
 */
const userCache = new Map<string, FujuLookupResult>();
const pendingRequests = new Map<string, Promise<FujuLookupResult | null>>();

/**
 * AuthCore の `/v1/users/lookup` を叩いて指定 X handle が Fuju ユーザーかを判定する。
 *
 * - 200 応答: サーバーが返した `{ exists: boolean }` をキャッシュして返す。
 * - 404 応答: 「該当ユーザーなし」とみなし `{ exists: false }` を返す（**キャッシュしない**：
 *   未登録ユーザーが後で登録した場合に検出できるよう、ネガティブ結果は都度問い合わせる）。
 * - その他のエラー / ネットワーク失敗: 結果不明として `null` を返す（キャッシュしない）。
 *
 * @param userId - X の handle（screen name）
 * @returns ルックアップ結果（キャッシュまたは API 結果）。失敗時は `null`。
 */
export async function fujuData(userId: string): Promise<FujuLookupResult | null> {
  // キャッシュから確認
  const cached = userCache.get(userId);
  if (cached) {
    console.log('キャッシュから取得:', userId);
    return cached;
  }

  // すでに同じユーザーの問い合わせが進行中なら、それを共有する
  const pendingRequest = pendingRequests.get(userId);
  if (pendingRequest) {
    console.log('進行中リクエストを共有:', userId);
    return pendingRequest;
  }

  const requestPromise = (async (): Promise<FujuLookupResult | null> => {
    try {
      const url = `${AUTHCORE_BASE_URL}/v1/users/lookup?provider=x&q=${encodeURIComponent(userId)}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      if (response.status === 404) {
        // 未登録ユーザーが後で登録される可能性があるためキャッシュしない。
        return { exists: false };
      }

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = (await response.json()) as { exists?: unknown };
      const result: FujuLookupResult = { exists: data?.exists === true };

      // 200 応答のみキャッシュする。Fuju 登録済みユーザーが解除に転じるケースは
      // 本拡張のスコープでは無視（content script は短命なので実害は小さい）。
      if (result.exists) {
        userCache.set(userId, result);
        console.log('APIから取得してキャッシュに保存:', userId, result);
      }

      return result;
    } catch (error) {
      console.error('fujuData API問い合わせエラー:', error);
      return null;
    } finally {
      pendingRequests.delete(userId);
    }
  })();

  pendingRequests.set(userId, requestPromise);
  return requestPromise;
}

/**
 * キャッシュをクリア
 */
export function clearCache(): void {
  userCache.clear();
  console.log('キャッシュをクリアしました');
}

/**
 * キャッシュサイズを取得
 */
export function getCacheSize(): number {
  return userCache.size;
}

/**
 * 進行中リクエスト数を取得
 */
export function getPendingRequestSize(): number {
  return pendingRequests.size;
}
