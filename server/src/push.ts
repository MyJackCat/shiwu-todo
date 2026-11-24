import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';
import type { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';

export interface PushSubscriptionInput {
  endpoint: string;
  keys?: { p256dh?: string; auth?: string };
}

export interface PushService {
  publicKey: string;
  subscribe(userId: string, sub: PushSubscriptionInput): void;
  unsubscribe(endpoint: string): void;
  sendToUser(
    userId: string,
    payload: { title: string; body: string; taskId?: string; occurrence?: number },
  ): Promise<void>;
}

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

function loadVapid(dataDir: string): VapidKeys {
  const file = path.join(dataDir, 'vapid.json');
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as VapidKeys;
    if (saved.publicKey && saved.privateKey) return saved;
  } catch {
    // 生成新的 VAPID 密钥
  }
  const keys = webpush.generateVAPIDKeys();
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(keys, null, 2), { mode: 0o600 });
  return keys;
}

export function createPush(db: DatabaseSync, dataDir: string): PushService {
  const keys = loadVapid(dataDir);
  webpush.setVapidDetails('mailto:shiwu-todo@localhost', keys.publicKey, keys.privateKey);

  return {
    publicKey: keys.publicKey,

    subscribe(userId, sub) {
      if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
        throw new Error('订阅信息不完整');
      }
      db.prepare(
        `INSERT INTO push_subs (id, user_id, endpoint, p256dh, auth, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
      ).run(crypto.randomUUID(), userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, Date.now());
    },

    unsubscribe(endpoint) {
      if (!endpoint) return;
      db.prepare(`DELETE FROM push_subs WHERE endpoint = ?`).run(endpoint);
    },

    async sendToUser(userId, payload) {
      const rows = db
        .prepare(`SELECT endpoint, p256dh, auth FROM push_subs WHERE user_id = ?`)
        .all(userId) as Array<{ endpoint: string; p256dh: string; auth: string }>;
      if (rows.length === 0) return;
      const body = JSON.stringify(payload);
      await Promise.all(
        rows.map(async (row) => {
          try {
            await webpush.sendNotification(
              { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
              body,
              { TTL: 3600, urgency: 'high' },
            );
          } catch (err: any) {
            if (err?.statusCode === 404 || err?.statusCode === 410) {
              db.prepare(`DELETE FROM push_subs WHERE endpoint = ?`).run(row.endpoint);
            } else if (process.env.DEBUG_PUSH) {
              console.warn('[push] 发送失败:', err?.statusCode, err?.message);
            }
          }
        }),
      );
    },
  };
}
