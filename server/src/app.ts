import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import type { DatabaseSync } from 'node:sqlite';
import { hashPassword, signToken, verifyPassword, verifyToken } from './auth.ts';
import { Hub } from './hub.ts';
import type { PushService } from './push.ts';
import {
  completeTask,
  createTask,
  createUser,
  deleteTask,
  findUserByEmail,
  findUserById,
  listChanges,
  updateTask,
  type Task,
  type User,
} from './store.ts';
import { HttpError } from './util.ts';

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export interface AppOptions {
  db: DatabaseSync;
  hub: Hub;
  push: PushService;
  secret: string;
  webDist?: string;
}

function publicUser(user: User) {
  return { id: user.id, email: user.email, name: user.name };
}

function asTaskJson(task: Task) {
  return {
    id: task.id,
    title: task.title,
    notes: task.notes,
    kind: task.kind,
    status: task.status,
    priority: task.priority,
    remindAt: task.remindAt,
    endAt: task.endAt,
    repeat: task.repeat,
    advanceMinutes: task.advanceMinutes,
    lastNotifiedAt: task.lastNotifiedAt,
    doneAt: task.doneAt,
    deletedAt: task.deletedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    seq: task.seq,
    userId: task.userId,
  };
}

function formatTime(ts: number | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function reminderBody(task: Task): string {
  const range = task.endAt ? `${formatTime(task.remindAt)} - ${formatTime(task.endAt)}` : formatTime(task.remindAt);
  return range ? `提醒 · ${range}` : '待办提醒';
}

export function createApp(opts: AppOptions): express.Express {
  const { db, hub, push, secret } = opts;
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: true, credentials: false, allowedHeaders: ['Content-Type', 'Authorization'] }));
  app.use(express.json({ limit: '1mb' }));

  const attempts = new Map<string, { count: number; reset: number }>();
  function rateLimit(req: Request, limit = 30, windowMs = 10 * 60_000): void {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const entry = attempts.get(key);
    if (!entry || entry.reset < now) {
      attempts.set(key, { count: 1, reset: now + windowMs });
      return;
    }
    entry.count += 1;
    if (entry.count > limit) throw new HttpError(429, '尝试次数过多，请稍后再试');
  }

  function auth(req: Request, _res: Response, next: NextFunction): void {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const payload = verifyToken(token, secret);
    if (!payload) return next(new HttpError(401, '登录状态已失效，请重新登录'));
    const user = findUserById(db, payload.sub);
    if (!user) return next(new HttpError(401, '用户不存在'));
    req.user = user;
    next();
  }

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, time: Date.now(), name: 'shiwu-todo' });
  });

  // ---------- 认证 ----------
  app.post('/api/auth/register', (req, res) => {
    rateLimit(req);
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    const name = String(req.body?.name ?? '').trim() || email.split('@')[0] || '我';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, '请输入正确的邮箱地址');
    if (password.length < 6) throw new HttpError(400, '密码至少 6 位');
    if (findUserByEmail(db, email)) throw new HttpError(409, '该邮箱已注册');
    if (process.env.ALLOW_REGISTER === '0') throw new HttpError(403, '服务器已关闭注册');
    const user = createUser(db, { email, name, pw: hashPassword(password) });
    res.status(201).json({ token: signToken(user.id, secret), user: publicUser(user) });
  });

  app.post('/api/auth/login', (req, res) => {
    rateLimit(req);
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    const found = findUserByEmail(db, email);
    if (!found || !verifyPassword(password, found.pw)) throw new HttpError(401, '邮箱或密码不正确');
    res.json({ token: signToken(found.id, secret), user: publicUser(found) });
  });

  app.get('/api/me', auth, (req, res) => {
    res.json({ user: publicUser(req.user!) });
  });

  // ---------- 任务 ----------
  app.get('/api/changes', auth, (req, res) => {
    const since = Number(req.query.since ?? 0);
    if (!Number.isFinite(since) || since < 0) throw new HttpError(400, 'since 参数不正确');
    const result = listChanges(db, req.user!.id, Math.floor(since));
    res.json({ serverSeq: result.serverSeq, tasks: result.tasks.map(asTaskJson) });
  });

  app.post('/api/tasks', auth, (req, res) => {
    const task = createTask(db, req.user!.id, req.body ?? {});
    hub.send(req.user!.id, { type: 'change', seq: task.seq });
    res.status(201).json({ task: asTaskJson(task) });
  });

  app.patch('/api/tasks/:id', auth, (req, res) => {
    const task = updateTask(db, req.user!.id, String(req.params.id), req.body ?? {});
    if (!task) throw new HttpError(404, '待办不存在');
    hub.send(req.user!.id, { type: 'change', seq: task.seq });
    res.json({ task: asTaskJson(task) });
  });

  app.post('/api/tasks/:id/complete', auth, (req, res) => {
    const done = req.body?.done !== false;
    const task = completeTask(db, req.user!.id, String(req.params.id), done);
    if (!task) throw new HttpError(404, '待办不存在');
    hub.send(req.user!.id, { type: 'change', seq: task.seq });
    res.json({ task: asTaskJson(task) });
  });

  app.delete('/api/tasks/:id', auth, (req, res) => {
    const task = deleteTask(db, req.user!.id, String(req.params.id));
    if (!task) throw new HttpError(404, '待办不存在');
    hub.send(req.user!.id, { type: 'change', seq: task.seq });
    res.json({ ok: true, task: asTaskJson(task) });
  });

  // ---------- 实时事件 ----------
  app.get('/api/events', (req, res) => {
    const payload = verifyToken(String(req.query.token ?? ''), secret);
    if (!payload) return res.status(401).end();
    const user = findUserById(db, payload.sub);
    if (!user) return res.status(401).end();

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': req.headers.origin || '*',
    });
    res.write('retry: 3000\n\n');
    res.write(`data: ${JSON.stringify({ type: 'ready' })}\n\n`);
    const client = hub.add(user.id, res);
    const heart = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        // 连接已断开
      }
    }, 25000);
    heart.unref?.();
    req.on('close', () => {
      clearInterval(heart);
      hub.remove(user.id, client);
    });
  });

  // ---------- Web Push ----------
  app.get('/api/push/key', auth, (_req, res) => {
    res.json({ publicKey: push.publicKey });
  });

  app.post('/api/push/subscribe', auth, (req, res) => {
    const sub = req.body?.subscription ?? req.body;
    try {
      push.subscribe(req.user!.id, sub);
    } catch (err: any) {
      throw new HttpError(400, err?.message || '订阅失败');
    }
    res.json({ ok: true });
  });

  app.post('/api/push/unsubscribe', auth, (req, res) => {
    push.unsubscribe(String(req.body?.endpoint ?? ''));
    res.json({ ok: true });
  });

  // ---------- 网页与 PWA ----------
  const webDist = opts.webDist;
  if (webDist && fs.existsSync(webDist)) {
    app.use(
      express.static(webDist, {
        setHeaders(res, filePath) {
          if (filePath.endsWith('sw.js') || filePath.endsWith('index.html') || filePath.endsWith('manifest.webmanifest')) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      }),
    );
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
      const accepts = String(req.headers.accept ?? '');
      if (!accepts.includes('text/html')) return next();
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  // ---------- 错误处理 ----------
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: '接口不存在' });
  });

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err?.type === 'entity.parse.failed') {
      res.status(400).json({ error: '请求格式不正确' });
      return;
    }
    console.error('[server] 未处理的错误:', err);
    res.status(500).json({ error: '服务器内部错误' });
  });

  return app;
}
