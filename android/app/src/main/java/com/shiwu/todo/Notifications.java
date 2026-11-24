package com.shiwu.todo;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.drawable.Icon;

final class Notifications {
    static final String CHANNEL = "reminders";
    static final String ACTION_COMPLETE = "com.shiwu.todo.COMPLETE";
    static final String ACTION_SNOOZE = "com.shiwu.todo.SNOOZE";

    private Notifications() {
    }

    static void ensureChannel(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL, "到点提醒", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("待办的定时提醒");
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[]{0, 250, 150, 250});
        channel.setShowBadge(true);
        manager.createNotificationChannel(channel);
    }

    static void show(Context context, String key, String title, String body, String taskId, long occurrence) {
        if (title == null || title.isEmpty()) title = "待办提醒";
        if (body == null) body = "";
        if (android.os.Build.VERSION.SDK_INT >= 33
                && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        ensureChannel(context);

        Intent openIntent = new Intent(context, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (taskId != null) openIntent.putExtra("task_id", taskId);
        PendingIntent contentIntent = PendingIntent.getActivity(
                context, key.hashCode(), openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent doneIntent = new Intent(context, ActionReceiver.class);
        doneIntent.setAction(ACTION_COMPLETE);
        doneIntent.putExtra("task_id", taskId);
        doneIntent.putExtra("notif_key", key);
        PendingIntent donePi = PendingIntent.getBroadcast(
                context, (key + ":done").hashCode(), doneIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent snoozeIntent = new Intent(context, ActionReceiver.class);
        snoozeIntent.setAction(ACTION_SNOOZE);
        snoozeIntent.putExtra("task_id", taskId);
        snoozeIntent.putExtra("notif_key", key);
        snoozeIntent.putExtra("title", title);
        snoozeIntent.putExtra("body", body);
        PendingIntent snoozePi = PendingIntent.getBroadcast(
                context, (key + ":snooze").hashCode(), snoozeIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder builder = new Notification.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_notify)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setShowWhen(occurrence > 0)
                .setWhen(occurrence > 0 ? occurrence : System.currentTimeMillis())
                .setColor(Color.parseColor("#5450E0"))
                .setCategory(Notification.CATEGORY_REMINDER)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setContentIntent(contentIntent)
                .addAction(new Notification.Action.Builder(
                        Icon.createWithResource(context, R.drawable.ic_notify), "完成", donePi).build())
                .addAction(new Notification.Action.Builder(
                        Icon.createWithResource(context, R.drawable.ic_notify), "稍后 10 分钟", snoozePi).build());

        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) manager.notify(key.hashCode(), builder.build());
    }

    static void cancel(Context context, String key) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null && key != null) manager.cancel(key.hashCode());
    }
}
