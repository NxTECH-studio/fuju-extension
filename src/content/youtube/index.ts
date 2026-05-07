import { fujuData } from '../shared/api/fujuUserCache';
import { extractCurrentChannel } from './channelIdentifier';
import type { ChannelIdentifier } from './channelIdentifier';
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

  const runLookup = async (ident: ChannelIdentifier): Promise<void> => {
    const q = pickLookupQ(ident);
    if (!q) return;
    if (lastLookupKey === q) return;
    lastLookupKey = q;

    const result = await fujuData('youtube', q);
    const exists = result === null ? null : result.exists;
    console.log('[fuju/youtube] lookup', { provider: 'youtube', q, exists });
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
    // 遷移したら直前の lookup キーをリセットする。
    lastLookupKey = null;
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
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return observer;
  };

  const start = (): (() => void) => {
    scan();
    const unsubscribe = onChannelContextChange(onNavigate);
    const observer = startObserver();
    return () => {
      unsubscribe();
      observer.disconnect();
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
