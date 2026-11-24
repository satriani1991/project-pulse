import { WORKSPACE_ID } from '../stores/workspace';

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: { 'X-Pulse': '1', 'X-Pulse-Workspace': WORKSPACE_ID } };
  if (method !== 'GET') { (init.headers as Record<string, string>)['Content-Type'] = 'application/json'; init.body = JSON.stringify(body ?? {}); }
  const r = await fetch(url, init);
  const text = await r.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!r.ok) throw new ApiError(r.status, data?.error ?? r.statusText);
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
};

export const qs = (o: Record<string, string | number | boolean | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
export const rawUrl = (projectId: string, path: string) => `/api/projects/${encodeURIComponent(projectId)}/raw${qs({ path, ws: WORKSPACE_ID })}`;
/** For plain links/img tags that cannot send headers. */
export const wsUrl = (url: string) => url + (url.includes('?') ? '&' : '?') + 'ws=' + encodeURIComponent(WORKSPACE_ID);
