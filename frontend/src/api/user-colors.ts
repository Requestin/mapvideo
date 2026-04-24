import { http } from './http';

// Контракт совпадает с backend/src/routes/user-colors.ts.
// Список нормализуется на сервере (нижний регистр, дедуп, regex `#rrggbb`,
// до 10 элементов) — фронт получает уже «чистый» массив.

export async function getMyColors(): Promise<string[]> {
  const res = await http.get<{ colors: string[] }>('/users/me/colors');
  return res.data.colors;
}

export async function saveMyColors(colors: string[]): Promise<string[]> {
  const res = await http.put<{ colors: string[] }>('/users/me/colors', { colors });
  return res.data.colors;
}
