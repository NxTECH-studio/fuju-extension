import { clearAuthState } from '../shared/auth/storage';
import { AUTHCORE_BASE_URL } from '../shared/config';
import * as authManager from './auth-manager';
import { register as registerMessageHandler } from './message-handler';

// 旧 cookie-mode で発行された refresh family は body-mode の refresh request で再利用すると
// AuthCore 側の transport 混在検知で family ごと無効化される。アップデート時に一度だけ
// storage と legacy cookie をクリアして強制再ログインを促す。
async function migrateLegacyCookieAuth(): Promise<void> {
  await clearAuthState();
  if (!chrome.cookies?.remove) {
    return;
  }
  try {
    await chrome.cookies.remove({
      url: `${AUTHCORE_BASE_URL}/v1/auth`,
      name: 'refresh_token',
    });
  } catch (error) {
    console.warn('[migration] failed to remove legacy cookie', error);
  }
}

authManager.registerAlarmHandler();
registerMessageHandler();

chrome.runtime.onInstalled.addListener(async (details) => {
  console.warn('[background] installed', details.reason);
  if (details.reason === 'update') {
    await migrateLegacyCookieAuth();
  }
  void authManager.init();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[background] START fuju extension');
  void authManager.init();
});

void authManager.init();
