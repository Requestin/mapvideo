import { FormEvent, useState } from 'react';
import { AxiosError } from 'axios';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/use-auth';
import { FullScreenSpinner } from '../components/full-screen-spinner';
import { useToast } from '../components/toast-provider';
import './login-page.css';

interface LocationState {
  from?: string;
}

export function LoginPage(): JSX.Element {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (loading) return <FullScreenSpinner />;
  if (user) {
    // Already signed in — no point showing the form. Send them back.
    const from = (location.state as LocationState | null)?.from ?? '/';
    return <Navigate to={from} replace />;
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!username || !password) return;
    setError(null);
    setSubmitting(true);
    try {
      await login(username, password);
      const from = (location.state as LocationState | null)?.from ?? '/';
      navigate(from, { replace: true });
    } catch (err) {
      const msg =
        err instanceof AxiosError
          ? ((err.response?.data as { error?: string } | undefined)?.error ?? 'Не удалось войти. Проверьте соединение.')
          : 'Не удалось войти. Проверьте соединение.';
      setError(msg);
      showToast({ type: 'error', message: msg });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={onSubmit} noValidate>
        <h1 className="login-card__title">Mapvideo</h1>
        <label className="login-card__field">
          <span>Логин</span>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </label>
        <label className="login-card__field">
          <span>Пароль</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && (
          <div className="login-card__error" role="alert">
            {error}
          </div>
        )}
        <button
          type="submit"
          className="app-button app-button--primary login-card__submit"
          disabled={submitting || !username || !password}
        >
          {submitting ? 'Входим…' : 'Войти'}
        </button>
      </form>
    </div>
  );
}
