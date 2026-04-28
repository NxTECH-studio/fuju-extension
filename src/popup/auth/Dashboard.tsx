import { useAuth } from './useAuth';

export function Dashboard() {
  const { user, logout, loading } = useAuth();

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
      <button
        type="button"
        className="auth-submit"
        onClick={() => {
          void logout();
        }}
        disabled={loading}
      >
        {loading ? '処理中…' : 'ログアウト'}
      </button>
    </section>
  );
}
