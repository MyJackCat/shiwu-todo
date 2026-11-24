import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTask, createUser, getTask, openDb } from '../src/store.ts';
import { runReminderTick } from '../src/scheduler.ts';

function setup() {
  const db = openDb(':memory:');
  const user = createUser(db, { email: 'x@y.com', name: 'X', pw: 'x' });
  return { db, user };
}

test('到点只提醒一次', async () => {
  const { db, user } = setup();
  const now = Date.now();
  const task = createTask(db, user.id, { title: '开会', kind: 'reminder', remindAt: now - 1000 }, now);
  const fired: Array<{ id: string; at: number }> = [];
  const hooks = {
    notify(t: any, occurrence: number) {
      fired.push({ id: t.id, at: occurrence });
    },
    changed() {},
  };

  assert.equal(await runReminderTick(db, hooks, now), 1);
  assert.equal(fired.length, 1);
  assert.equal(fired[0].id, task.id);
  assert.equal(await runReminderTick(db, hooks, now + 1000), 0);

  // 完成后的提醒不再触发
  const second = createTask(db, user.id, { title: '吃药', kind: 'reminder', remindAt: now - 500 }, now);
  db.prepare(`UPDATE tasks SET status = 'done' WHERE id = ?`).run(second.id);
  assert.equal(await runReminderTick(db, hooks, now + 2000), 0);
  db.close();
});

test('重复提醒通知后滚动到下一次，并广播变更', async () => {
  const { db, user } = setup();
  const now = Date.now();
  const task = createTask(
    db,
    user.id,
    { title: '喝水', kind: 'reminder', remindAt: now - 60_000, endAt: now + 60_000, repeat: 'daily' },
    now,
  );
  const changed: number[] = [];
  const hooks = {
    notify() {},
    changed(_userId: string, seq: number) {
      changed.push(seq);
    },
  };

  await runReminderTick(db, hooks, now);
  const updated = getTask(db, user.id, task.id)!;
  assert.ok(updated.remindAt! > now);
  assert.equal(updated.repeat, 'daily');
  assert.ok(updated.endAt! > updated.remindAt!);
  assert.equal(changed.length, 1);
  assert.ok(updated.seq >= changed[0]);

  // 下一天的下一次提醒不会被提前触发
  assert.equal(await runReminderTick(db, hooks, now + 60_000), 0);
  db.close();
});

test('提前提醒：在提前量内触发', async () => {
  const { db, user } = setup();
  const now = Date.now();
  createTask(
    db,
    user.id,
    { title: '提前十分钟', kind: 'reminder', remindAt: now + 8 * 60_000, advanceMinutes: 10 },
    now,
  );
  let count = 0;
  await runReminderTick(db, { notify() { count += 1; }, changed() {} }, now);
  assert.equal(count, 1);
  db.close();
});

test('带提前量的重复提醒不会卡住', async () => {
  const { db, user } = setup();
  const now = Date.now();
  const task = createTask(
    db,
    user.id,
    {
      title: '提前通知的每日提醒',
      kind: 'reminder',
      remindAt: now + 5 * 60_000,
      advanceMinutes: 10,
      repeat: 'daily',
    },
    now,
  );
  let count = 0;
  const hooks = {
    notify() {
      count += 1;
    },
    changed() {},
  };

  // 提前量已到，先通知，但还没到点，不滚动
  assert.equal(await runReminderTick(db, hooks, now), 1);
  assert.equal(getTask(db, user.id, task.id)!.remindAt! > now, true);

  // 到点后不应再次通知，同时必须滚动到第二天
  count = 0;
  assert.equal(await runReminderTick(db, hooks, now + 6 * 60_000), 0);
  const rolled = getTask(db, user.id, task.id)!;
  assert.equal(count, 0);
  assert.ok(rolled.remindAt! > now + 24 * 3600_000 - 60_000);
  db.close();
});

test('停服很久后的重复提醒直接跳到下一次，不补发', async () => {
  const { db, user } = setup();
  const now = Date.now();
  const task = createTask(
    db,
    user.id,
    { title: '停服后的提醒', kind: 'reminder', remindAt: now - 3 * 24 * 3600_000, repeat: 'daily' },
    now,
  );
  let count = 0;
  await runReminderTick(db, { notify() { count += 1; }, changed() {} }, now);
  assert.equal(count, 0);
  const rolled = getTask(db, user.id, task.id)!;
  assert.ok(rolled.remindAt! > now);
  db.close();
});

test('太久以前错过的提醒只补发 6 小时内的', async () => {
  const { db, user } = setup();
  const now = Date.now();
  createTask(db, user.id, { title: '昨天的提醒', kind: 'reminder', remindAt: now - 24 * 3600_000 }, now);
  let count = 0;
  await runReminderTick(db, { notify() { count += 1; }, changed() {} }, now);
  assert.equal(count, 0);
  db.close();
});
