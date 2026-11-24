import type { DatabaseSync } from 'node:sqlite';
import { nextOccurrence, nextSeq, rowToTask, tx, type Task } from './store.ts';

export interface ReminderHooks {
  notify: (task: Task, occurrence: number) => void | Promise<void>;
  changed: (userId: string, seq: number) => void;
}

export const REMINDER_GRACE_MS = 6 * 60 * 60 * 1000;

/**
 * 扫描到期提醒：
 * - 到点（或提前量到点）只通知一次，服务重启后最多补发 6 小时内错过的提醒；
 * - 重复提醒在时间过去后滚到下一次，即使已经提前通知过也照样滚动；
 * - 错过太久的重复提醒直接跳到下一次，不补发。
 */
export async function runReminderTick(
  db: DatabaseSync,
  hooks: ReminderHooks,
  now: number = Date.now(),
): Promise<number> {
  const rows = db
    .prepare(
      `SELECT * FROM tasks
       WHERE kind = 'reminder' AND status = 'pending' AND deleted_at IS NULL AND remind_at IS NOT NULL
         AND remind_at - advance_minutes * 60000 <= ?`,
    )
    .all(now) as Array<Record<string, any>>;

  let fired = 0;
  for (const row of rows) {
    const task = rowToTask(row);
    if (task.remindAt == null) continue;
    const occurrence = task.remindAt;
    const alreadyNotified = task.lastNotifiedAt != null && task.lastNotifiedAt >= occurrence;
    const withinGrace = occurrence > now - REMINDER_GRACE_MS;

    if (!alreadyNotified && withinGrace) {
      await hooks.notify(task, occurrence);
      fired += 1;
      db.prepare(`UPDATE tasks SET last_notified_at = ? WHERE id = ?`).run(occurrence, task.id);
    }

    if (task.repeat !== 'none' && occurrence <= now) {
      const next = nextOccurrence(occurrence, task.repeat, now);
      const delta = next - occurrence;
      const seq = tx(db, () => nextSeq(db));
      db.prepare(
        `UPDATE tasks SET remind_at = ?, end_at = ?, last_notified_at = NULL, updated_at = ?, seq = ? WHERE id = ?`,
      ).run(next, task.endAt == null ? null : task.endAt + delta, now, seq, task.id);
      hooks.changed(task.userId, seq);
    }
  }
  return fired;
}

export function startReminderLoop(db: DatabaseSync, hooks: ReminderHooks, intervalMs = 15000): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    runReminderTick(db, hooks)
      .catch((err) => console.error('[提醒调度] 出错:', err))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
