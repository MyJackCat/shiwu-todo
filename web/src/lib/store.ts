import { useSyncExternalStore } from 'react';
import type { Task, Toast, User } from './types';

export type View = 'today' | 'all' | 'reminders' | 'done';

export interface AppState {
  ready: boolean;
  user: User | null;
  tasks: Record<string, Task>;
  lastSeq: number;
  syncing: boolean;
  online: boolean;
  lastSyncAt: number | null;
  outboxCount: number;
  toasts: Toast[];
  view: View;
}

const initialState: AppState = {
  ready: false,
  user: null,
  tasks: {},
  lastSeq: 0,
  syncing: false,
  online: true,
  lastSyncAt: null,
  outboxCount: 0,
  toasts: [],
  view: 'today',
};

let state: AppState = initialState;
const listeners = new Set<() => void>();

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState> | ((current: AppState) => Partial<AppState>)): void {
  const next = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useStore(): AppState {
  return useSyncExternalStore(subscribe, getState, getState);
}

let toastSeq = 0;

export function addToast(input: { title: string; body?: string; taskId?: string }): void {
  const toast: Toast = {
    key: `t-${Date.now()}-${toastSeq++}`,
    title: input.title,
    body: input.body ?? '',
    taskId: input.taskId,
    at: Date.now(),
  };
  setState((current) => ({ toasts: [toast, ...current.toasts].slice(0, 3) }));
}

export function dismissToast(key: string): void {
  setState((current) => ({ toasts: current.toasts.filter((toast) => toast.key !== key) }));
}
