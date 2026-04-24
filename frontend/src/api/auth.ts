import { AxiosError } from 'axios';
import { http } from './http';

export type UserRole = 'admin' | 'user';
export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
}

// Mirrors GET /api/auth/me — flat body by backend contract.
export async function fetchMe(): Promise<AuthUser | null> {
  try {
    const res = await http.get<AuthUser>('/auth/me');
    return res.data;
  } catch (err) {
    if (err instanceof AxiosError && err.response?.status === 401) return null;
    throw err;
  }
}

export async function ensureCsrfCookie(): Promise<void> {
  await http.get('/auth/csrf');
}

export async function loginRequest(username: string, password: string): Promise<AuthUser> {
  const res = await http.post<{ user: AuthUser }>('/auth/login', { username, password });
  return res.data.user;
}

export async function logoutRequest(): Promise<void> {
  await http.post('/auth/logout', {});
}
