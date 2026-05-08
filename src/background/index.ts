import { clearAuthState } from '../shared/auth/storage';
import { AUTHCORE_BASE_URL } from '../shared/config';
import * as authManager from './auth-manager';
import { register as registerMessageHandler } from './message-handler';

const REFRESH_ALARM_NAME = 'auth.refresh';
const BODY_MODE_MIGRATION_FLAG = 'auth.bodyModeMigrated';

// 旧 cookie-mode で発行された refresh family は body-mode の refresh request で再利用すると
// AuthCore 側の transport 混在検知で family ごと無効化される。body-mode 切り替え後の初回
// アップデートで一度だけ storage と legacy cookie をクリアして強制再ログインを促す。
// フラグで gating しているため、移行後の通常アップデートでセッションが消えることはない。
async function migrateLegacyCookieAuth(): Promise<void> {
  const stored = (await chrome.storage.local.get(BODY_MODE_MIGRATION_FLAG)) as Record<
    string,
    unknown
  >;
  if (stored[BODY_MODE_MIGRATION_FLAG] === true) {
    return;
  }
  await clearAuthState();
  await chrome.alarms?.clear(REFRESH_ALARM_NAME);
  if (chrome.cookies?.remove) {
    try {
      await chrome.cookies.remove({
        url: `${AUTHCORE_BASE_URL}/v1/auth`,
        name: 'refresh_token',
      });
    } catch (error) {
      console.warn('[migration] failed to remove legacy cookie', error);
    }
  }
  await chrome.storage.local.set({ [BODY_MODE_MIGRATION_FLAG]: true });
}

authManager.registerAlarmHandler();
registerMessageHandler();

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[background] installed', details.reason);
  if (details.reason === 'update') {
    await migrateLegacyCookieAuth();
  } else if (details.reason === 'install') {
    // 新規インストール時は移行不要だが、再インストール後に再度移行が走らないようフラグを立てる。
    await chrome.storage.local.set({ [BODY_MODE_MIGRATION_FLAG]: true });
  }
  void authManager.init();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[background] START fuju extension');
  void authManager.init();
});

void authManager.init();
