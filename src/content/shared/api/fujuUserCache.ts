import { AuthMessageType } from '../../../shared/auth/messages';
import type {
  AuthResponse,
  FujuUserLookupPayload,
  FujuUserLookupResponseData,
} from '../../../shared/auth/messages';

export interface FujuLookupResult {
  exists: boolean;
}

export type FujuLookupProvider = FujuUserLookupPayload['provider'];

/**
 * fuju ユーザー情報のキャッシュ。
 *
 * X の handle と YouTube の handle / channel ID は名前空間が異なるため、
 * キャッシュキーは `${provider}:${q}` で構築して衝突を防ぐ。
 */
const userCache = new Map<string, FujuLookupResult>();
const pendingRequests = new Map<string, Promise<FujuLookupResult | null>>();

function makeCacheKey(provider: FujuLookupProvider, q: string): string {
  return `${provider}:${q}`;
}

function sendLookup(
  provider: FujuLookupProvider,
  q: string,
): Promise<FujuUserLookupResponseData> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: AuthMessageType.FUJU_USER_LOOKUP, payload: { provider, q } },
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
export async function fujuData(
  provider: FujuLookupProvider,
  q: string,
): Promise<FujuLookupResult | null> {
  const key = makeCacheKey(provider, q);
  const cached = userCache.get(key);
  if (cached) {
    return cached;
  }

  const pendingRequest = pendingRequests.get(key);
  if (pendingRequest) {
    return pendingRequest;
  }

  const requestPromise = (async (): Promise<FujuLookupResult | null> => {
    try {
      const data = await sendLookup(provider, q);
      if (data === null) {
        return null;
      }
      const result: FujuLookupResult = { exists: data.exists === true };
      if (result.exists) {
        userCache.set(key, result);
      }
      return result;
    } finally {
      pendingRequests.delete(key);
    }
  })();

  pendingRequests.set(key, requestPromise);
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
