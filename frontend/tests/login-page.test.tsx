import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { LoginPage } from '../src/pages/login-page';
import { AuthProvider } from '../src/hooks/use-auth';
import { ToastProvider } from '../src/components/toast-provider';
import { AxiosError, AxiosHeaders } from 'axios';
import * as authApi from '../src/api/auth';

function renderWithProviders(ui: React.ReactElement): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>
        <ToastProvider>{ui}</ToastProvider>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Boot: csrf seed + me returns anonymous (null).
    vi.spyOn(authApi, 'ensureCsrfCookie').mockResolvedValue();
    vi.spyOn(authApi, 'fetchMe').mockResolvedValue(null);
  });

  it('renders form after boot', async () => {
    renderWithProviders(<LoginPage />);
    expect(await screen.findByRole('button', { name: /войти/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Логин')).toBeInTheDocument();
    expect(screen.getByLabelText('Пароль')).toBeInTheDocument();
  });

  it('shows backend error message on failed login', async () => {
    const headers = new AxiosHeaders();
    const axiosError = new AxiosError(
      'Request failed',
      '401',
      { headers } as never,
      undefined,
      {
        status: 401,
        statusText: 'Unauthorized',
        headers: {},
        config: { headers } as never,
        data: { error: 'Неверный логин или пароль' },
      }
    );
    vi.spyOn(authApi, 'loginRequest').mockRejectedValue(axiosError);

    renderWithProviders(<LoginPage />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Логин'), 'admin');
    await user.type(screen.getByLabelText('Пароль'), 'badpassword');
    await user.click(screen.getByRole('button', { name: /войти/i }));

    await waitFor(() => {
      const inline = document.querySelector('.login-card__error');
      expect(inline).not.toBeNull();
      expect(inline!.textContent).toBe('Неверный логин или пароль');
    });
  });
});
