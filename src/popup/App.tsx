import './App.css';
import { AuthProvider } from './auth/AuthProvider';
import { Dashboard } from './auth/Dashboard';
import { LoginForm } from './auth/LoginForm';
import { useAuth } from './auth/useAuth';

function AuthGate() {
  const { isAuthenticated, loading, user } = useAuth();

  if (loading && !user && !isAuthenticated) {
    return (
      <section className="auth-loading">
        <p>読み込み中…</p>
      </section>
    );
  }

  return isAuthenticated ? <Dashboard /> : <LoginForm />;
}

function App() {
  return (
    <AuthProvider>
      <main className="auth-shell">
        <AuthGate />
      </main>
    </AuthProvider>
  );
}

export default App;
