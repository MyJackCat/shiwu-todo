export type TaskKind = 'task' | 'reminder';
export type TaskStatus = 'pending' | 'done';
export type Repeat = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly';

export interface Task {
  id: string;
  userId?: string;
  title: string;
  notes: string;
  kind: TaskKind;
  status: TaskStatus;
  priority: number;
  remindAt: number | null;
  endAt: number | null;
  repeat: Repeat;
  advanceMinutes: number;
  lastNotifiedAt: number | null;
  doneAt: number | null;
  deletedAt: number | null;
  createdAt: number;
  updatedAt: number;
  seq: number;
}

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface Toast {
  key: string;
  title: string;
  body: string;
  taskId?: string;
  at: number;
}

export interface TaskInput {
  id?: string;
  title: string;
  notes?: string;
  kind?: TaskKind;
  priority?: number;
  remindAt?: number | null;
  endAt?: number | null;
  repeat?: Repeat;
  advanceMinutes?: number;
  status?: TaskStatus;
}

export const REPEAT_LABELS: Record<Repeat, string> = {
  none: '不重复',
  daily: '每天',
  weekdays: '工作日',
  weekly: '每周',
  monthly: '每月',
};
