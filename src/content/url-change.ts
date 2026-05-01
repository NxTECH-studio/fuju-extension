type HistoryStateMethod = 'pushState' | 'replaceState';

const WRAPPED = Symbol.for('fuju.url-change.wrapped');

type WrappedFn = History[HistoryStateMethod] & { [WRAPPED]?: true };

/**
 * SPA の URL 変化を検知するためのユーティリティ。
 * `history.pushState` / `history.replaceState` のラップ、`popstate`、`hashchange` を購読する。
 *
 * 戻り値はクリーンアップ関数 (リスナ解除 + 自身がラップしたメソッドのみ復元)。
 * 二重呼び出しは無視され、最初の登録だけが有効になる。
 */
export function onUrlChange(handler: () => void): () => void {
  const current = history.pushState as WrappedFn;
  if (current[WRAPPED]) {
    return () => undefined;
  }

  const wrap = (key: HistoryStateMethod) => {
    const original = history[key];
    const wrapped = function (this: History, ...args: Parameters<typeof original>) {
      const result = original.apply(this, args);
      queueMicrotask(handler);
      return result;
    } as WrappedFn;
    wrapped[WRAPPED] = true;
    history[key] = wrapped;
    return { original, wrapped };
  };

  const push = wrap('pushState');
  const replace = wrap('replaceState');
  const popHandler = () => handler();
  window.addEventListener('popstate', popHandler);
  window.addEventListener('hashchange', popHandler);

  return () => {
    if (history.pushState === push.wrapped) {
      history.pushState = push.original;
    }
    if (history.replaceState === replace.wrapped) {
      history.replaceState = replace.original;
    }
    window.removeEventListener('popstate', popHandler);
    window.removeEventListener('hashchange', popHandler);
  };
}
