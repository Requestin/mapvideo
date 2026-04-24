import { http } from './http';
import type { MapStateV1 } from '../types/map-state';

export async function postRender(state: MapStateV1): Promise<{ jobId: string }> {
  const { data } = await http.post<{ jobId: string }>('/render', { state });
  return data;
}

export interface RenderStatusResponse {
  status: 'queued' | 'running' | 'done' | 'error';
  progress: number;
  message: string | null;
  error: string | null;
  downloadUrl?: string;
}

export async function getRenderStatus(jobId: string): Promise<RenderStatusResponse> {
  const { data } = await http.get<RenderStatusResponse>(`/render/status/${encodeURIComponent(jobId)}`);
  return data;
}

export interface ActiveRenderResponse {
  active: {
    id: string;
    status: string;
    progress: number;
    errorMessage: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
}

export async function getActiveRender(): Promise<ActiveRenderResponse> {
  const { data } = await http.get<ActiveRenderResponse>('/render/active');
  return data;
}
