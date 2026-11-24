import os from 'node:os';
import { config, getDbFile, getSecret } from './config.ts';
import { createApp, reminderBody } from './app.ts';
import { createPush } from './push.ts';
import { Hub } from './hub.ts';
import { openDb } from './store.ts';
import { runReminderTick, startReminderLoop, type ReminderHooks } from './scheduler.ts';

const db = openDb(getDbFile());
const secret = getSecret();
const hub = new Hub();
const push = createPush(db, config.dataDir);
const app = createApp({ db, hub, push, secret, webDist: config.webDist });

const hooks: ReminderHooks = {
  async notify(task, occurrence) {
    hub.send(task.userId, { type: 'reminder', occurrence, task });
    await push.sendToUser(task.userId, {
      title: task.title,
      body: reminderBody(task),
      taskId: task.id,
      occurrence,
    });
    console.log(`[提醒] ${task.title} (${new Date(occurrence).toLocaleString('zh-CN')})`);
  },
  changed(userId, seq) {
    hub.send(userId, { type: 'change', seq });
  },
};

const server = app.listen(config.port, config.host, () => {
  console.log('');
  console.log('  事务待办 · 同步服务已启动');
  console.log(`  本机:   http://localhost:${config.port}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family === 'IPv4' && !item.internal) {
        console.log(`  局域网: http://${item.address}:${config.port}`);
      }
    }
  }
  console.log(`  数据:   ${getDbFile()}`);
  console.log('');
  // 启动时先补发停服期间错过的提醒
  runReminderTick(db, hooks).catch((err) => console.error('[提醒调度] 启动扫描失败:', err));
});

const stopLoop = startReminderLoop(db, hooks);

function shutdown() {
  stopLoop();
  server.close(() => {
    try {
      db.close();
    } catch {
      // 忽略
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
