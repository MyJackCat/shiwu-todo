package com.shiwu.todo;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class ActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (action == null) return;
        final PendingResult pending = goAsync();
        final Context app = context.getApplicationContext();
        final String taskId = intent.getStringExtra("task_id");
        final String notifKey = intent.getStringExtra("notif_key");
        final String title = intent.getStringExtra("title");
        final String body = intent.getStringExtra("body");

        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    if (Notifications.ACTION_COMPLETE.equals(action)) {
                        if (notifKey != null) Notifications.cancel(app, notifKey);
                        String base = Prefs.server(app);
                        String token = Prefs.token(app);
                        if (!base.isEmpty() && !token.isEmpty() && taskId != null) {
                            try {
                                Http.post(base + "/api/tasks/" + taskId + "/complete", token, "{\"done\":true}");
                            } catch (Exception ignored) {
                            }
                        }
                        SyncEngine.sync(app);
                    } else if (Notifications.ACTION_SNOOZE.equals(action)) {
                        if (notifKey != null) Notifications.cancel(app, notifKey);
                        ReminderScheduler.scheduleSnooze(
                                app,
                                notifKey == null ? "snooze" : notifKey,
                                taskId,
                                title == null ? "待办提醒" : title,
                                body == null ? "" : body);
                    }
                } finally {
                    pending.finish();
                }
            }
        }, "shiwu-action").start();
    }
}
