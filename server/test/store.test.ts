import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, nextOccurrence, createUser, createTask, updateTask, completeTask, deleteTask, listChanges } from '../src/store.ts';

test('重复规则：每天 / 每周 / 工作日 / 每月', () => {
  const base = new Date(2026, 10, 24, 9, 0, 0).getTime(); // 2026-11-24 09:00 周二
  assert.equal(new Date(nextOccurrence(base, 'daily', base)).getDate(), 25);
  assert.equal(new Date(nextOccurrence(base, 'weekly', base)).getDate(), 1);
  const friday = new Date(2026, 10, 27, 9, 0, 0).getTime(); // 周五
  const monday = new Date(nextOccurrence(friday, 'weekdays', friday));
  assert.equal(monday.getDay(), 1);
  const jan31 = new Date(2027, 0, 31, 9, 0, 0).getTime();
  const feb = new Date(nextOccurrence(jan31, 'monthly', jan31));
  assert.equal(feb.getMonth(), 1);
  assert.equal(feb.getDate(), 28);
});

test('待办增删改查与增量同步序号', () => {
  const db = openDb(':memory:');
  const user = createUser(db, { email: 'a@b.com', name: 'A', pw: 'x' });
  const t1 = createTask(db, user.id, { title: '买菜' });
  assert.equal(t1.title, '买菜');
  assert.equal(t1.kind, 'task');
  assert.ok(t1.seq > 0);

  const t2 = createTask(db, user.id, {
    title: '开会',
    kind: 'reminder',
    remindAt: Date.now() + 60000,
    endAt: Date.now() + 120000,
    repeat: 'daily',
    advanceMinutes: 5,
  });
  assert.equal(t2.kind, 'reminder');
  assert.equal(t2.repeat, 'daily');

  const changes1 = listChanges(db, user.id, 0);
  assert.equal(changes1.tasks.length, 2);
  assert.equal(changes1.serverSeq, t2.seq);

  const updated = updateTask(db, user.id, t1.id, { title: '买菜和水果', priority: 2 });
  assert.equal(updated?.title, '买菜和水果');
  assert.ok(updated!.seq > t2.seq);

  const delta = listChanges(db, user.id, t2.seq);
  assert.equal(delta.tasks.length, 1);
  assert.equal(delta.tasks[0].id, t1.id);

  const done = completeTask(db, user.id, t1.id, true);
  assert.equal(done?.status, 'done');

  deleteTask(db, user.id, t2.id);
  const afterDelete = listChanges(db, user.id, delta.serverSeq);
  assert.equal(afterDelete.tasks.length, 2);
  const deletedTask = afterDelete.tasks.find((item) => item.id === t2.id);
  assert.ok(deletedTask?.deletedAt);

  db.close();
});

test('重复提醒完成时滚动到下一次而不是归档', () => {
  const db = openDb(':memory:');
  const user = createUser(db, { email: 'r@b.com', name: 'R', pw: 'x' });
  const remindAt = Date.now() + 3600_000;
  const task = createTask(db, user.id, {
    title: '喝水',
    kind: 'reminder',
    remindAt,
    repeat: 'daily',
  });
  const next = completeTask(db, user.id, task.id, true, remindAt + 1000);
  assert.equal(next?.status, 'pending');
  assert.ok(next!.remindAt! > remindAt);
  db.close();
});

test('提醒必须带时间，事务待办会清空时间字段', () => {
  const db = openDb(':memory:');
  const user = createUser(db, { email: 'c@b.com', name: 'C', pw: 'x' });
  assert.throws(() => createTask(db, user.id, { title: '没有时间', kind: 'reminder' }));
  const task = createTask(db, user.id, {
    title: '普通事务',
    kind: 'task',
    remindAt: Date.now(),
    repeat: 'daily',
  });
  assert.equal(task.remindAt, null);
  assert.equal(task.repeat, 'none');
  db.close();
});
