package com.shiwu.todo;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class AlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String key = intent.getStringExtra("key");
        if (key == null || key.isEmpty()) key = "alarm-" + System.currentTimeMillis();
        Prefs.markFired(context, key);
        Notifications.show(
                context,
                key,
                intent.getStringExtra("title"),
                intent.getStringExtra("body"),
                intent.getStringExtra("task_id"),
                intent.getLongExtra("occurrence", 0));
        TodoWidgetProvider.updateAll(context);
    }
}
