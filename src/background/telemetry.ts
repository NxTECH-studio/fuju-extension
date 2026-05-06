import { FUJU_MODEL_BASE_URL, FUJU_MODEL_TENANT_ID } from '../shared/config';
import { AuthCoreApiError, AuthErrorCode } from '../shared/auth/errors';
import { ensureAccessToken, refreshTokens } from './auth-manager';
import { getAuthState } from '../shared/auth/storage';
import type {
  ContentTelemetryEvent,
  MeEventInput,
  MeEventsResponse,
  TelemetrySendEventsResponseData,
} from '../shared/telemetry/types';

// fuju-emotion-model `/v1/{tenant}/events` 直送ハンドラ。
//
// content script は user 認証情報を持たないため、background が:
//   1. auth state から `user.id` (AuthCore sub) を取り出して各 event に stamp
//   2. ensureAccessToken() で Bearer を付与
//   3. 直接 fuju-emotion-model に POST する (SNS-backend は経由しない)
//
// 未認証 / refresh 失敗時は `dropped: true` を返し、content 側はそのバッチを捨てる
// (再送はしない)。AuthCore Bearer に紐づかないイベントを後追いで送る道は無いので、
// 認証されていない期間の telemetry はそもそも収集しないという設計を選ぶ。

function buildEndpoint(): string {
  // tenant 値は env 由来で外部入力ではないが、念のため encodeURIComponent しておく。
  return `${FUJU_MODEL_BASE_URL}/v1/${encodeURIComponent(FUJU_MODEL_TENANT_ID)}/events`;
}

function toModelEvent(userId: string, event: ContentTelemetryEvent): MeEventInput {
  return {
    user_id: userId,
    item_id: event.itemId,
    event_type: event.eventType,
    timestamp: event.timestamp,
    duration_seconds: event.durationSeconds,
    position_seconds: event.positionSeconds,
    metadata: event.metadata,
  };
}

export async function handleTelemetrySendEvents(
  events: ContentTelemetryEvent[],
): Promise<TelemetrySendEventsResponseData> {
  if (events.length === 0) {
    return { accepted: 0, dropped: false };
  }

  const state = await getAuthState();
  const userId = state.user?.id;
  if (!userId) {
    // 未ログイン状態。content 側は drop する (queue を肥大化させない)。
    return { accepted: 0, dropped: true };
  }

  let accessToken: string;
  try {
    accessToken = await ensureAccessToken();
  } catch (error) {
    // refresh 失敗。これも drop。auth-manager 側で clearAll が走って再ログインが要求される。
    if (error instanceof AuthCoreApiError) {
      return { accepted: 0, dropped: true };
    }
    throw error;
  }

  const body = { events: events.map((e) => toModelEvent(userId, e)) };

  let response: Response;
  try {
    response = await fetch(buildEndpoint(), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
      credentials: 'omit',
    });
  } catch (error) {
    // ネットワーク失敗。telemetry は best-effort なので throw しない。
    // content 側で再送するとオフライン中に queue が膨れるので、ここでも drop する。
    const message = error instanceof Error ? error.message : 'network error';
    console.warn('[telemetry] POST failed:', message);
    return { accepted: 0, dropped: true };
  }

  if (response.status === 401) {
    // mid-flight で revoke された可能性。1 回だけ refresh して retry。
    try {
      const refreshed = await refreshTokens();
      response = await fetch(buildEndpoint(), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${refreshed.access_token}`,
        },
        body: JSON.stringify(body),
        credentials: 'omit',
      });
    } catch (error) {
      const code = error instanceof AuthCoreApiError ? error.code : AuthErrorCode.NETWORK_ERROR;
      console.warn('[telemetry] retry after 401 failed:', code);
      return { accepted: 0, dropped: true };
    }
  }

  if (!response.ok) {
    // 4xx/5xx。再送ループを避けるため drop=true で content 側に確定 ack を返す。
    console.warn('[telemetry] non-2xx response:', response.status);
    return { accepted: 0, dropped: true };
  }

  let parsed: MeEventsResponse | null = null;
  try {
    const text = await response.text();
    parsed = text ? (JSON.parse(text) as MeEventsResponse) : null;
  } catch {
    parsed = null;
  }
  const accepted = typeof parsed?.accepted === 'number' ? parsed.accepted : events.length;
  return { accepted, dropped: false };
}
