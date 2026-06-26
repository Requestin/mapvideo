import { http } from './http';

export interface HistoryItem {
  id: string;
  createdAt: string;
  updatedAt: string;
  downloadUrl: string;
  thumbnailUrl: string;
}

interface HistoryResponse {
  items: HistoryItem[];
}

export async function getHistory(): Promise<HistoryItem[]> {
  const { data } = await http.get<HistoryResponse>('/history');
  return Array.isArray(data.items) ? data.items : [];
}

