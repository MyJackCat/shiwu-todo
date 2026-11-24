import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../src/app.ts';
import { openDb } from '../src/store.ts';
import { Hub } from '../src/hub.ts';
import type { PushService } from '../src/push.ts';

const db = openDb(':memory:');
const push: PushService = {
  publicKey: 'test-key',
  subscribe() {},
  unsubscribe() {},
  async sendToUser() {},
};
const app = createApp({ db, hub: new Hub(), push, secret: 'test-secret' });

let server: Server;
let base = '';

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

after(() => {
  server.close();
  db.close();
});

async function call(path: string, init: RequestInit = {}, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...(init.headers as any) } });
  const body: any = await res.json().catch(() => null);
  return { status: res.status, body };
}

test('注册、登录与鉴权', async () => {
  const register = await call('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email: 'user@test.com', password: 'secret123', name: '测试' }),
  });
  assert.equal(register.status, 201);
  assert.ok(register.body.token);
  assert.equal(register.body.user.email, 'user@test.com');

  const duplicate = await call('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email: 'user@test.com', password: 'secret123' }),
  });
  assert.equal(duplicate.status, 409);

  const badLogin = await call('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'user@test.com', password: 'wrong' }),
  });
  assert.equal(badLogin.status, 401);

  const login = await call('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'user@test.com', password: 'secret123' }),
  });
  assert.equal(login.status, 200);
  const token = login.body.token as string;

  const unauthorized = await call('/api/changes?since=0');
  assert.equal(unauthorized.status, 401);

  const me = await call('/api/me', {}, token);
  assert.equal(me.status, 200);
  assert.equal(me.body.user.name, '测试');
});

test('任务生命周期与增量同步', async () => {
  const login = await call('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'user@test.com', password: 'secret123' }),
  });
  const token = login.body.token as string;

  const created = await call(
    '/api/tasks',
    {
      method: 'POST',
      body: JSON.stringify({ id: '11111111-aaaa-bbbb-cccc-222222222222', title: '写周报' }),
    },
    token,
  );
  assert.equal(created.status, 201);
  assert.equal(created.body.task.title, '写周报');
  const taskId = created.body.task.id as string;
  const firstSeq = created.body.task.seq as number;

  // 幂等：重复提交同一个 id 不会创建新记录
  const again = await call(
    '/api/tasks',
    { method: 'POST', body: JSON.stringify({ id: taskId, title: '重复提交' }) },
    token,
  );
  assert.equal(again.status, 201);
  assert.equal(again.body.task.title, '写周报');

  const changes = await call('/api/changes?since=0', {}, token);
  assert.equal(changes.status, 200);
  assert.equal(changes.body.tasks.length, 1);
  assert.equal(changes.body.serverSeq, firstSeq);

  const patched = await call(
    `/api/tasks/${taskId}`,
    { method: 'PATCH', body: JSON.stringify({ title: '写周报并发送', priority: 3 }) },
    token,
  );
  assert.equal(patched.status, 200);
  assert.equal(patched.body.task.title, '写周报并发送');

  const reminder = await call(
    '/api/tasks',
    {
      method: 'POST',
      body: JSON.stringify({
        title: '项目例会',
        kind: 'reminder',
        remindAt: Date.now() + 3_600_000,
        endAt: Date.now() + 7_200_000,
        repeat: 'weekly',
      }),
    },
    token,
  );
  assert.equal(reminder.status, 201);
  assert.equal(reminder.body.task.repeat, 'weekly');

  const done = await call(`/api/tasks/${taskId}/complete`, { method: 'POST', body: JSON.stringify({ done: true }) }, token);
  assert.equal(done.status, 200);
  assert.equal(done.body.task.status, 'done');

  const removed = await call(`/api/tasks/${taskId}`, { method: 'DELETE' }, token);
  assert.equal(removed.status, 200);
  assert.ok(removed.body.task.deletedAt);

  const delta = await call(`/api/changes?since=${firstSeq}`, {}, token);
  assert.ok(delta.body.tasks.every((t: any) => t.seq > firstSeq));
  const deleted = delta.body.tasks.find((t: any) => t.id === taskId);
  assert.ok(deleted?.deletedAt);

  const missing = await call('/api/tasks/not-exist/complete', { method: 'POST', body: '{}' }, token);
  assert.equal(missing.status, 404);
});

test('参数校验', async () => {
  const login = await call('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'user@test.com', password: 'secret123' }),
  });
  const token = login.body.token as string;

  const noTitle = await call('/api/tasks', { method: 'POST', body: JSON.stringify({ title: '  ' }) }, token);
  assert.equal(noTitle.status, 400);

  const badReminder = await call(
    '/api/tasks',
    { method: 'POST', body: JSON.stringify({ title: '提醒', kind: 'reminder' }) },
    token,
  );
  assert.equal(badReminder.status, 400);

  const badEmail = await call('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email: 'nope', password: '123456' }),
  });
  assert.equal(badEmail.status, 400);
});
