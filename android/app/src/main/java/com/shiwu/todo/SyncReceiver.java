package com.shiwu.todo;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class SyncReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        final PendingResult pending = goAsync();
        final Context app = context.getApplicationContext();
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    SyncEngine.sync(app);
                } finally {
                    ReminderScheduler.reschedule(app);
                    pending.finish();
                }
            }
        }, "shiwu-sync").start();
    }
}
