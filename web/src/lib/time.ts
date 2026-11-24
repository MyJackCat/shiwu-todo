import type { Repeat, Task } from './types';

export const MINUTE = 60_000;
export const DAY = 86_400_000;

export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function endOfToday(): number {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export function isToday(ts: number): boolean {
  return startOfDay(ts) === startOfDay(Date.now());
}

export function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function fmtTime(ts: number | null | undefined): string {
  if (!ts) return '';
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtClock(ts: number | null | undefined): string {
  if (!ts) return '';
  const d = new Date(ts);
  const now = Date.now();
  const dayDiff = Math.round((startOfDay(d.getTime()) - startOfDay(now)) / DAY);
  if (dayDiff === 0) return fmtTime(ts);
  if (dayDiff === 1) return `明天 ${fmtTime(ts)}`;
  if (dayDiff === -1) return `昨天 ${fmtTime(ts)}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${fmtTime(ts)}`;
}

export function fmtDay(ts: number): string {
  const d = new Date(ts);
  const diff = Math.round((startOfDay(ts) - startOfDay(Date.now())) / DAY);
  if (diff === 0) return '今天';
  if (diff === 1) return '明天';
  if (diff === -1) return '昨天';
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function fmtFullDate(ts = Date.now()): string {
  const d = new Date(ts);
  const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日 周${week}`;
}

export function fmtRange(task: Task, occurrence?: number): string {
  const start = occurrence ?? task.remindAt;
  if (!start) return '';
  const end = task.endAt && task.remindAt ? start + (task.endAt - task.remindAt) : null;
  const dayPart = isToday(start) ? '' : `${fmtDay(start)} `;
  if (end) return `${dayPart}${fmtTime(start)} – ${fmtTime(end)}`;
  return `${dayPart}${fmtTime(start)}`;
}

export function toInputValue(ts: number | null | undefined): string {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromInputValue(value: string): number | null {
  if (!value) return null;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

export function defaultReminderTime(): number {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d.getTime();
}

export function nextRepeat(at: number, repeat: Repeat): number {  if (repeat === 'none') return at;
  const d = new Date(at);
  if (repeat === 'daily') {
    d.setDate(d.getDate() + 1);
  } else if (repeat === 'weekly') {
    d.setDate(d.getDate() + 7);
  } else if (repeat === 'monthly') {
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, lastDay));
  } else {
    do {
      d.setDate(d.getDate() + 1);
    } while (d.getDay() === 0 || d.getDay() === 6);
  }
  return d.getTime();
}

/** 重复提醒完成后，把时间推进到下一次（必要时跳过多个周期） */
export function repeatAfterNow(at: number, repeat: Repeat, now = Date.now()): number {
  if (repeat === 'none') return at;
  let next = at;
  let guard = 0;
  while (next <= now && guard < 600) {
    next = nextRepeat(next, repeat);
    guard += 1;
  }
  return next;
}

/** 生成 [from, to] 区间内的提醒时刻（含重复展开） */
export function occurrencesBetween(task: Task, from: number, to: number): number[] {
  if (task.kind !== 'reminder' || !task.remindAt) return [];
  let at = task.remindAt;
  const out: number[] = [];
  if (task.repeat === 'none') {
    if (at >= from && at <= to) out.push(at);
    return out;
  }
  let guard = 0;
  while (at < from && guard < 3000) {
    at = nextRepeat(at, task.repeat);
    guard += 1;
  }
  while (at <= to && guard < 6000) {
    out.push(at);
    at = nextRepeat(at, task.repeat);
    guard += 1;
  }
  return out;
}

export function isOverdue(task: Task): boolean {
  return task.kind === 'reminder' && task.status === 'pending' && !!task.remindAt && task.remindAt < Date.now();
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
