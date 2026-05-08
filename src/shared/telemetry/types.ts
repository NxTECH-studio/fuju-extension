// fuju-emotion-model `/v1/{tenant}/events` のフロント側 telemetry 型。
// frontend repo の RFC-LT-003 / docs/sns_log_contract.md §5 と同じ event 名を踏襲する。
//
// content script で発火し、background が user_id を stamp してモデルへ POST する。
// hooks (like / follow / comment) は SNS-backend の commit hook が emit する想定で、
// 拡張側は scroll / view stream のみを担当する。

// frontend と互換の event_type 定数。`rewind` は将来拡張のため列挙だけ残す。
export type FrontendEventType = 'view_start' | 'view_end' | 'scroll_stop' | 'rewind';

// content script が enqueue する「user_id 未 stamp」のイベント。
// timestamp はイベント発生時刻 (flush 時刻ではない) を ISO 8601 UTC で持つ。
export interface ContentTelemetryEvent {
  itemId: string;
  eventType: FrontendEventType;
  timestamp: string;
  durationSeconds?: number;
  positionSeconds?: number;
  metadata?: Record<string, unknown>;
}

// fuju-emotion-model が受け取る POST body の 1 件分。
// `user_id` は AuthCore sub。background が auth state からスタンプする。
export interface MeEventInput {
  user_id: string;
  item_id: string;
  event_type: FrontendEventType;
  timestamp: string;
  duration_seconds?: number;
  position_seconds?: number;
  metadata?: Record<string, unknown>;
}

export interface MeEventsBatch {
  events: MeEventInput[];
}

export interface MeEventsResponse {
  accepted: number;
}

// content → background メッセージ payload。flush 単位で 1 batch を送る。
export interface TelemetrySendEventsPayload {
  events: ContentTelemetryEvent[];
}

// background → content の応答。`accepted=0` は「未認証で drop した」ケースを含む。
export interface TelemetrySendEventsResponseData {
  accepted: number;
  // 未認証 / refresh 失敗で drop した場合は true。content 側はそのときの batch を捨てる。
  dropped: boolean;
}
