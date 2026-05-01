/**
 * fujuユーザー情報のキャッシュ
 */
const userCache = new Map<string, string>();
const pendingRequests = new Map<string, Promise<string | null>>();

/**
 * APIからfujuユーザー情報を取得する
 * @param userId - ユーザーID
 * @returns ユーザー情報 (キャッシュまたはAPI結果)
 */
export async function fujuData(userId: string): Promise<string | null> {
  // キャッシュから確認
  if (userCache.has(userId)) {
    console.log('キャッシュから取得:', userId);
    return userCache.get(userId) ?? null;
  }

  // すでに同じユーザーの問い合わせが進行中なら、それを共有する
  const pendingRequest = pendingRequests.get(userId);
  if (pendingRequest) {
    console.log('進行中リクエストを共有:', userId);
    return pendingRequest;
  }

  const requestPromise = (async () => {
    try {
      // APIに問い合わせ
      const response = await fetch(`/api/fuju-user/${userId}`);

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();

      // キャッシュに保存
      userCache.set(userId, data);
      console.log('APIから取得してキャッシュに保存:', userId);

      return data;
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
