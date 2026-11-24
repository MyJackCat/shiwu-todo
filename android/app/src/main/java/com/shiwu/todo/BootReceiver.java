package com.shiwu.todo;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        Notifications.ensureChannel(context);
        TodoWidgetProvider.updateAll(context);
        ReminderScheduler.reschedule(context);
        Intent sync = new Intent(context, SyncReceiver.class);
        sync.setAction(ReminderScheduler.ACTION_SYNC);
        context.sendBroadcast(sync);
    }
}
