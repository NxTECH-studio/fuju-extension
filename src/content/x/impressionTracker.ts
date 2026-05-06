import { enqueueTelemetryEvent } from '../shared/api/telemetryQueue';

// ツイート単位の impression tracker。
// frontend repo の `useImpressionTracker.ts` をそのまま content script 用に移植。
//
// state machine:
//   idle
//     → (>=SCROLL_STOP_RATIO で SCROLL_STOP_DWELL_MS dwell) → scroll_stop 発火
//     → (>=VIEW_THRESHOLD_RATIO で VIEW_DWELL_MS dwell) → view_start 発火 → viewing
//   viewing
//     → (viewport から外れる / unobserve) → view_end 発火 → idle
//
// 同一 item に対し scroll_stop は 1 回のみ。view_end は view_start の後でしか発火しない。
// 再 entry した場合は state machine がリセットされ、新しい cycle になる。
// (Twitter は仮想化スクロールで DOM ノードが消え、戻ると別ノードとして再生成されるので、
//  trackTweet を毎回呼べば自然に新 cycle になる。)
//
// Twitter のタイムラインは `[data-testid="tweet"]` を MutationObserver で監視している
// (`x/index.ts`)。各 tweet 要素ごとに本 module の `trackTweet` を呼ぶ想定。

const VIEW_THRESHOLD_RATIO = 0.5;
const VIEW_DWELL_MS = 1_000;
const SCROLL_STOP_DWELL_MS = 500;
const SCROLL_STOP_RATIO = 0.25;

type Phase = 'idle' | 'scroll_stop_pending' | 'view_pending' | 'viewing';

interface TrackerState {
  itemId: string;
  phase: Phase;
  viewStartedAt: number | null;
  scrollStopTimer: number | null;
  viewStartTimer: number | null;
  scrollStopFired: boolean;
}

// element → 状態の WeakMap。tweet 要素が DOM から消えれば GC で自動解放される。
const states = new WeakMap<Element, TrackerState>();
let observer: IntersectionObserver | null = null;

// 重複登録防止用。dataset を使うと style 属性で何度も再評価されてしまうので、
// 単純に WeakSet で「観察済みノード」を覚える。
const observedNodes = new WeakSet<Element>();

function clearTimers(state: TrackerState): void {
  if (state.scrollStopTimer !== null) {
    globalThis.clearTimeout(state.scrollStopTimer);
    state.scrollStopTimer = null;
  }
  if (state.viewStartTimer !== null) {
    globalThis.clearTimeout(state.viewStartTimer);
    state.viewStartTimer = null;
  }
}

function fireViewEnd(state: TrackerState): void {
  if (state.viewStartedAt !== null) {
    const dur = (performance.now() - state.viewStartedAt) / 1000;
    enqueueTelemetryEvent({
      itemId: state.itemId,
      eventType: 'view_end',
      durationSeconds: dur,
      // 静止コンテンツなので completion=1.0 になるよう duration と一致させる
      // (frontend PR #10 と同じ規約)。
      positionSeconds: dur,
    });
  }
  clearTimers(state);
  state.phase = 'idle';
  state.viewStartedAt = null;
}

function onIntersect(entry: IntersectionObserverEntry): void {
  const target = entry.target;
  const state = states.get(target);
  if (!state) return;

  const ratio = entry.intersectionRatio;

  // viewport から完全に外れた / scroll-stop ratio 未満
  if (!entry.isIntersecting || ratio < SCROLL_STOP_RATIO) {
    if (state.phase === 'viewing') {
      fireViewEnd(state);
    } else {
      clearTimers(state);
      state.phase = 'idle';
    }
    return;
  }

  // 見えてはいるが view_start 閾値未満 → scroll_stop 候補
  if (ratio < VIEW_THRESHOLD_RATIO) {
    if (state.phase === 'viewing' || state.phase === 'view_pending') {
      // 視認率が落ちたので scroll-stop watchlist に戻す。
      // viewing 中だった場合は view_end を発火せず、再度上がってくれば
      // また view_pending 経由で次の view_start が立つ (新 cycle 扱い)。
      // ただし frontend と完全互換にするため、viewing→落下時は view_end 扱いにする。
      if (state.phase === 'viewing') {
        fireViewEnd(state);
      } else {
        clearTimers(state);
        state.phase = 'idle';
      }
    }
    if (
      !state.scrollStopFired &&
      state.scrollStopTimer === null &&
      state.phase === 'idle'
    ) {
      state.phase = 'scroll_stop_pending';
      state.scrollStopTimer = globalThis.setTimeout(() => {
        if (state.phase === 'scroll_stop_pending') {
          enqueueTelemetryEvent({
            itemId: state.itemId,
            eventType: 'scroll_stop',
          });
          state.scrollStopFired = true;
          state.phase = 'idle';
          state.scrollStopTimer = null;
        }
      }, SCROLL_STOP_DWELL_MS);
    }
    return;
  }

  // view_start 閾値を越えた
  if (state.scrollStopTimer !== null) {
    globalThis.clearTimeout(state.scrollStopTimer);
    state.scrollStopTimer = null;
  }
  if (state.phase === 'viewing') return; // 既にカウント中

  if (state.viewStartTimer === null) {
    state.phase = 'view_pending';
    state.viewStartTimer = globalThis.setTimeout(() => {
      if (state.phase === 'view_pending') {
        enqueueTelemetryEvent({
          itemId: state.itemId,
          eventType: 'view_start',
        });
        state.viewStartedAt = performance.now();
        state.phase = 'viewing';
        state.viewStartTimer = null;
      }
    }, VIEW_DWELL_MS);
  }
}

function ensureObserver(): IntersectionObserver {
  if (observer) return observer;
  // Multiple thresholds で scroll_stop / view_start 双方の境界で callback を受ける。
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        onIntersect(entry);
      }
    },
    {
      threshold: [SCROLL_STOP_RATIO, VIEW_THRESHOLD_RATIO],
    },
  );
  return observer;
}

/**
 * 1 ツイート要素を tracker に登録する。
 *
 * - 同一ノードを 2 回呼んでも no-op (WeakSet で抑止)。
 * - tweet 要素が DOM から消えると IntersectionObserver は isIntersecting=false で
 *   1 回 callback を呼び、viewing なら view_end が走る。
 *   その後 GC で WeakMap / WeakSet 共に解放される。
 */
export function trackTweet(element: Element, itemId: string): void {
  if (!itemId) return;
  if (observedNodes.has(element)) return;
  observedNodes.add(element);
  states.set(element, {
    itemId,
    phase: 'idle',
    viewStartedAt: null,
    scrollStopTimer: null,
    viewStartTimer: null,
    scrollStopFired: false,
  });
  ensureObserver().observe(element);
}

/**
 * 主にテスト / 拡張機能 unload 時の cleanup 用。通常運用では呼ばない。
 */
export function disconnectTracker(): void {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
}
