import { useCallback, useEffect, useState } from 'react';
import { AuthErrorCode } from '../../shared/auth/errors';
import { AuthMessageType } from '../../shared/auth/messages';
import type {
  AuthErrorPayload,
  AuthResponse,
  ProviderGetConnectUrlResponseData,
  ProviderGetSocialAccountsResponseData,
} from '../../shared/auth/messages';
import type { Provider } from '../../shared/auth/providers';
import type { SocialAccount } from '../../shared/auth/types';
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
  console.log('[diag] launchWebAuthFlow start, url =', url);
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive: true }, (redirectUrl) => {
      const lastError = chrome.runtime.lastError;
      console.log(
        '[diag] launchWebAuthFlow returned. lastError =',
        lastError?.message,
        'redirectUrl =',
        redirectUrl,
      );
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

function assertLinkSucceeded(redirectUrl: string): void {
  // body-mode の link フローでは AuthCore が
  // `https://<extension-id>.chromiumapp.org/cb#linked=1&provider=...&provider_user_id=...`
  // 形式の fragment にリンク結果を乗せて返す。エラー時は `#error=...` が乗る。
  // 本拡張は connect クリック時の provider と発火元から成功表示を組み立てるため、
  // fragment の値は検証だけ行い破棄する。
  const url = new URL(redirectUrl);
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
  if (fragment.get('linked') !== '1') {
    const errorCode = fragment.get('error');
    throw new Error(
      errorCode ? `Provider link failed: ${errorCode}` : 'Provider link did not complete',
    );
  }
  if (!fragment.get('provider') || !fragment.get('provider_user_id')) {
    throw new Error('Authorization callback fragment is missing provider info');
  }
}

function providerLabel(provider: Provider): string {
  switch (provider) {
    case 'x':
      return 'X';
    case 'google':
      return 'Google';
    case 'youtube':
      return 'YouTube';
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
    case AuthErrorCode.SOCIAL_ALREADY_LINKED:
      return 'このチャンネルは既に連携済みです。';
    case AuthErrorCode.SOCIAL_ALREADY_LINKED_TO_OTHER_USER:
      return 'このチャンネルは別の Fuju アカウントに連携されています。';
    default:
      return error.message || '連携に失敗しました。';
  }
}

export function Dashboard() {
  const { user, logout, loading } = useAuth();
  const [linkingProvider, setLinkingProvider] = useState<Provider | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkSuccess, setLinkSuccess] = useState<string | null>(null);
  const [socialAccounts, setSocialAccounts] = useState<SocialAccount[] | null>(null);
  const [socialAccountsLoading, setSocialAccountsLoading] = useState<boolean>(false);
  const [socialAccountsError, setSocialAccountsError] = useState<string | null>(null);

  const fetchSocialAccounts = useCallback(async () => {
    setSocialAccountsLoading(true);
    setSocialAccountsError(null);
    try {
      const response = await sendMessage<ProviderGetSocialAccountsResponseData>({
        type: AuthMessageType.PROVIDER_GET_SOCIAL_ACCOUNTS,
      });
      if (!response.ok) {
        setSocialAccountsError(formatLinkError(response.error));
        return;
      }
      setSocialAccounts(response.data.accounts);
    } finally {
      setSocialAccountsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSocialAccounts();
  }, [fetchSocialAccounts]);

  const handleConnect = useCallback(
    async (provider: Provider) => {
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
          assertLinkSucceeded(redirectUrl);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Invalid authorization callback';
          setLinkError(message);
          return;
        }

        setLinkSuccess(`${providerLabel(provider)} と連携しました。`);
        // 連携成功直後にリストを再取得して表示を即時反映する。
        void fetchSocialAccounts();
      } finally {
        setLinkingProvider(null);
      }
    },
    [fetchSocialAccounts],
  );

  const isBusy = loading || linkingProvider !== null;
  const youtubeAccounts = socialAccounts
    ? socialAccounts.filter((account) => account.provider === 'youtube')
    : null;

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
        <button
          type="button"
          className="auth-secondary"
          onClick={() => {
            void handleConnect('youtube');
          }}
          disabled={isBusy}
        >
          {linkingProvider === 'youtube' ? '連携中…' : 'YouTube と連携'}
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
      <section className="auth-social-list" aria-label="連携済み YouTube チャンネル">
        <h2>連携済み YouTube チャンネル</h2>
        {socialAccountsLoading && <p className="auth-hint">読み込み中…</p>}
        {!socialAccountsLoading && socialAccountsError && (
          <p className="auth-error" role="alert">
            {socialAccountsError}
          </p>
        )}
        {!socialAccountsLoading &&
          !socialAccountsError &&
          youtubeAccounts &&
          youtubeAccounts.length === 0 && (
            <p className="auth-hint">連携済みの YouTube チャンネルはありません。</p>
          )}
        {!socialAccountsLoading &&
          !socialAccountsError &&
          youtubeAccounts &&
          youtubeAccounts.length > 0 && (
            <ul className="auth-social-items">
              {youtubeAccounts.map((account) => (
                <li key={account.provider_user_id}>
                  <span className="auth-social-name">
                    {account.display_name || account.provider_user_id}
                  </span>
                </li>
              ))}
            </ul>
          )}
      </section>
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
