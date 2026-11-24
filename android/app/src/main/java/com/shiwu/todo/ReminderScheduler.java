package com.shiwu.todo;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Set;

final class ReminderScheduler {
    static final String ACTION_ALARM = "com.shiwu.todo.ALARM";
    static final String ACTION_SYNC = "com.shiwu.todo.SYNC";
    private static final int SYNC_REQUEST = 990001;

    private ReminderScheduler() {
    }

    static void reschedule(Context context) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) return;
        long now = System.currentTimeMillis();
        boolean canExact = Build.VERSION.SDK_INT < 31 || manager.canScheduleExactAlarms();
        Set<String> wanted = new HashSet<>();

        JSONArray occurrences = readOccurrences(context);
        int scheduled = 0;
        for (int i = 0; i < occurrences.length() && scheduled < 40; i++) {
            JSONObject item = occurrences.optJSONObject(i);
            if (item == null) continue;
            long at = item.optLong("at", 0);
            if (at <= 0 || at < now - 60000L) continue;
            String key = item.optString("key");
            if (key.isEmpty()) continue;
            if (Prefs.wasFired(context, key)) continue;
            wanted.add(key);
            scheduled++;

            Intent intent = new Intent(context, AlarmReceiver.class);
            intent.setAction(ACTION_ALARM);
            intent.putExtra("key", key);
            intent.putExtra("task_id", item.optString("taskId"));
            intent.putExtra("title", item.optString("title"));
            intent.putExtra("body", item.optString("body"));
            intent.putExtra("occurrence", item.optLong("remindAt", at));
            PendingIntent pi = PendingIntent.getBroadcast(context, key.hashCode(), intent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            long triggerAt = Math.max(at, now + 1000);
            try {
                if (canExact) {
                    manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
                } else {
                    manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
                }
            } catch (SecurityException error) {
                Log.w("ShiwuAlarm", "精确闹钟不可用，改用普通闹钟", error);
                manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            }
        }

        for (String oldKey : Prefs.scheduledKeys(context)) {
            if (wanted.contains(oldKey)) continue;
            Intent intent = new Intent(context, AlarmReceiver.class).setAction(ACTION_ALARM);
            PendingIntent pi = PendingIntent.getBroadcast(context, oldKey.hashCode(), intent,
                    PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
            if (pi != null) {
                manager.cancel(pi);
                pi.cancel();
            }
        }
        Prefs.setScheduledKeys(context, wanted);

        Intent sync = new Intent(context, SyncReceiver.class).setAction(ACTION_SYNC);
        PendingIntent syncPi = PendingIntent.getBroadcast(context, SYNC_REQUEST, sync,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        try {
            manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, now + 15 * 60000L, syncPi);
        } catch (Exception ignored) {
        }
    }

    static void cancelAll(Context context) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) return;
        for (String oldKey : Prefs.scheduledKeys(context)) {
            Intent intent = new Intent(context, AlarmReceiver.class).setAction(ACTION_ALARM);
            PendingIntent pi = PendingIntent.getBroadcast(context, oldKey.hashCode(), intent,
                    PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
            if (pi != null) {
                manager.cancel(pi);
                pi.cancel();
            }
        }
        Intent sync = new Intent(context, SyncReceiver.class).setAction(ACTION_SYNC);
        PendingIntent syncPi = PendingIntent.getBroadcast(context, SYNC_REQUEST, sync,
                PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
        if (syncPi != null) manager.cancel(syncPi);
        Prefs.setScheduledKeys(context, new HashSet<>());
    }

    static void scheduleSnooze(Context context, String key, String taskId, String title, String body) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) return;
        long triggerAt = System.currentTimeMillis() + 10 * 60000L;
        String snoozeKey = key + ":snooze:" + triggerAt;
        Intent intent = new Intent(context, AlarmReceiver.class);
        intent.setAction(ACTION_ALARM);
        intent.putExtra("key", snoozeKey);
        intent.putExtra("task_id", taskId);
        intent.putExtra("title", title);
        intent.putExtra("body", body);
        intent.putExtra("occurrence", triggerAt);
        PendingIntent pi = PendingIntent.getBroadcast(context, snoozeKey.hashCode(), intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        boolean canExact = Build.VERSION.SDK_INT < 31 || manager.canScheduleExactAlarms();
        try {
            if (canExact) manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            else manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
        } catch (SecurityException ignored) {
            manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
        }
    }

    private static JSONArray readOccurrences(Context context) {
        try {
            JSONObject snapshot = new JSONObject(Prefs.snapshot(context));
            JSONArray array = snapshot.optJSONArray("occurrences");
            if (array != null) return array;
        } catch (Exception ignored) {
        }
        return new JSONArray();
    }
}
