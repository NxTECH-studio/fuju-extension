/**
 * YouTube SPA の遷移検知ユーティリティ。
 *
 * `yt-navigate-finish` カスタムイベントが事実上の主経路だが将来削除されるリスクがあるため、
 * `pushState` / `replaceState` の patch + `popstate` + URL polling を組み合わせて多重防御する。
 */

const PATCH_FLAG = '__fujuYoutubeHistoryPatched';

interface PatchedWindow extends Window {
  [PATCH_FLAG]?: boolean;
}

function patchHistoryOnce(): void {
  const w = window as PatchedWindow;
  if (w[PATCH_FLAG]) return;
  w[PATCH_FLAG] = true;

  const origPushState = history.pushState.bind(history);
  const origReplaceState = history.replaceState.bind(history);

  history.pushState = function patchedPushState(
    ...args: Parameters<typeof history.pushState>
  ): void {
    origPushState(...args);
    window.dispatchEvent(new Event('fuju:locationchange'));
  };
  history.replaceState = function patchedReplaceState(
    ...args: Parameters<typeof history.replaceState>
  ): void {
    origReplaceState(...args);
    window.dispatchEvent(new Event('fuju:locationchange'));
  };
}

/**
 * 「現在閲覧中のチャンネルが変わった可能性がある」タイミングで `handler` を呼ぶ。
 * 戻り値は登録解除関数。
 */
export function onChannelContextChange(handler: () => void): () => void {
  patchHistoryOnce();

  const ytNavigate = () => handler();
  const popstate = () => handler();
  const locationChange = () => handler();

  document.addEventListener('yt-navigate-finish', ytNavigate);
  window.addEventListener('popstate', popstate);
  window.addEventListener('fuju:locationchange', locationChange);

  // 最終保険: URL polling。pushState patch が何らかの理由で動かないケースを救う。
  let lastHref = location.href;
  const intervalId = window.setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      handler();
    }
  }, 500);

  return () => {
    document.removeEventListener('yt-navigate-finish', ytNavigate);
    window.removeEventListener('popstate', popstate);
    window.removeEventListener('fuju:locationchange', locationChange);
    window.clearInterval(intervalId);
  };
}
