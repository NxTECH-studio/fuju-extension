/**
 * YouTube subscribe ボタン横に「ふじゅ〜」ボタンを挿入する DOM 操作ユーティリティ。
 *
 * 挿入位置は subscribe ボタン (`yt-button-shape#subscribe-button-shape`) の **直後**
 * (案 A: notification toggle の前) で、`ytd-subscribe-button-renderer` を host として走査する。
 *
 * 重複挿入は `dataset.fujuButton === 'true'` をマーカーにして idempotent に弾く
 * (X 側 `userData.ts` の `dataset.inserted` と同じ思想)。
 */

const FUJU_BUTTON_MARKER = 'fujuButton';
const FUJU_BUTTON_SELECTOR = '[data-fuju-button="true"]';

const SUBSCRIBE_HOST_SELECTOR = 'ytd-subscribe-button-renderer';
const SUBSCRIBE_SHAPE_SELECTOR = 'yt-button-shape#subscribe-button-shape';

const BUTTON_LABEL = 'ふじゅ〜';

const BUTTON_BASE_STYLE = [
  'background: #FF00FF',
  'color: #FFFFFF',
  'border: none',
  'border-radius: 9999px',
  'height: 36px',
  'padding: 0 16px',
  'margin-left: 8px',
  'cursor: pointer',
  'font-family: inherit',
  'font-size: 14px',
  'font-weight: 500',
  'line-height: 36px',
  'align-self: center',
  'white-space: nowrap',
].join('; ');

export interface EnsureFujuButtonOptions {
  shouldShow: boolean;
  q: string | null;
}

function findSubscribeButtonHosts(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(SUBSCRIBE_HOST_SELECTOR));
}

function getInsertedFujuButton(host: HTMLElement): HTMLElement | null {
  return host.querySelector<HTMLElement>(FUJU_BUTTON_SELECTOR);
}

function createFujuButton(q: string | null): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset[FUJU_BUTTON_MARKER] = 'true';
  button.textContent = BUTTON_LABEL;
  button.setAttribute('aria-label', BUTTON_LABEL);
  button.style.cssText = BUTTON_BASE_STYLE;

  // 簡易 hover/focus 演出。CSS ファイル新設は避けインラインで完結させる。
  button.addEventListener('mouseenter', () => {
    button.style.opacity = '0.85';
  });
  button.addEventListener('mouseleave', () => {
    button.style.opacity = '1';
  });

  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    console.log('[fuju/youtube] fuju button clicked', { provider: 'youtube', q });
  });

  return button;
}

/**
 * subscribe ボタンの直後の sibling として「ふじゅ〜」ボタンを挿入する。
 * 既に挿入済みなら no-op。subscribe ボタンが見つからない場合 (DOM hydration 中) は skip。
 */
function insertFujuButtonInto(host: HTMLElement, q: string | null): void {
  if (getInsertedFujuButton(host)) return;

  const subscribeShape = host.querySelector<HTMLElement>(SUBSCRIBE_SHAPE_SELECTOR);
  if (!subscribeShape) return;

  const parent = subscribeShape.parentElement;
  if (!parent) return;

  const button = createFujuButton(q);
  parent.insertBefore(button, subscribeShape.nextSibling);
}

/**
 * `shouldShow` の AND 条件 (auth=true AND lookup.exists=true) に応じてボタンを挿入/除去する。
 *
 * - `shouldShow === false`: 既存のすべての Fuju ボタンを除去する。
 * - `shouldShow === true`: 全 subscribe host について、まだ挿入されていなければ挿入する
 *   (collab の secondary 行を含む全 host にメイン q を流用する簡易設計)。
 */
export function ensureFujuButton(opts: EnsureFujuButtonOptions): void {
  if (!opts.shouldShow) {
    removeAllFujuButtons();
    return;
  }
  const hosts = findSubscribeButtonHosts();
  for (const host of hosts) {
    insertFujuButtonInto(host, opts.q);
  }
}

/**
 * DOM 上の全「ふじゅ〜」ボタンを除去する。auth state または lookup 結果で
 * 表示条件が崩れたとき / teardown 時に呼ぶ。
 */
export function removeAllFujuButtons(): void {
  const buttons = document.querySelectorAll<HTMLElement>(FUJU_BUTTON_SELECTOR);
  buttons.forEach((el) => {
    el.remove();
  });
}
