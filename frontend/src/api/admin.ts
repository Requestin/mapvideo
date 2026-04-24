import { http } from './http';
import type { UserRole } from './auth';

export interface AdminUser {
  id: string;
  username: string;
  role: UserRole;
  createdAt: string;
}

export async function listAdminUsers(): Promise<AdminUser[]> {
  const res = await http.get<{ users: AdminUser[] }>('/admin/users');
  return res.data.users;
}

export async function createAdminUser(
  username: string,
  password: string
): Promise<{ id: string; username: string; role: UserRole }> {
  const res = await http.post<{ id: string; username: string; role: UserRole }>(
    '/admin/users',
    { username, password }
  );
  return res.data;
}

export async function deleteAdminUser(id: string): Promise<void> {
  await http.delete(`/admin/users/${id}`);
}
