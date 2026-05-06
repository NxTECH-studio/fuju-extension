import { AuthMessageType } from '../../shared/auth/messages';
import type {
  AuthResponse,
  TelemetrySendEventsResponseData,
} from '../../shared/auth/messages';
import type {
  ContentTelemetryEvent,
  FrontendEventType,
} from '../../shared/telemetry/types';

// content script 側 telemetry batcher。
//
// frontend repo の `services/telemetry.ts` の TelemetryBatcher と同じポリシー:
//   * BATCH_SIZE で即時 flush (≒ 1 画面分の card)
//   * FLUSH_INTERVAL_MS の周期 flush
//   * QUEUE_CAP で古いイベントから drop
//   * visibilitychange / pagehide で同期 flush
//
// 拡張側では fetch を直接行わず、`chrome.runtime.sendMessage` で background に渡す。
// background が user_id を stamp し AuthCore Bearer を付けて fuju-emotion-model に送る。
//
// 失敗時の再送はしない (best-effort)。長時間オフラインで queue が膨れた場合は
// QUEUE_CAP で古いイベントから捨てる。

const BATCH_SIZE = 32;
const FLUSH_INTERVAL_MS = 5_000;
const QUEUE_CAP = BATCH_SIZE * 8;

export interface TelemetryInput {
  itemId: string;
  eventType: FrontendEventType;
  durationSeconds?: number;
  positionSeconds?: number;
  metadata?: Record<string, unknown>;
}

const queue: ContentTelemetryEvent[] = [];
let flushing = false;
let intervalHandle: number | null = null;
let listenersInstalled = false;

function nowIso(): string {
  return new Date().toISOString();
}

function ensureBackgroundDriver(): void {
  if (intervalHandle === null) {
    intervalHandle = globalThis.setInterval(() => {
      void flush();
    }, FLUSH_INTERVAL_MS);
  }
  if (listenersInstalled) return;
  listenersInstalled = true;
  // タブ閉じ / 背面遷移で取りこぼさない最後の保険。MV3 content script は
  // navigator.sendBeacon を直接モデルへは送れない (CORS / Bearer)。
  // background へ sendMessage するだけでも extension worker 側でリクエストは継続する。
  const onHide = (): void => {
    void flush();
  };
  document.addEventListener('visibilitychange', onHide);
  globalThis.addEventListener('pagehide', onHide);
}

export function enqueueTelemetryEvent(event: TelemetryInput): void {
  ensureBackgroundDriver();
  if (queue.length >= QUEUE_CAP) {
    queue.shift();
    console.warn('[fuju] telemetry queue full, dropped oldest event');
  }
  queue.push({
    itemId: event.itemId,
    eventType: event.eventType,
    timestamp: nowIso(),
    durationSeconds: event.durationSeconds,
    positionSeconds: event.positionSeconds,
    metadata: event.metadata,
  });
  if (queue.length >= BATCH_SIZE) {
    void flush();
  }
}

function sendBatch(
  events: ContentTelemetryEvent[],
): Promise<TelemetrySendEventsResponseData | null> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: AuthMessageType.TELEMETRY_SEND_EVENTS,
        payload: { events },
      },
      (response: AuthResponse<TelemetrySendEventsResponseData> | undefined) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          console.warn('[fuju] telemetry sendMessage failed:', lastError.message);
          resolve(null);
          return;
        }
        if (!response || !response.ok) {
          resolve(null);
          return;
        }
        resolve(response.data);
      },
    );
  });
}

export async function flush(): Promise<void> {
  if (flushing) return;
  if (queue.length === 0) return;
  flushing = true;
  // 1 batch ずつ排出。送信中に新しいイベントが enqueue されてもこの batch には
  // 含まれず、次回 flush に持ち越される (BATCH_SIZE で即時 flush 側が拾う)。
  const drained = queue.splice(0, queue.length);
  try {
    const result = await sendBatch(drained);
    if (result === null) {
      // sendMessage 自体の失敗。ネットワーク切断やリスナ未登録などで、
      // 再送しても直近の状況では同じく落ちる確率が高い。queue を肥大化させない
      // ため drop する (best-effort 設計)。
      return;
    }
    // result.dropped=true (未認証 / refresh 失敗) も同様に drop。
  } finally {
    flushing = false;
  }
}

// テスト用 / 緊急停止用に export。通常の lifecycle ではタブが閉じるまで動き続ける。
export function stopTelemetryQueue(): void {
  if (intervalHandle !== null) {
    globalThis.clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
