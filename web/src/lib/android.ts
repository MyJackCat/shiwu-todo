import { getApiBase, getToken } from './api';
import { getState, subscribe } from './store';
import { DAY, fmtRange, occurrencesBetween } from './time';

let started = false;

function buildSnapshot(): string | null {
  const native = window.TodoNative;
  const state = getState();
  const token = getToken();
  if (!native || !state.user || !token) return null;

  const now = Date.now();
  const tasks = Object.values(state.tasks)
    .filter((task) => task.status === 'pending' && !task.deletedAt)
    .sort((a, b) => {
      const at = a.kind === 'reminder' ? a.remindAt ?? Infinity : Infinity;
      const bt = b.kind === 'reminder' ? b.remindAt ?? Infinity : Infinity;
      return at - bt;
    })
    .map((task) => ({
      id: task.id,
      title: task.title,
      kind: task.kind,
      priority: task.priority,
      status: task.status,
      remindAt: task.remindAt,
      endAt: task.endAt,
      repeat: task.repeat,
      advanceMinutes: task.advanceMinutes,
      createdAt: task.createdAt,
    }));

  const occurrences: Array<{ key: string; taskId: string; title: string; at: number; body: string }> = [];
  for (const task of Object.values(state.tasks)) {
    if (task.kind !== 'reminder' || task.status !== 'pending' || !task.remindAt) continue;
    for (const occurrence of occurrencesBetween(task, now - DAY, now + 7 * DAY)) {
      const at = occurrence - task.advanceMinutes * 60_000;
      if (at < now - 60_000) continue;
      occurrences.push({
        key: `${task.id}:${occurrence}`,
        taskId: task.id,
        title: task.title,
        at,
        body: fmtRange(task, occurrence),
      });
    }
  }
  occurrences.sort((a, b) => a.at - b.at);

  return JSON.stringify({
    updatedAt: now,
    seq: state.lastSeq,
    apiBase: getApiBase(),
    tasks,
    occurrences: occurrences.slice(0, 48),
  });
}

function pushSnapshot(): void {
  const native = window.TodoNative;
  if (!native) return;
  const state = getState();
  const token = getToken();
  if (!state.user || !token) return;
  const json = buildSnapshot();
  if (!json) return;
  try {
    native.setSession(getApiBase(), token, JSON.stringify(state.user));
    native.pushSnapshot(json);
  } catch (err) {
    console.warn('[android] 同步小组件数据失败', err);
  }
}

/** 网页数据变化时把精简快照交给安卓原生层：主屏小组件与闹钟都靠它 */
export function startNativeBridge(): void {
  if (!window.TodoNative || started) return;
  started = true;
  let timer: number | null = null;
  const schedule = () => {
    if (timer != null) return;
    timer = window.setTimeout(() => {
      timer = null;
      pushSnapshot();
    }, 350);
  };
  subscribe(schedule);
  schedule();
  window.setTimeout(() => {
    try {
      window.TodoNative?.requestNotificationPermission();
    } catch {
      // 忽略
    }
  }, 1200);
  window.setInterval(pushSnapshot, 5 * 60_000);
}
