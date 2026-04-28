import { useState } from 'react';
import type { FormEvent } from 'react';
import { AuthErrorCode } from '../../shared/auth/errors';
import type { AuthErrorPayload } from '../../shared/auth/messages';
import { useAuth } from './useAuth';

function formatError(error: AuthErrorPayload | null): string | null {
  if (!error) {
    return null;
  }
  switch (error.code) {
    case AuthErrorCode.INVALID_CREDENTIALS:
      return 'メールアドレス／公開ID、またはパスワードが正しくありません。';
    case AuthErrorCode.ACCOUNT_LOCKED:
      return 'アカウントが一時的にロックされています。時間をおいて再度お試しください。';
    case AuthErrorCode.RATE_LIMIT_EXCEEDED:
      return 'リクエストが多すぎます。しばらく経ってから再試行してください。';
    case AuthErrorCode.MFA_NOT_SUPPORTED:
      return 'このアカウントは多要素認証（MFA）が有効です。現バージョンでは未対応です。';
    case AuthErrorCode.MISSING_REQUIRED_FIELD:
    case AuthErrorCode.INVALID_REQUEST:
      return '入力内容を確認してください。';
    case AuthErrorCode.NETWORK_ERROR:
      return 'AuthCore に接続できません。サーバーの起動と URL を確認してください。';
    default:
      return error.message || 'ログインに失敗しました。';
  }
}

export function LoginForm() {
  const { login, loading, error, clearError } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');

  const message = formatError(error);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!identifier || !password) {
      return;
    }
    await login({ identifier, password });
  };

  return (
    <form className="auth-form" onSubmit={onSubmit}>
      <h1>ログイン</h1>
      <label className="auth-field">
        <span>メールアドレス または 公開ID</span>
        <input
          type="text"
          autoComplete="username"
          value={identifier}
          onChange={(event) => {
            setIdentifier(event.target.value);
            if (error) clearError();
          }}
          required
        />
      </label>
      <label className="auth-field">
        <span>パスワード</span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            if (error) clearError();
          }}
          required
        />
      </label>
      {message && (
        <p className="auth-error" role="alert">
          {message}
        </p>
      )}
      <button type="submit" className="auth-submit" disabled={loading}>
        {loading ? 'ログイン中…' : 'ログイン'}
      </button>
    </form>
  );
}
