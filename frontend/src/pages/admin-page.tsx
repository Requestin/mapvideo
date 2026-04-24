import { FormEvent, useCallback, useEffect, useState } from 'react';
import { AxiosError } from 'axios';
import { Header } from '../components/header';
import { useToast } from '../components/toast-provider';
import { useAuth } from '../hooks/use-auth';
import {
  createAdminUser,
  deleteAdminUser,
  listAdminUsers,
  type AdminUser,
} from '../api/admin';
import './admin-page.css';

export function AdminPage(): JSX.Element {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      setUsers(await listAdminUsers());
    } catch (err) {
      const msg =
        err instanceof AxiosError
          ? ((err.response?.data as { error?: string } | undefined)?.error ?? 'Не удалось загрузить список пользователей')
          : 'Не удалось загрузить список пользователей';
      setListError(msg);
      showToast({ type: 'error', message: msg });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onCreate(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!username || !password) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await createAdminUser(username, password);
      setUsername('');
      setPassword('');
      await refresh();
    } catch (err) {
      const msg =
        err instanceof AxiosError
          ? ((err.response?.data as { error?: string } | undefined)?.error ?? 'Не удалось создать пользователя')
          : 'Не удалось создать пользователя';
      setFormError(msg);
      showToast({ type: 'error', message: msg });
    } finally {
      setSubmitting(false);
    }
  }

  async function onDelete(target: AdminUser): Promise<void> {
    // Guards live on the backend too (403 for admin / self), but showing the
    // confirm helps avoid accidental clicks when the grid gets long.
    const ok = window.confirm(`Удалить пользователя "${target.username}"?`);
    if (!ok) return;
    try {
      await deleteAdminUser(target.id);
      await refresh();
    } catch (err) {
      const msg =
        err instanceof AxiosError
          ? (err.response?.data as { error?: string } | undefined)?.error
          : undefined;
      showToast({ type: 'error', message: msg ?? 'Не удалось удалить пользователя' });
    }
  }

  return (
    <div className="admin-page">
      <Header />
      <main className="admin-page__main">
        <h1 className="admin-page__title">Управление пользователями</h1>

        <section className="admin-page__create">
          <h2 className="admin-page__subtitle">Добавить пользователя</h2>
          <form className="admin-page__form" onSubmit={onCreate} noValidate>
            <label className="admin-page__field">
              <span>Логин</span>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="off"
                required
              />
            </label>
            <label className="admin-page__field">
              <span>Пароль</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </label>
            <button
              type="submit"
              className="app-button app-button--primary admin-page__submit"
              disabled={submitting || !username || !password}
            >
              {submitting ? 'Создаём…' : 'Добавить'}
            </button>
            {formError && (
              <div className="admin-page__error" role="alert">
                {formError}
              </div>
            )}
          </form>
        </section>

        <section className="admin-page__list">
          <h2 className="admin-page__subtitle">Пользователи</h2>
          {loading ? (
            <p className="admin-page__muted">Загрузка…</p>
          ) : listError ? (
            <div className="admin-page__error" role="alert">
              {listError}
            </div>
          ) : (
            <table className="admin-page__table">
              <thead>
                <tr>
                  <th>Логин</th>
                  <th>Роль</th>
                  <th>Создан</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const isSelf = u.id === user?.id;
                  const isAdminAccount = u.username === 'admin';
                  return (
                    <tr key={u.id}>
                      <td>{u.username}</td>
                      <td>{u.role}</td>
                      <td>{new Date(u.createdAt).toLocaleString('ru-RU')}</td>
                      <td className="admin-page__cell-actions">
                        <button
                          type="button"
                          className="app-button app-button--danger"
                          onClick={() => void onDelete(u)}
                          disabled={isSelf || isAdminAccount}
                          title={
                            isAdminAccount
                              ? 'Нельзя удалить пользователя admin'
                              : isSelf
                                ? 'Нельзя удалить самого себя'
                                : 'Удалить'
                          }
                        >
                          Удалить
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </div>
  );
}
