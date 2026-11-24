import {
  ApiError,
  api,
  clearSession,
  getApiBase,
  getStoredUser,
  getToken,
  normalizeTask,
  setSession,
} from './api';
import { fireReminder, startReminderScheduler } from './notify';
import { addToast, getState, setState, subscribe } from './store';
import { newId, repeatAfterNow } from './time';
import type { Task, TaskInput, User } from './types';

const CACHE_KEY = 'shiwu.cache.v1';
const OUTBOX_KEY = 'shiwu.outbox.v1';

type OutboxOp =
  | { kind: 'create'; task: Task }
  | { kind: 'update'; taskId: string; patch: Partial<TaskInput> }
  | { kind: 'complete'; taskId: string; done: boolean }
  | { kind: 'delete'; taskId: string };

let outbox: OutboxOp[] = [];
let booted = false;
let pulling = false;
let pullAgain = false;
let flushing = false;
let events: EventSource | null = null;
let retryTimer: number | null = null;
let persistTimer: number | null = null;
let bootInProgress = false;
let sessionWatcherStarted = false;
let lastToken: string | null = null;
let checkingSession = false;

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function loadCache(): void {
  const cached = readJson<{ userId?: string; tasks?: Record<string, Task>; lastSeq?: number; lastSyncAt?: number }>(CACHE_KEY);
  const user = getStoredUser();
  const tasks: Record<string, Task> = {};
  if (cached && (!cached.userId || !user || cached.userId === user.id)) {
    for (const raw of Object.values(cached.tasks ?? {})) {
      const task = normalizeTask(raw);
      if (task && !task.deletedAt) tasks[task.id] = task;
    }
  }
  const cachedOutbox = readJson<OutboxOp[]>(OUTBOX_KEY);
  if (Array.isArray(cachedOutbox)) {
    outbox = cachedOutbox.filter((op) => op && typeof op === 'object');
  }
  setState({
    ready: true,
    user,
    tasks,
    lastSeq: Number(cached?.lastSeq) || 0,
    lastSyncAt: cached?.lastSyncAt ?? null,
    outboxCount: outbox.length,
  });
}

function saveOutbox(): void {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
  } catch {
    // 忽略存储失败
  }
}

function saveCache(): void {
  const { user, tasks, lastSeq, lastSyncAt } = getState();
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ userId: user?.id, tasks, lastSeq, lastSyncAt }));
  } catch {
    // 忽略存储失败
  }
}

function persistSoon(): void {
  if (persistTimer != null) return;
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    saveCache();
  }, 400);
}

function applyChanges(list: unknown[]): void {
  const pendingIds = new Set(outbox.map((op) => (op.kind === 'create' ? op.task.id : op.taskId)));
  setState((current) => {
    const tasks = { ...current.tasks };
    for (const raw of list) {
      const task = normalizeTask(raw);
      if (!task || pendingIds.has(task.id)) continue;
      if (task.deletedAt) delete tasks[task.id];
      else tasks[task.id] = task;
    }
    return { tasks };
  });
}

function scheduleRetry(delay = 8000): void {
  if (retryTimer != null) return;
  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    void flush();
    void pull();
  }, delay);
}

export async function pull(full = false): Promise<void> {
  if (!getToken()) return;
  if (pulling) {
    pullAgain = true;
    return;
  }
  pulling = true;
  setState({ syncing: true });
  try {
    let forceFull = full;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const since = forceFull ? 0 : getState().lastSeq;
      const data = await api.changes(since);
      if (!forceFull && data.serverSeq < since) {
        forceFull = true;
        continue;
      }
      applyChanges(data.tasks);
      setState((current) => ({
        lastSeq: forceFull ? data.serverSeq : Math.max(current.lastSeq, data.serverSeq),
        lastSyncAt: Date.now(),
        online: true,
        syncing: false,
      }));
      break;
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      logout();
      return;
    }
    setState({ online: false, syncing: false });
  } finally {
    pulling = false;
    if (pullAgain) {
      pullAgain = false;
      void pull();
    }
  }
}

