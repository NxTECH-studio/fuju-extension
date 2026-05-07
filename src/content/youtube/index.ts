import { fujuData } from '../shared/api/fujuUserCache';
import type { FujuLookupResult } from '../shared/api/fujuUserCache';
import { getAuthState, onAuthStateChange } from './authState';
import { extractCurrentChannel } from './channelIdentifier';
import type { ChannelIdentifier } from './channelIdentifier';
import { ensureFujuButton, removeAllFujuButtons } from './fujuButton';
import { onChannelContextChange } from './navigation';

console.log('[content/youtube] loaded on', location.href);

// DOM hydration 待ちの再試行回数 / 間隔。
// `/watch` の owner 行は遅延描画されるため、scan のたびに少し粘る。
const SCAN_RETRY_LIMIT = 20;
const SCAN_RETRY_INTERVAL_MS = 250;

/**
 * lookup の `q` を identifier から決定する。
 * handle 優先 / channel ID fallback (planner 推奨案 b)。
 */
function pickLookupQ(ident: ChannelIdentifier): string | null {
  if (ident.handle) return ident.handle;
  if (ident.channelId) return ident.channelId;
  return null;
}

const youtube = () => {
  // 直前に lookup したキー (`<q>`)。同一 identifier への重複呼び出しを防ぐ。
  let lastLookupKey: string | null = null;
  // 進行中の retry を中断するための世代カウンタ。
  let scanGeneration = 0;

  // 表示条件評価用の最新スナップショット。
  // auth state の変化 / lookup 結果の到着 / SPA 遷移の各タイミングで更新する。
  let currentAuth = false;
  let currentQ: string | null = null;
  let currentLookup: FujuLookupResult | null = null;

  const evaluateAndApply = (): void => {
    const shouldShow = currentAuth && currentLookup?.exists === true;
    ensureFujuButton({ shouldShow, q: currentQ });
  };

  const runLookup = async (ident: ChannelIdentifier): Promise<void> => {
    const q = pickLookupQ(ident);
    if (!q) return;
    if (lastLookupKey === q) return;
    lastLookupKey = q;

    // 新しい q に切り替わった瞬間は古い lookup を捨てる。
    // ここで非表示に倒しておくと、新 lookup が遅延しても古い結果でボタンが残らない。
    currentQ = q;
    currentLookup = null;
    evaluateAndApply();

    const generation = scanGeneration;
    const result = await fujuData('youtube', q);
    // lookup 解決中に SPA 遷移が走っていたら結果を破棄する。
    if (generation !== scanGeneration) return;
    if (lastLookupKey !== q) return;

    const exists = result === null ? null : result.exists;
    console.log('[fuju/youtube] lookup', { provider: 'youtube', q, exists });

    currentLookup = result;
    evaluateAndApply();
  };

  const scan = (): void => {
    const generation = ++scanGeneration;
    let attempts = 0;

    const tryExtract = (): void => {
      // 別のナビゲーションが走ったらこの retry chain は中断する。
      if (generation !== scanGeneration) return;

      const ident = extractCurrentChannel();
      if (ident && (ident.handle || ident.channelId)) {
        void runLookup(ident);
        return;
      }
      attempts += 1;
      if (attempts >= SCAN_RETRY_LIMIT) return;
      window.setTimeout(tryExtract, SCAN_RETRY_INTERVAL_MS);
    };

    tryExtract();
  };

  const onNavigate = (): void => {
    // 遷移したら直前の lookup キーをリセットし、ボタンも一旦消す。
    lastLookupKey = null;
    currentQ = null;
    currentLookup = null;
    removeAllFujuButtons();
    scan();
  };

  const startObserver = (): MutationObserver => {
    // owner 行が hydration するまで body の subtree を観察し、scan を再走させる。
    let scheduled = false;
    const observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        const ident = extractCurrentChannel();
        if (ident && (ident.handle || ident.channelId)) {
          void runLookup(ident);
        }
        // subscribe host が遅れて hydration するケース、collab で host が
        // 後追いで増えるケースに備え、最新条件でボタン挿入を再評価する。
        evaluateAndApply();
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return observer;
  };

  const start = (): (() => void) => {
    void getAuthState().then((state) => {
      currentAuth = state.isAuthenticated;
      evaluateAndApply();
    });
    const unsubscribeAuth = onAuthStateChange((state) => {
      currentAuth = state.isAuthenticated;
      evaluateAndApply();
    });

    scan();
    const unsubscribeNav = onChannelContextChange(onNavigate);
    const observer = startObserver();
    return () => {
      unsubscribeAuth();
      unsubscribeNav();
      observer.disconnect();
      removeAllFujuButtons();
    };
  };

  if (document.body) {
    return start();
  }
  let teardown: (() => void) | null = null;
  globalThis.addEventListener(
    'DOMContentLoaded',
    () => {
      teardown = start();
    },
    { once: true },
  );
  return () => {
    teardown?.();
  };
};

youtube();
