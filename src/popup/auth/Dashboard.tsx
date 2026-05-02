import { useCallback, useState } from 'react';
import { AuthErrorCode } from '../../shared/auth/errors';
import { AuthMessageType } from '../../shared/auth/messages';
import type {
  AuthErrorPayload,
  AuthResponse,
  ProviderGetConnectUrlResponseData,
} from '../../shared/auth/messages';
import type { Provider } from '../../shared/auth/providers';
import { useAuth } from './useAuth';

function sendMessage<T>(message: unknown): Promise<AuthResponse<T>> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: AuthResponse<T> | undefined) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        resolve({
          ok: false,
          error: {
            code: AuthErrorCode.NETWORK_ERROR,
            message: lastError.message ?? 'Failed to reach background',
          },
        });
        return;
      }
      if (!response) {
        resolve({
          ok: false,
          error: {
            code: AuthErrorCode.INTERNAL_SERVER_ERROR,
            message: 'Empty response from background',
          },
        });
        return;
      }
      resolve(response);
    });
  });
}

function launchWebAuthFlow(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive: true }, (redirectUrl) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message ?? 'launchWebAuthFlow failed'));
        return;
      }
      if (!redirectUrl) {
        reject(new Error('No redirect URL returned from launchWebAuthFlow'));
        return;
      }
      resolve(redirectUrl);
    });
  });
}

function extractLinkResult(redirectUrl: string): { provider: string; providerUserId: string } {
  // body-mode の link フローでは AuthCore が
  // `https://<extension-id>.chromiumapp.org/cb#linked=1&provider=...&provider_user_id=...`
  // 形式の fragment にリンク結果を乗せて返す。エラー時は `#error=...` が乗る。
  const url = new URL(redirectUrl);
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
  const linked = fragment.get('linked');
  if (linked !== '1') {
    const errorCode = fragment.get('error');
    throw new Error(
      errorCode ? `Provider link failed: ${errorCode}` : 'Provider link did not complete',
    );
  }
  const provider = fragment.get('provider');
  const providerUserId = fragment.get('provider_user_id');
  if (!provider || !providerUserId) {
    throw new Error('Authorization callback fragment is missing provider info');
  }
  return { provider, providerUserId };
}

function providerLabel(provider: Provider): string {
  switch (provider) {
    case 'x':
      return 'X';
    case 'google':
      return 'Google';
    default:
      return provider;
  }
}

function formatLinkError(error: AuthErrorPayload): string {
  switch (error.code) {
    case AuthErrorCode.NETWORK_ERROR:
      return 'AuthCore に接続できません。サーバーの起動と URL を確認してください。';
    case AuthErrorCode.RATE_LIMIT_EXCEEDED:
      return 'リクエストが多すぎます。しばらく経ってから再試行してください。';
    case AuthErrorCode.TOKEN_EXPIRED:
    case AuthErrorCode.TOKEN_INVALID:
    case AuthErrorCode.TOKEN_REVOKED:
      return 'セッションが切れました。再度ログインしてください。';
    default:
      return error.message || '連携に失敗しました。';
  }
}

export function Dashboard() {
  const { user, logout, loading } = useAuth();
  const [linkingProvider, setLinkingProvider] = useState<Provider | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkSuccess, setLinkSuccess] = useState<string | null>(null);

  const handleConnect = useCallback(async (provider: Provider) => {
    setLinkingProvider(provider);
    setLinkError(null);
    setLinkSuccess(null);
    try {
      const urlResponse = await sendMessage<ProviderGetConnectUrlResponseData>({
        type: AuthMessageType.PROVIDER_GET_CONNECT_URL,
        payload: { provider },
      });
      if (!urlResponse.ok) {
        setLinkError(formatLinkError(urlResponse.error));
        return;
      }

      let redirectUrl: string;
      try {
        redirectUrl = await launchWebAuthFlow(urlResponse.data.authorizeUrl);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Authorization was cancelled';
        setLinkError(message);
        return;
      }

      try {
        extractLinkResult(redirectUrl);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid authorization callback';
        setLinkError(message);
        return;
      }

      setLinkSuccess(`${providerLabel(provider)} と連携しました。`);
    } finally {
      setLinkingProvider(null);
    }
  }, []);

  const isBusy = loading || linkingProvider !== null;

  return (
    <section className="auth-dashboard">
      <h1>ログイン中</h1>
      {user && (
        <dl className="auth-user">
          <dt>公開ID</dt>
          <dd>{user.public_id}</dd>
          <dt>メールアドレス</dt>
          <dd>{user.email}</dd>
        </dl>
      )}
      <div className="auth-provider-actions">
        <button
          type="button"
          className="auth-secondary"
          onClick={() => {
            void handleConnect('x');
          }}
          disabled={isBusy}
        >
          {linkingProvider === 'x' ? '連携中…' : 'X と連携'}
        </button>
        <button
          type="button"
          className="auth-secondary"
          onClick={() => {
            void handleConnect('google');
          }}
          disabled={isBusy}
        >
          {linkingProvider === 'google' ? '連携中…' : 'Google と連携'}
        </button>
      </div>
      {linkError && (
        <p className="auth-error" role="alert">
          {linkError}
        </p>
      )}
      {linkSuccess && (
        <p className="auth-hint" role="status">
          {linkSuccess}
        </p>
      )}
      <button
        type="button"
        className="auth-submit"
        onClick={() => {
          void logout();
        }}
        disabled={isBusy}
      >
        {loading ? '処理中…' : 'ログアウト'}
      </button>
    </section>
  );
}