export async function flush(): Promise<void> {
  if (flushing || outbox.length === 0 || !getToken()) return;
  flushing = true;
  let changed = false;
  try {
    while (outbox.length > 0) {
      const op = outbox[0];
      if (op.kind === 'create') {
        const task = op.task;
        await api.createTask({
          id: task.id,
          title: task.title,
          notes: task.notes,
          kind: task.kind,
          priority: task.priority,
          remindAt: task.remindAt,
          endAt: task.endAt,
          repeat: task.repeat,
          advanceMinutes: task.advanceMinutes,
          status: task.status,
        });
      } else if (op.kind === 'update') {
        await api.updateTask(op.taskId, op.patch);
      } else if (op.kind === 'complete') {
        await api.completeTask(op.taskId, op.done);
      } else {
        await api.deleteTask(op.taskId);
      }
      outbox.shift();
      changed = true;
      saveOutbox();
      setState({ outboxCount: outbox.length, online: true });
    }
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 0;
    if (status === 401) {
      logout();
      return;
    }
    if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
      const op = outbox.shift();
      changed = true;
      saveOutbox();
      setState({ outboxCount: outbox.length });
      addToast({ title: '有改动未能同步', body: err instanceof Error ? err.message : '请求失败' });
      if (op?.kind === 'create') {
        setState((current) => {
          const tasks = { ...current.tasks };
          delete tasks[op.task.id];
          return { tasks };
        });
      }
    } else {
      setState({ online: false });
      scheduleRetry(8000);
    }
  } finally {
    flushing = false;
    if (changed) void pull(true);
    else if (outbox.length > 0) scheduleRetry(15000);
  }
}

function pushOp(op: OutboxOp): void {
  outbox.push(op);
  saveOutbox();
  setState({ outboxCount: outbox.length });
}

function connectEvents(): void {
  const token = getToken();
  if (!token) return;
  if (events) events.close();
  try {
    events = new EventSource(`${getApiBase()}/api/events?token=${encodeURIComponent(token)}`);
  } catch {
    events = null;
    return;
  }
  let pendingPull: number | null = null;
  events.onmessage = (event) => {
    let data: any;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    if (data.type === 'change') {
      if (pendingPull != null) return;
      pendingPull = window.setTimeout(() => {
        pendingPull = null;
        void pull();
      }, 300);
    } else if (data.type === 'reminder') {
      const task = normalizeTask(data.task);
      if (task) fireReminder(task, Number(data.occurrence) || task.remindAt || Date.now());
    } else if (data.type === 'ready') {
      setState({ online: true });
      void pull();
    }
  };
  events.onopen = () => setState({ online: true });
  events.onerror = () => setState({ online: false });
}

export async function boot(): Promise<void> {
  if (booted) return;
  booted = true;
  bootInProgress = true;
  loadCache();
  startReminderScheduler();
  subscribe(persistSoon);

  window.addEventListener('online', () => {
    void flush();
    void pull();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      void flush();
      void pull();
    }
  });
  window.setInterval(() => {
    if (!document.hidden && getToken()) void pull();
  }, 60_000);
  window.setInterval(() => {
    void flush();
  }, 15_000);

  try {
    if (!getToken()) {
      setState({ ready: true });
      return;
    }
    try {
      const { user } = await api.me();
      setState({ user });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logout();
        return;
      }
      setState({ online: false });
    }
    await flush();
    await pull(true);
    connectEvents();
  } finally {
    bootInProgress = false;
    startSessionWatcher();
  }
}

/**
 * 主窗口和桌面小组件是两个渲染进程，共享 localStorage 但各有各的内存状态。
 * 监视 token 变化，让先启动的小组件在主窗口登录后自动恢复会话；
 * 也顺便支持浏览器多标签页同步登录/退出。
 */
function startSessionWatcher(): void {
  if (sessionWatcherStarted) return;
  sessionWatcherStarted = true;
  lastToken = getState().user ? getToken() : null;
  window.addEventListener('storage', () => {
    void checkSession();
  });
  window.addEventListener('focus', () => {
    void checkSession();
  });
  window.setInterval(() => {
    void checkSession();
  }, 5000);
  void checkSession();
}

async function checkSession(): Promise<void> {
  if (bootInProgress || checkingSession) return;
  const token = getToken();
  const currentUser = getState().user;

  if (!token) {
    if (currentUser) logout();
    lastToken = null;
    return;
  }

  if (token === lastToken) return;
  lastToken = token;
  checkingSession = true;
  try {
    const { user } = await api.me();
    const previous = getState().user;
    if (previous && previous.id !== user.id) {
      // 另一个窗口切换了账号，清掉旧账号的本地任务和待发队列
      outbox = [];
      saveOutbox();
      setState({ user, tasks: {}, lastSeq: 0, lastSyncAt: null, outboxCount: 0 });
    } else {
      setState({ user });
    }
    connectEvents();
    await flush();
    await pull(true);
  } catch (err) {
    lastToken = null;
    if (err instanceof ApiError && err.status === 401) {
      logout();
    } else {
      setState({ online: false });
    }
  } finally {
    checkingSession = false;
  }
}

