import { getState } from './store';
import { DAY, endOfToday, fmtRange } from './time';
import type { Task } from './types';

export type View = 'today' | 'all' | 'reminders' | 'done';

export interface TaskSection {
  title: string;
  items: Task[];
}

function pending(tasks: Task[]): Task[] {
  return tasks.filter((task) => task.status === 'pending' && !task.deletedAt);
}

export function filterTasks(tasks: Record<string, Task>, view: View, query: string): Task[] {
  const all = Object.values(tasks).filter((task) => !task.deletedAt);
  const q = query.trim().toLowerCase();
  const match = (task: Task) => !q || task.title.toLowerCase().includes(q) || task.notes.toLowerCase().includes(q);

  if (view === 'done') {
    return all
      .filter((task) => task.status === 'done' && match(task))
      .sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
  }

  const items = pending(all).filter(match);
  if (view === 'reminders') {
    return items.filter((task) => task.kind === 'reminder');
  }
  if (view === 'today') {
    const cutoff = endOfToday();
    return items.filter((task) => task.kind === 'task' || (task.remindAt !== null && task.remindAt <= cutoff));
  }
  return items;
}

export function groupTasks(tasks: Task[], view: View): TaskSection[] {
  if (view === 'done') {
    return tasks.length ? [{ title: '已完成', items: tasks }] : [];
  }

  const now = Date.now();
  const todayEnd = endOfToday();
  const weekEnd = todayEnd + 7 * DAY;
  const buckets: Record<string, Task[]> = {
    overdue: [],
    today: [],
    week: [],
    later: [],
    anytime: [],
  };

  for (const task of tasks) {
    if (task.kind === 'reminder' && task.remindAt) {
      if (task.remindAt < now) buckets.overdue.push(task);
      else if (task.remindAt <= todayEnd) buckets.today.push(task);
      else if (task.remindAt <= weekEnd) buckets.week.push(task);
      else buckets.later.push(task);
    } else {
      buckets.anytime.push(task);
    }
  }

  const byTime = (a: Task, b: Task) => (a.remindAt ?? 0) - (b.remindAt ?? 0);
  const byCreated = (a: Task, b: Task) => b.createdAt - a.createdAt;
  buckets.overdue.sort(byTime);
  buckets.today.sort(byTime);
  buckets.week.sort(byTime);
  buckets.later.sort(byTime);
  buckets.anytime.sort(byCreated);

  return [
    { title: '已逾期', items: buckets.overdue },
    { title: '今天', items: buckets.today },
    { title: '接下来 7 天', items: buckets.week },
    { title: '更晚', items: buckets.later },
    { title: '事务', items: buckets.anytime },
  ].filter((section) => section.items.length > 0);
}

export function todayTasks(tasks: Record<string, Task>): Task[] {
  const list = filterTasks(tasks, 'today', '');
  return groupTasks(list, 'today').flatMap((section) => section.items);
}

export function counts(tasks: Record<string, Task>) {
  const all = Object.values(tasks).filter((task) => !task.deletedAt);
  const pendingTasks = all.filter((task) => task.status === 'pending');
  const todayCutoff = endOfToday();
  return {
    today: pendingTasks.filter((task) => task.kind === 'task' || (task.remindAt !== null && task.remindAt <= todayCutoff))
      .length,
    all: pendingTasks.length,
    reminders: pendingTasks.filter((task) => task.kind === 'reminder').length,
    done: all.filter((task) => task.status === 'done').length,
  };
}

export function taskMeta(task: Task): string {
  if (task.kind === 'reminder' && task.remindAt) {
    return fmtRange(task);
  }
  return '事务';
}

export function nextReminder(tasks: Record<string, Task>): Task | null {
  const now = Date.now();
  let best: Task | null = null;
  for (const task of Object.values(tasks)) {
    if (task.kind !== 'reminder' || task.status !== 'pending' || !task.remindAt) continue;
    if (task.remindAt < now) continue;
    if (!best || (best.remindAt ?? Infinity) > task.remindAt) best = task;
  }
  return best;
}

export function syncLabel(): string {
  const state = getState();
  if (state.outboxCount > 0) return `待同步 ${state.outboxCount} 项`;
  if (state.syncing) return '同步中…';
  if (!state.online) return '离线，稍后重试';
  return state.lastSyncAt ? '已同步' : '等待同步';
}
