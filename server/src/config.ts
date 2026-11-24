import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const serverRoot = path.resolve(import.meta.dirname, '..');

function resolveDataDir(): string {
  const dir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(serverRoot, 'data');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export const config = {
  get port(): number {
    return Number(process.env.PORT || 8787);
  },
  get host(): string {
    return process.env.HOST || '0.0.0.0';
  },
  dataDir: resolveDataDir(),
  webDist: process.env.WEB_DIST ? path.resolve(process.env.WEB_DIST) : path.resolve(serverRoot, '../web/dist'),
};

export function getDbFile(): string {
  return process.env.DB_FILE ? path.resolve(process.env.DB_FILE) : path.join(config.dataDir, 'todo.db');
}

export function getSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(config.dataDir, 'secret.key');
  try {
    const saved = fs.readFileSync(file, 'utf8').trim();
    if (saved.length >= 32) return saved;
  } catch {
    // 首次启动，生成新密钥
  }
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}
