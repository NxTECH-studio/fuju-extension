import { AuthMessageType } from '../../../shared/auth/messages';
import type { AuthResponse, FujuUserLookupResponseData } from '../../../shared/auth/messages';

export interface FujuLookupResult {
  exists: boolean;
}

/**
 * fujuユーザー情報のキャッシュ
 */
const userCache = new Map<string, FujuLookupResult>();
const pendingRequests = new Map<string, Promise<FujuLookupResult | null>>();

function sendLookup(userId: string): Promise<FujuUserLookupResponseData> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: AuthMessageType.FUJU_USER_LOOKUP, payload: { userId } },
      (response: AuthResponse<FujuUserLookupResponseData> | undefined) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          console.warn('[fuju] lookup message failed:', lastError.message);
          resolve(null);
          return;
        }
        if (!response || !response.ok) {
          resolve(null);
          return;
        }
        resolve(response.data);
      },
    );
  });
}

/**
 * Fuju ユーザー判定を background 経由で行う。
 *
 * `/v1/users/lookup` は Bearer auth が必須なので content script から直接 fetch できない。
 * background が `authenticatedFetch` 経由で access token を付与して呼び出す。
 *
 * - 200 + `{ exists: true }`: Fuju 登録ユーザー。キャッシュする。
 * - 200 + `{ exists: false }` / 404: 未登録。キャッシュしない（後で登録される可能性あり）。
 * - 401 / 未ログイン / ネットワーク失敗: `null` (結果不明)。キャッシュしない。
 */
export async function fujuData(userId: string): Promise<FujuLookupResult | null> {
  const cached = userCache.get(userId);
  if (cached) {
    return cached;
  }

  const pendingRequest = pendingRequests.get(userId);
  if (pendingRequest) {
    return pendingRequest;
  }

  const requestPromise = (async (): Promise<FujuLookupResult | null> => {
    try {
      const data = await sendLookup(userId);
      if (data === null) {
        return null;
      }
      const result: FujuLookupResult = { exists: data.exists === true };
      if (result.exists) {
        userCache.set(userId, result);
      }
      return result;
    } finally {
      pendingRequests.delete(userId);
    }
  })();

  pendingRequests.set(userId, requestPromise);
  return requestPromise;
}

export function clearCache(): void {
  userCache.clear();
}

export function getCacheSize(): number {
  return userCache.size;
}

export function getPendingRequestSize(): number {
  return pendingRequests.size;
}
