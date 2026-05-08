import { useState } from 'react';
import type { FormEvent } from 'react';
import { AuthErrorCode } from '../../shared/auth/errors';
import type { AuthErrorPayload } from '../../shared/auth/messages';
import { useAuth } from './useAuth';

const TOTP_PATTERN = /^[0-9]{6}$/;

function formatMfaError(error: AuthErrorPayload | null): string | null {
  if (!error) {
    return null;
  }
  switch (error.code) {
    case AuthErrorCode.INVALID_TOTP:
      return 'コードが正しくありません。';
    case AuthErrorCode.PRE_TOKEN_EXPIRED:
      return 'セッションが期限切れになりました。最初からやり直してください。';
    case AuthErrorCode.PRE_TOKEN_INVALID:
      return 'セッションが無効です。最初からやり直してください。';
    case AuthErrorCode.MFA_NOT_PENDING:
      return 'セッションが見つかりません。最初からやり直してください。';
    case AuthErrorCode.RATE_LIMIT_EXCEEDED:
      return 'リクエストが多すぎます。しばらく経ってから再試行してください。';
    case AuthErrorCode.NETWORK_ERROR:
      return 'AuthCore に接続できません。サーバーの起動と URL を確認してください。';
    default:
      return error.message || 'MFA の検証に失敗しました。';
  }
}

export function MfaForm() {
  const { verifyMfa, cancelMfa, loading, error, clearError } = useAuth();
  const [code, setCode] = useState('');

  const message = formatMfaError(error);
  const isValid = TOTP_PATTERN.test(code);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isValid) {
      return;
    }
    await verifyMfa({ code });
  };

  const onCancel = async () => {
    await cancelMfa();
  };

  return (
    <form className="auth-form mfa-form" onSubmit={onSubmit}>
      <h1>多要素認証</h1>
      <p className="auth-hint">認証アプリに表示されている 6 桁のコードを入力してください。</p>
      <label className="auth-field">
        <span>認証コード</span>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          value={code}
          onChange={(event) => {
            const next = event.target.value.replace(/[^0-9]/g, '').slice(0, 6);
            setCode(next);
            if (error) clearError();
          }}
          required
          autoFocus
        />
      </label>
      {message && (
        <p className="auth-error" role="alert">
          {message}
        </p>
      )}
      <button type="submit" className="auth-submit" disabled={loading || !isValid}>
        {loading ? '確認中…' : '確認'}
      </button>
      <button
        type="button"
        className="auth-secondary"
        onClick={() => {
          void onCancel();
        }}
        disabled={loading}
      >
        キャンセル
      </button>
    </form>
  );
}