function startSession(token: string, user: User): void {
  setSession(token, user);
  lastToken = token;
  localStorage.removeItem(CACHE_KEY);
  localStorage.removeItem(OUTBOX_KEY);
  outbox = [];
  setState({
    user,
    tasks: {},
    lastSeq: 0,
    lastSyncAt: null,
    outboxCount: 0,
    online: true,
    ready: true,
  });
  connectEvents();
  void pull(true);
}

export async function login(email: string, password: string): Promise<void> {
  const data = await api.login({ email, password });
  startSession(data.token, data.user);
}

export async function register(email: string, password: string, name: string): Promise<void> {
  const data = await api.register({ email, password, name });
  startSession(data.token, data.user);
}

export function logout(): void {
  try {
    window.TodoNative?.clearSession();
  } catch {
    // 非安卓环境
  }
  clearSession();
  lastToken = null;
  localStorage.removeItem(CACHE_KEY);
  localStorage.removeItem(OUTBOX_KEY);
  localStorage.removeItem('shiwu.notified.v1');
  outbox = [];
  if (events) {
    events.close();
    events = null;
  }
  setState({
    user: null,
    tasks: {},
    lastSeq: 0,
    lastSyncAt: null,
    outboxCount: 0,
    toasts: [],
    online: true,
    ready: true,
  });
}

export async function addTask(input: TaskInput): Promise<Task | null> {
  const user = getState().user;
  const title = input.title.trim();
  if (!user || !title) return null;
  const now = Date.now();
  const kind = input.kind === 'reminder' ? 'reminder' : 'task';
  const task: Task = {
    id: newId(),
    userId: user.id,
    title,
    notes: input.notes ?? '',
    kind,
    status: 'pending',
    priority: input.priority ?? 0,
    remindAt: kind === 'reminder' ? (input.remindAt ?? null) : null,
    endAt: kind === 'reminder' ? (input.endAt ?? null) : null,
    repeat: kind === 'reminder' ? (input.repeat ?? 'none') : 'none',
    advanceMinutes: kind === 'reminder' ? (input.advanceMinutes ?? 0) : 0,
    lastNotifiedAt: null,
    doneAt: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    seq: 0,
  };
  setState((current) => ({ tasks: { ...current.tasks, [task.id]: task } }));
  pushOp({ kind: 'create', task });
  void flush();
  return task;
}

export async function saveTask(id: string, patch: Partial<TaskInput>): Promise<void> {
  const current = getState().tasks[id];
  if (!current) return;
  const merged: Task = { ...current, ...patch, updatedAt: Date.now() };
  if (merged.kind === 'task') {
    merged.remindAt = null;
    merged.endAt = null;
    merged.repeat = 'none';
    merged.advanceMinutes = 0;
  }
  if (!merged.title.trim()) return;
  merged.title = merged.title.trim();
  const send: Partial<TaskInput> = {
    title: merged.title,
    notes: merged.notes,
    kind: merged.kind,
    priority: merged.priority,
    remindAt: merged.remindAt,
    endAt: merged.endAt,
    repeat: merged.repeat,
    advanceMinutes: merged.advanceMinutes,
  };
  setState((state) => ({ tasks: { ...state.tasks, [id]: merged } }));
  pushOp({ kind: 'update', taskId: id, patch: send });
  void flush();
}

export async function toggleTask(task: Task): Promise<void> {
  const done = task.status !== 'done';
  const now = Date.now();
  let next: Task;
  if (!done) {
    next = { ...task, status: 'pending', doneAt: null, updatedAt: now };
  } else if (task.kind === 'reminder' && task.repeat !== 'none' && task.remindAt) {
    const remindAt = repeatAfterNow(task.remindAt, task.repeat, now);
    const delta = remindAt - task.remindAt;
    next = {
      ...task,
      status: 'pending',
      doneAt: null,
      remindAt,
      endAt: task.endAt == null ? null : task.endAt + delta,
      lastNotifiedAt: null,
      updatedAt: now,
    };
  } else {
    next = { ...task, status: 'done', doneAt: now, updatedAt: now };
  }
  setState((state) => ({ tasks: { ...state.tasks, [task.id]: next } }));
  pushOp({ kind: 'complete', taskId: task.id, done });
  void flush();
}

export async function removeTask(id: string): Promise<void> {
  const current = getState().tasks[id];
  if (!current) return;
  setState((state) => {
    const tasks = { ...state.tasks };
    delete tasks[id];
    return { tasks };
  });
  pushOp({ kind: 'delete', taskId: id });
  void flush();
}

export function openSettingsHint(): void {
  addToast({ title: '连接失败', body: '请检查服务器地址和网络连接。' });
}
