import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { HttpError } from './util.ts';

export type TaskKind = 'task' | 'reminder';
export type TaskStatus = 'pending' | 'done';
export type Repeat = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly';

export const REPEATS: Repeat[] = ['none', 'daily', 'weekdays', 'weekly', 'monthly'];

export interface Task {
  id: string;
  userId: string;
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
  createdAt: number;
}

export interface TaskFields {
  title: string;
  notes: string;
  kind: TaskKind;
  status: TaskStatus;
  priority: number;
  remindAt: number | null;
  endAt: number | null;
  repeat: Repeat;
  advanceMinutes: number;
}

type Row = Record<string, any>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  pw TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT OR IGNORE INTO counters(name, value) VALUES ('seq', 0);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'task',
  status TEXT NOT NULL DEFAULT 'pending',
  priority INTEGER NOT NULL DEFAULT 0,
  remind_at INTEGER,
  end_at INTEGER,
  repeat TEXT NOT NULL DEFAULT 'none',
  advance_minutes INTEGER NOT NULL DEFAULT 0,
  last_notified_at INTEGER,
  done_at INTEGER,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  seq INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_user_seq ON tasks(user_id, seq);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(kind, status, remind_at);
CREATE TABLE IF NOT EXISTS push_subs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_endpoint ON push_subs(endpoint);
`;

export function openDb(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

export function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // 忽略回滚失败
    }
    throw err;
  }
}

export function nextSeq(db: DatabaseSync): number {
  const row = db.prepare(`SELECT value FROM counters WHERE name = 'seq'`).get() as { value: number };
  const value = Number(row?.value ?? 0) + 1;
  db.prepare(`UPDATE counters SET value = ? WHERE name = 'seq'`).run(value);
  return value;
}

export function rowToTask(row: Row): Task {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    notes: row.notes,
    kind: row.kind,
    status: row.status,
    priority: Number(row.priority),
    remindAt: row.remind_at == null ? null : Number(row.remind_at),
    endAt: row.end_at == null ? null : Number(row.end_at),
    repeat: row.repeat,
    advanceMinutes: Number(row.advance_minutes),
    lastNotifiedAt: row.last_notified_at == null ? null : Number(row.last_notified_at),
    doneAt: row.done_at == null ? null : Number(row.done_at),
    deletedAt: row.deleted_at == null ? null : Number(row.deleted_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    seq: Number(row.seq),
  };
}

const EMPTY_FIELDS: TaskFields = {
  title: '',
  notes: '',
  kind: 'task',
  status: 'pending',
  priority: 0,
  remindAt: null,
  endAt: null,
  repeat: 'none',
  advanceMinutes: 0,
};

function toTimestamp(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Date.parse(String(value));
  return Number.isFinite(n) ? Math.round(n) : null;
}

function normalizeFields(input: Record<string, any>, base: TaskFields): TaskFields {
  const pick = (key: keyof TaskFields): any => (key in input ? input[key] : base[key]);

  const title = String(pick('title') ?? '').trim().slice(0, 200);
  const notes = String(pick('notes') ?? '').slice(0, 5000);
  const kind: TaskKind = pick('kind') === 'reminder' ? 'reminder' : 'task';
  const status: TaskStatus = pick('status') === 'done' ? 'done' : 'pending';
  const priority = Math.max(0, Math.min(3, Math.round(Number(pick('priority')) || 0)));
  const repeat = REPEATS.includes(pick('repeat')) ? (pick('repeat') as Repeat) : 'none';
  const advanceMinutes = Math.max(0, Math.min(1440, Math.round(Number(pick('advanceMinutes')) || 0)));
  let remindAt = toTimestamp(pick('remindAt'));
  let endAt = toTimestamp(pick('endAt'));

  if (!title) throw new HttpError(400, '标题不能为空');
  if (kind === 'task') {
    remindAt = null;
    endAt = null;
  } else {
    if (!remindAt) throw new HttpError(400, '提醒事项需要设置提醒时间');
    if (endAt && endAt < remindAt) throw new HttpError(400, '结束时间不能早于开始时间');
  }
  if (kind === 'task' && repeat !== 'none') {
    // 事务待办不重复
  }

  return {
    title,
    notes,
    kind,
    status,
    priority,
    remindAt,
    endAt: kind === 'reminder' ? endAt : null,
    repeat: kind === 'reminder' ? repeat : 'none',
    advanceMinutes: kind === 'reminder' ? advanceMinutes : 0,
  };
}

export function getTaskRow(db: DatabaseSync, id: string): Row | undefined {
  return db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as Row | undefined;
}

export function getTask(db: DatabaseSync, userId: string, id: string): Task | null {
  const row = getTaskRow(db, id);
  if (!row || row.user_id !== userId || row.deleted_at != null) return null;
  return rowToTask(row);
}

export function createTask(db: DatabaseSync, userId: string, input: Record<string, any>, now = Date.now()): Task {
  const rawId = typeof input?.id === 'string' ? input.id.trim() : '';
  const id = /^[0-9a-zA-Z-]{8,64}$/.test(rawId) ? rawId : crypto.randomUUID();
  const existing = getTaskRow(db, id);
  if (existing) {
    if (existing.user_id !== userId) throw new HttpError(409, 'ID 已被占用');
    return rowToTask(existing);
  }
  const f = normalizeFields(input ?? {}, EMPTY_FIELDS);
  const seq = tx(db, () => nextSeq(db));
  db.prepare(
    `INSERT INTO tasks (id, user_id, title, notes, kind, status, priority, remind_at, end_at, repeat,
      advance_minutes, last_notified_at, done_at, deleted_at, created_at, updated_at, seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?)`,
  ).run(
    id,
    userId,
    f.title,
    f.notes,
    f.kind,
    f.status,
    f.priority,
    f.remindAt,
    f.endAt,
    f.repeat,
    f.advanceMinutes,
    f.status === 'done' ? now : null,
    now,
    now,
    seq,
  );
  return rowToTask(getTaskRow(db, id)!);
}

export function updateTask(
  db: DatabaseSync,
  userId: string,
  id: string,
  patch: Record<string, any>,
  now = Date.now(),
): Task | null {
  const row = getTaskRow(db, id);
  if (!row || row.user_id !== userId || row.deleted_at != null) return null;
  const base = rowToTask(row);
  const f = normalizeFields(patch ?? {}, base);
  const resetNotify = f.remindAt !== base.remindAt;
  const doneAt = f.status === 'done' ? (base.doneAt ?? now) : null;
  const seq = tx(db, () => nextSeq(db));
  db.prepare(
    `UPDATE tasks SET title = ?, notes = ?, kind = ?, status = ?, priority = ?, remind_at = ?, end_at = ?,
      repeat = ?, advance_minutes = ?, last_notified_at = ?, done_at = ?, updated_at = ?, seq = ? WHERE id = ?`,
  ).run(
    f.title,
    f.notes,
    f.kind,
    f.status,
    f.priority,
    f.remindAt,
    f.endAt,
    f.repeat,
    f.advanceMinutes,
    resetNotify ? null : base.lastNotifiedAt,
    doneAt,
    now,
    seq,
    id,
  );
  return rowToTask(getTaskRow(db, id)!);
}

export function completeTask(db: DatabaseSync, userId: string, id: string, done: boolean, now = Date.now()): Task | null {
  const row = getTaskRow(db, id);
  if (!row || row.user_id !== userId || row.deleted_at != null) return null;
  const task = rowToTask(row);
  const seq = tx(db, () => nextSeq(db));

  if (!done) {
    db.prepare(`UPDATE tasks SET status = 'pending', done_at = NULL, updated_at = ?, seq = ? WHERE id = ?`).run(
      now,
      seq,
      id,
    );
    return rowToTask(getTaskRow(db, id)!);
  }

  if (task.kind === 'reminder' && task.repeat !== 'none' && task.remindAt) {
    const next = nextOccurrence(task.remindAt, task.repeat, now);
    const delta = next - task.remindAt;
    db.prepare(
      `UPDATE tasks SET remind_at = ?, end_at = ?, last_notified_at = NULL, status = 'pending', done_at = NULL,
        updated_at = ?, seq = ? WHERE id = ?`,
    ).run(next, task.endAt == null ? null : task.endAt + delta, now, seq, id);
  } else {
    db.prepare(`UPDATE tasks SET status = 'done', done_at = ?, updated_at = ?, seq = ? WHERE id = ?`).run(
      now,
      now,
      seq,
      id,
    );
  }
  return rowToTask(getTaskRow(db, id)!);
}

export function deleteTask(db: DatabaseSync, userId: string, id: string, now = Date.now()): Task | null {
  const row = getTaskRow(db, id);
  if (!row || row.user_id !== userId) return null;
  if (row.deleted_at == null) {
    const seq = tx(db, () => nextSeq(db));
    db.prepare(`UPDATE tasks SET deleted_at = ?, updated_at = ?, seq = ? WHERE id = ?`).run(now, now, seq, id);
  }
  return rowToTask(getTaskRow(db, id)!);
}

export function listChanges(
  db: DatabaseSync,
  userId: string,
  since: number,
): { serverSeq: number; tasks: Task[] } {
  const rows = db.prepare(`SELECT * FROM tasks WHERE user_id = ? AND seq > ? ORDER BY seq ASC`).all(
    userId,
    since,
  ) as Row[];
  const maxRow = db.prepare(`SELECT COALESCE(MAX(seq), 0) AS m FROM tasks WHERE user_id = ?`).get(userId) as {
    m: number;
  };
  return { serverSeq: Number(maxRow?.m ?? 0), tasks: rows.map(rowToTask) };
}

export function createUser(
  db: DatabaseSync,
  input: { email: string; name: string; pw: string },
  now = Date.now(),
): User {
  const id = crypto.randomUUID();
  tx(db, () => {
    db.prepare(`INSERT INTO users (id, email, name, pw, created_at) VALUES (?, ?, ?, ?, ?)`).run(
      id,
      input.email,
      input.name,
      input.pw,
      now,
    );
  });
  return { id, email: input.email, name: input.name, createdAt: now };
}

export function findUserByEmail(db: DatabaseSync, email: string): (User & { pw: string }) | null {
  const row = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email) as Row | undefined;
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    createdAt: Number(row.created_at),
    pw: row.pw,
  };
}

export function findUserById(db: DatabaseSync, id: string): User | null {
  const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as Row | undefined;
  if (!row) return null;
  return { id: row.id, email: row.email, name: row.name, createdAt: Number(row.created_at) };
}

export function nextOccurrence(at: number, repeat: Repeat, from: number): number {
  if (repeat === 'none') return at;
  const d = new Date(at);
  for (let i = 0; i < 600; i += 1) {
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
    if (d.getTime() > from) return d.getTime();
  }
  return d.getTime();
}
