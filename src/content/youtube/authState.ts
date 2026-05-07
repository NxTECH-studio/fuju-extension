/**
 * content script から Fuju 拡張の auth state を取得・監視するユーティリティ。
 *
 * popup 側 `AuthProvider.tsx` と同じパターン
 * (`AuthMessageType.GET_STATE` での初期取得 + `chrome.storage.onChanged` 監視) を
 * content script 用に薄くラップしたもの。
 */

import { AuthMessageType } from '../../shared/auth/messages';
import type { AuthResponse, GetStateResponseData } from '../../shared/auth/messages';
import { STORAGE_KEYS } from '../../shared/auth/storage';

export interface ContentAuthState {
  isAuthenticated: boolean;
}

const FALLBACK_STATE: ContentAuthState = { isAuthenticated: false };

function sendGetState(): Promise<AuthResponse<GetStateResponseData> | null> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: AuthMessageType.GET_STATE },
      (response: AuthResponse<GetStateResponseData> | undefined) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          // background に到達できない / receiver なし。auth state は不明扱い。
          resolve(null);
          return;
        }
        resolve(response ?? null);
      },
    );
  });
}

/**
 * 現在の auth state を background から取得する。
 * 失敗時は `{ isAuthenticated: false }` を返す (= 表示条件は満たさないと解釈)。
 */
export async function getAuthState(): Promise<ContentAuthState> {
  try {
    const response = await sendGetState();
    if (!response || !response.ok) {
      return FALLBACK_STATE;
    }
    return { isAuthenticated: response.data.isAuthenticated };
  } catch {
    return FALLBACK_STATE;
  }
}

/**
 * `chrome.storage.local` の auth 永続値変化を監視し、変化があれば最新の
 * auth state を fetch して `handler` に渡す。戻り値は登録解除関数。
 *
 * `accessTokenExp` はトークンリフレッシュのたびに更新されるが、それだけでは
 * ログイン/ログアウト状態は変わらないので listen 対象外とする
 * (popup 側 `AuthProvider.tsx` と同じ挙動)。
 */
export function onAuthStateChange(handler: (state: ContentAuthState) => void): () => void {
  const watched: string[] = [STORAGE_KEYS.accessToken, STORAGE_KEYS.user];
  const listener = (
    changes: { [key: string]: chrome.storage.StorageChange },
    areaName: string,
  ): void => {
    if (areaName !== 'local') return;
    if (!watched.some((key) => key in changes)) return;
    void getAuthState().then(handler);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => {
    chrome.storage.onChanged.removeListener(listener);
  };
}
