package com.shiwu.todo;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.List;
import java.util.Locale;

public class TodoWidgetProvider extends AppWidgetProvider {
    static final String ACTION_REFRESH = "com.shiwu.todo.REFRESH";

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        for (int id : appWidgetIds) {
            manager.updateAppWidget(id, build(context));
        }
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (ACTION_REFRESH.equals(intent.getAction())) updateAll(context);
    }

    static void updateAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        ComponentName name = new ComponentName(context, TodoWidgetProvider.class);
        int[] ids = manager.getAppWidgetIds(name);
        for (int id : ids) {
            manager.updateAppWidget(id, build(context));
        }
    }

    static RemoteViews build(Context context) {
        String pkg = context.getPackageName();
        RemoteViews views = new RemoteViews(pkg, R.layout.widget);
        views.setTextViewText(R.id.widget_date,
                new SimpleDateFormat("M月d日 EEEE", Locale.CHINA).format(new Date()));
        views.removeAllViews(R.id.widget_rows);

        boolean loggedIn = !Prefs.token(context).isEmpty();
        JSONObject snapshot = null;
        try {
            String raw = Prefs.snapshot(context);
            if (!raw.isEmpty()) snapshot = new JSONObject(raw);
        } catch (Exception ignored) {
        }

        List<JSONObject> tasks = pendingTasks(snapshot);
        if (!loggedIn) {
            RemoteViews empty = emptyView(context, "打开应用并登录");
            views.addView(R.id.widget_rows, empty);
            views.setTextViewText(R.id.widget_footer, "登录后自动同步待办");
        } else if (tasks.isEmpty()) {
            RemoteViews empty = emptyView(context, "暂无待办，点按添加");
            views.addView(R.id.widget_rows, empty);
            views.setTextViewText(R.id.widget_footer, footer(snapshot, 0));
        } else {
            int shown = Math.min(tasks.size(), 4);
            for (int i = 0; i < shown; i++) {
                JSONObject task = tasks.get(i);
                String taskId = task.optString("id");
                RemoteViews row = new RemoteViews(pkg, R.layout.widget_row);
                row.setTextViewText(R.id.row_title, task.optString("title", "未命名"));
                row.setTextViewText(R.id.row_meta, meta(task));
                row.setOnClickPendingIntent(R.id.row_root, openIntent(context, taskId, null));
                row.setOnClickPendingIntent(R.id.row_check, completeIntent(context, taskId));
                views.addView(R.id.widget_rows, row);
            }
            views.setTextViewText(R.id.widget_footer, footer(snapshot, tasks.size()));
        }

        views.setOnClickPendingIntent(R.id.widget_root, openIntent(context, null, null));
        views.setOnClickPendingIntent(R.id.widget_add, openIntent(context, null, "task"));
        views.setOnClickPendingIntent(R.id.widget_add_reminder, openIntent(context, null, "reminder"));
        views.setOnClickPendingIntent(R.id.widget_refresh, syncIntent(context));
        return views;
    }

    private static RemoteViews emptyView(Context context, String text) {
        RemoteViews view = new RemoteViews(context.getPackageName(), R.layout.widget_empty);
        view.setTextViewText(R.id.widget_empty_text, text);
        return view;
    }

    private static String footer(JSONObject snapshot, int total) {
        long updatedAt = snapshot == null ? 0 : snapshot.optLong("updatedAt", 0);
        if (updatedAt <= 0) return "等待同步…";
        String time = new SimpleDateFormat("HH:mm", Locale.CHINA).format(new Date(updatedAt));
        if (total > 6) return "更新 " + time + " · 还有 " + (total - 6) + " 项，点按打开";
        return "更新 " + time + " · 共 " + total + " 项";
    }

    private static List<JSONObject> pendingTasks(JSONObject snapshot) {
        List<JSONObject> list = new ArrayList<>();
        if (snapshot != null) {
            JSONArray array = snapshot.optJSONArray("tasks");
            if (array != null) {
                for (int i = 0; i < array.length(); i++) {
                    JSONObject task = array.optJSONObject(i);
                    if (task == null) continue;
                    if (!"pending".equals(task.optString("status", "pending"))) continue;
                    list.add(task);
                }
            }
        }
        Collections.sort(list, new Comparator<JSONObject>() {
            @Override
            public int compare(JSONObject a, JSONObject b) {
                boolean ar = "reminder".equals(a.optString("kind")) && a.optLong("remindAt", 0) > 0;
                boolean br = "reminder".equals(b.optString("kind")) && b.optLong("remindAt", 0) > 0;
                if (ar != br) return ar ? -1 : 1;
                if (ar) return Long.compare(a.optLong("remindAt"), b.optLong("remindAt"));
                return Long.compare(b.optLong("createdAt", 0), a.optLong("createdAt", 0));
            }
        });
        return list;
    }

    private static String meta(JSONObject task) {
        if (!"reminder".equals(task.optString("kind"))) return "事务";
        long remindAt = task.optLong("remindAt", 0);
        if (remindAt <= 0) return "提醒";
        StringBuilder builder = new StringBuilder(Occurrences.formatSmart(remindAt));
        long endAt = task.optLong("endAt", 0);
        if (endAt > remindAt) {
            builder.append(" - ")
                    .append(new SimpleDateFormat("HH:mm", Locale.CHINA).format(new Date(endAt)));
        }
        String repeat = Occurrences.repeatLabel(task.optString("repeat"));
        if (!repeat.isEmpty()) builder.append(" · ").append(repeat);
        return builder.toString();
    }

    private static PendingIntent openIntent(Context context, String taskId, String newAction) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (taskId != null && !taskId.isEmpty()) intent.putExtra("task_id", taskId);
        if (newAction != null && !newAction.isEmpty()) intent.putExtra("new_action", newAction);
        int requestCode;
        if (taskId != null && !taskId.isEmpty()) requestCode = taskId.hashCode();
        else if ("task".equals(newAction)) requestCode = 1002;
        else if ("reminder".equals(newAction)) requestCode = 1003;
        else requestCode = 1001;
        return PendingIntent.getActivity(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent completeIntent(Context context, String taskId) {
        Intent intent = new Intent(context, ActionReceiver.class);
        intent.setAction(Notifications.ACTION_COMPLETE);
        intent.putExtra("task_id", taskId);
        return PendingIntent.getBroadcast(
                context,
                ("widget:" + taskId).hashCode(),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent syncIntent(Context context) {
        Intent intent = new Intent(context, SyncReceiver.class);
        intent.setAction(ReminderScheduler.ACTION_SYNC);
        return PendingIntent.getBroadcast(
                context,
                2002,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
