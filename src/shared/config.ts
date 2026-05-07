const DEFAULT_AUTHCORE_BASE_URL = 'http://localhost:8080';
const DEFAULT_FUJU_MODEL_BASE_URL = 'http://localhost:9090';
const DEFAULT_FUJU_MODEL_TENANT_ID = 'sns_a';

function readEnv(key: string, fallback: string): string {
  const value = (import.meta.env as Record<string, string | undefined>)[key];
  if (typeof value === 'string' && value.length > 0) {
    return value.replace(/\/$/, '');
  }
  return fallback;
}

export const AUTHCORE_BASE_URL = readEnv('VITE_AUTHCORE_BASE_URL', DEFAULT_AUTHCORE_BASE_URL);

// fuju-emotion-model 直送用 base URL。telemetry batch を `/v1/{tenant}/events` へ POST する。
// SNS-backend は経由しない (frontend PR #10 と同方針)。未設定なら開発用 localhost にフォールバック。
export const FUJU_MODEL_BASE_URL = readEnv('VITE_FUJU_MODEL_BASE_URL', DEFAULT_FUJU_MODEL_BASE_URL);

// model テナント ID。`sns_a` は SNS_A サービス向けの固定キー。
export const FUJU_MODEL_TENANT_ID = readEnv(
  'VITE_FUJU_MODEL_TENANT_ID',
  DEFAULT_FUJU_MODEL_TENANT_ID,
);
