import type { Repeat, Task, TaskInput, User } from './types';

const API_BASE_KEY = 'shiwu.apiBase';
const TOKEN_KEY = 'shiwu.token';
const USER_KEY = 'shiwu.user';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

export function normalizeBase(url: string): string {
  let value = url.trim();
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  return value.replace(/\/+$/, '');
}

export function getApiBase(): string {
  const query = new URLSearchParams(location.search).get('api');
  if (query) return normalizeBase(query);
  const saved = localStorage.getItem(API_BASE_KEY);
  if (saved) return normalizeBase(saved);
  if (location.protocol === 'http:' || location.protocol === 'https:') return location.origin;
  return 'http://localhost:8787';
}

export function setApiBase(url: string): string {
  const normalized = normalizeBase(url);
  if (normalized) localStorage.setItem(API_BASE_KEY, normalized);
  else localStorage.removeItem(API_BASE_KEY);
  return normalized;
}

export function isCustomApiBase(): boolean {
  return !!localStorage.getItem(API_BASE_KEY);
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

export function setSession(token: string, user: User): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function isElectron(): boolean {
  return !!(window as any).desktop?.isElectron;
}

export function isAndroidApp(): boolean {
  return !!(window as any).TodoNative;
}

async function request<T>(path: string, options: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = options;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${getApiBase()}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, '无法连接服务器，请检查网络或服务器地址');
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    // 非 JSON 响应
  }
  if (!res.ok) {
    throw new ApiError(res.status, data?.error || `请求失败（${res.status}）`);
  }
  return data as T;
}

export const api = {
  register(input: { email: string; password: string; name?: string }) {
    return request<{ token: string; user: User }>('/api/auth/register', { method: 'POST', body: input, auth: false });
  },

  login(input: { email: string; password: string }) {
    return request<{ token: string; user: User }>('/api/auth/login', { method: 'POST', body: input, auth: false });
  },

  me() {
    return request<{ user: User }>('/api/me');
  },

  changes(since: number) {
    return request<{ serverSeq: number; tasks: Task[] }>(`/api/changes?since=${since}`);
  },

  createTask(task: TaskInput & { id: string }) {
    return request<{ task: Task }>('/api/tasks', { method: 'POST', body: task });
  },

  updateTask(id: string, patch: Partial<TaskInput>) {
    return request<{ task: Task }>(`/api/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch });
  },

  completeTask(id: string, done: boolean) {
    return request<{ task: Task }>(`/api/tasks/${encodeURIComponent(id)}/complete`, {
      method: 'POST',
      body: { done },
    });
  },

  deleteTask(id: string) {
    return request<{ ok: boolean }>(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  pushKey() {
    return request<{ publicKey: string }>('/api/push/key');
  },

  subscribePush(subscription: unknown) {
    return request<{ ok: boolean }>('/api/push/subscribe', { method: 'POST', body: { subscription } });
  },

  unsubscribePush(endpoint: string) {
    return request<{ ok: boolean }>('/api/push/unsubscribe', { method: 'POST', body: { endpoint } });
  },
};

export function normalizeTask(input: any): Task | null {
  if (!input || typeof input !== 'object' || typeof input.id !== 'string') return null;
  const kind = input.kind === 'reminder' ? 'reminder' : 'task';
  const repeat: Repeat =
    input.repeat === 'daily' || input.repeat === 'weekdays' || input.repeat === 'weekly' || input.repeat === 'monthly'
      ? input.repeat
      : 'none';
  return {
    id: input.id,
    userId: input.userId,
    title: String(input.title ?? ''),
    notes: String(input.notes ?? ''),
    kind,
    status: input.status === 'done' ? 'done' : 'pending',
    priority: Number(input.priority) || 0,
    remindAt: input.remindAt == null ? null : Number(input.remindAt),
    endAt: input.endAt == null ? null : Number(input.endAt),
    repeat: kind === 'reminder' ? repeat : 'none',
    advanceMinutes: Number(input.advanceMinutes) || 0,
    lastNotifiedAt: input.lastNotifiedAt == null ? null : Number(input.lastNotifiedAt),
    doneAt: input.doneAt == null ? null : Number(input.doneAt),
    deletedAt: input.deletedAt == null ? null : Number(input.deletedAt),
    createdAt: Number(input.createdAt) || Date.now(),
    updatedAt: Number(input.updatedAt) || Date.now(),
    seq: Number(input.seq) || 0,
  };
}
