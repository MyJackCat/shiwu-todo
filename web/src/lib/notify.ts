import { addToast, getState, setState, subscribe } from './store';
import { DAY, fmtRange, occurrencesBetween } from './time';
import type { Task } from './types';

const NOTIFIED_KEY = 'shiwu.notified.v1';

export function isWidgetMode(): boolean {
  return new URLSearchParams(location.search).get('widget') === '1';
}

export function isElectronApp(): boolean {
  return !!(window as any).desktop?.isElectron;
}

export function isAndroidApp(): boolean {
  return !!(window as any).TodoNative;
}

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function permissionState(): 'granted' | 'denied' | 'default' | 'unsupported' {
  if (isElectronApp() || isAndroidApp()) return 'granted';
  if (!notificationsSupported()) return 'unsupported';
  return Notification.permission;
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (isElectronApp() || isAndroidApp()) return true;
  if (!notificationsSupported()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

function loadNotified(): Record<string, number> {
  try {
    const raw = localStorage.getItem(NOTIFIED_KEY);
    const data = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function saveNotified(map: Record<string, number>): void {
  const now = Date.now();
  for (const key of Object.keys(map)) {
    if (now - map[key] > 7 * DAY) delete map[key];
  }
  try {
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify(map));
  } catch {
    // 存储已满时忽略
  }
}

function markNotified(key: string): void {
  const map = loadNotified();
  map[key] = Date.now();
  saveNotified(map);
}

async function showSystemNotification(title: string, body: string, data: { taskId?: string; occurrence?: number }): Promise<void> {
  if (isElectronApp()) {
    try {
      window.desktop?.notify({ title, body, taskId: data.taskId });
      return;
    } catch {
      // 落到浏览器通知
    }
  }
  if (!notificationsSupported()) return;
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) {
      await registration.showNotification(title, {
        body,
        tag: data.taskId ? `shiwu-${data.taskId}-${data.occurrence ?? ''}` : undefined,
        icon: './icons/icon-192.png',
        badge: './icons/icon-192.png',
        data,
      } as NotificationOptions);
      return;
    }
  } catch {
    // 继续使用普通通知
  }
  try {
    new Notification(title, {
      body,
      tag: data.taskId ? `shiwu-${data.taskId}-${data.occurrence ?? ''}` : undefined,
      data,
      icon: './icons/icon-192.png',
    });
  } catch {
    // 通知被系统拦截时，界面内仍有提醒条
  }
}

/** 本地提醒：web 页面 / 桌面端主窗口使用；安卓由原生闹钟负责 */
export function fireReminder(task: Task, occurrence: number): void {
  const latest = getState().tasks[task.id];
  if (!latest || latest.status !== 'pending' || latest.kind !== 'reminder') return;
  if (latest.remindAt !== task.remindAt) return;
  if (occurrence < Date.now() - 6 * 3600_000) return;

  const notifyAt = occurrence - latest.advanceMinutes * 60_000;
  if (Date.now() < notifyAt - 30_000) return;

  const key = `${latest.id}:${occurrence}`;
  const notified = loadNotified();
  if (notified[key]) return;
  markNotified(key);

  const body = fmtRange(latest, occurrence);
  addToast({ title: latest.title, body: body ? `提醒 · ${body}` : '待办提醒', taskId: latest.id });

  if (isWidgetMode()) return;
  void showSystemNotification(latest.title, body ? `提醒 · ${body}` : '待办提醒', {
    taskId: latest.id,
    occurrence,
  });
}

let timers = new Map<string, number>();
let schedulerStarted = false;
let rebuildTimer: number | null = null;

function rebuildTimers(): void {
  const now = Date.now();
  const horizon = now + 3 * DAY;
  const wanted = new Map<string, { task: Task; occurrence: number; at: number }>();

  for (const task of Object.values(getState().tasks)) {
    if (task.kind !== 'reminder' || task.status !== 'pending' || !task.remindAt) continue;
    for (const occurrence of occurrencesBetween(task, now - DAY, horizon)) {
      const at = occurrence - task.advanceMinutes * 60_000;
      if (at < now - 120_000) continue;
      wanted.set(`${task.id}:${occurrence}`, { task, occurrence, at });
    }
  }

  for (const [key, timer] of timers) {
    if (!wanted.has(key)) {
      clearTimeout(timer);
      timers.delete(key);
    }
  }

  const notified = loadNotified();
  for (const [key, item] of wanted) {
    if (timers.has(key) || notified[key]) continue;
    const delay = item.at - Date.now();
    if (delay > 24 * 3600_000) continue;
    const timer = window.setTimeout(() => {
      timers.delete(key);
      fireReminder(item.task, item.occurrence);
    }, Math.max(0, delay));
    timers.set(key, timer);
  }
}

function scheduleRebuild(): void {
  if (rebuildTimer != null) return;
  rebuildTimer = window.setTimeout(() => {
    rebuildTimer = null;
    rebuildTimers();
  }, 200);
}

export function startReminderScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  if (isAndroidApp() || isWidgetMode()) return;
  rebuildTimers();
  subscribe(scheduleRebuild);
  setInterval(rebuildTimers, 20_000);
  setInterval(() => {
    // 每秒检查一次「已错过但还没提醒」的项（例如电脑刚休眠唤醒）
    const now = Date.now();
    for (const task of Object.values(getState().tasks)) {
      if (task.kind !== 'reminder' || task.status !== 'pending' || !task.remindAt) continue;
      const notifyAt = task.remindAt - task.advanceMinutes * 60_000;
      if (notifyAt <= now && now - task.remindAt < 5 * 60_000) {
        fireReminder(task, task.remindAt);
      }
    }
  }, 1000);
  window.addEventListener('focus', scheduleRebuild);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) rebuildTimers();
  });
  setInterval(scheduleRebuild, 60_000);
}

export function notifyLocal(subscribe: (fn: () => void) => void): void {
  subscribe(scheduleRebuild);
}

export function testNotification(): void {
  addToast({ title: '测试提醒', body: '通知已发出，说明提醒通道正常。' });
  void showSystemNotification('测试提醒', '如果你看到这条系统通知，说明提醒通道正常。', {});
}
