package com.shiwu.todo;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/** 把重复提醒展开成未来几天的具体闹钟时刻，逻辑与网页端保持一致。 */
final class Occurrences {
    private static final long DAY = 86400000L;

    private Occurrences() {
    }

    static JSONArray expand(JSONArray tasks, long now) {
        List<JSONObject> result = new ArrayList<>();
        if (tasks != null) {
            for (int i = 0; i < tasks.length(); i++) {
                JSONObject task = tasks.optJSONObject(i);
                if (task == null) continue;
                if (!"reminder".equals(task.optString("kind"))) continue;
                if ("done".equals(task.optString("status", "pending"))) continue;
                long remindAt = task.optLong("remindAt", 0);
                if (remindAt <= 0) continue;
                int advance = task.optInt("advanceMinutes", 0);
                String repeat = task.optString("repeat", "none");
                String taskId = task.optString("id");
                String title = task.optString("title");

                long at = remindAt;
                int guard = 0;
                while (at < now - DAY && guard++ < 2000) {
                    at = next(at, repeat);
                }
                while (at <= now + 7 * DAY && guard++ < 6000) {
                    long notifyAt = at - advance * 60000L;
                    if (notifyAt >= now - 60000L) {
                        try {
                            JSONObject item = new JSONObject();
                            item.put("key", taskId + ":" + at);
                            item.put("taskId", taskId);
                            item.put("title", title);
                            item.put("at", notifyAt);
                            item.put("remindAt", at);
                            item.put("body", body(task, at));
                            result.add(item);
                        } catch (Exception ignored) {
                        }
                    }
                    if ("none".equals(repeat)) break;
                    at = next(at, repeat);
                }
            }
        }
        Collections.sort(result, new Comparator<JSONObject>() {
            @Override
            public int compare(JSONObject a, JSONObject b) {
                return Long.compare(a.optLong("at"), b.optLong("at"));
            }
        });
        JSONArray array = new JSONArray();
        for (JSONObject item : result) array.put(item);
        return array;
    }

    static long next(long at, String repeat) {
        Calendar calendar = Calendar.getInstance();
        calendar.setTimeInMillis(at);
        if ("daily".equals(repeat)) {
            calendar.add(Calendar.DAY_OF_MONTH, 1);
        } else if ("weekly".equals(repeat)) {
            calendar.add(Calendar.DAY_OF_MONTH, 7);
        } else if ("monthly".equals(repeat)) {
            int day = calendar.get(Calendar.DAY_OF_MONTH);
            calendar.set(Calendar.DAY_OF_MONTH, 1);
            calendar.add(Calendar.MONTH, 1);
            int last = calendar.getActualMaximum(Calendar.DAY_OF_MONTH);
            calendar.set(Calendar.DAY_OF_MONTH, Math.min(day, last));
        } else if ("weekdays".equals(repeat)) {
            do {
                calendar.add(Calendar.DAY_OF_MONTH, 1);
            } while (calendar.get(Calendar.DAY_OF_WEEK) == Calendar.SATURDAY
                    || calendar.get(Calendar.DAY_OF_WEEK) == Calendar.SUNDAY);
        } else {
            return at;
        }
        return calendar.getTimeInMillis();
    }

    static String body(JSONObject task, long occurrence) {
        long remindAt = task.optLong("remindAt", occurrence);
        long endAt = task.optLong("endAt", 0);
        long end = endAt > 0 && remindAt > 0 ? occurrence + (endAt - remindAt) : 0;
        String start = formatSmart(occurrence);
        if (end > 0) {
            return start + " - " + new SimpleDateFormat("HH:mm", Locale.CHINA).format(new Date(end));
        }
        return start;
    }

    static String formatSmart(long timestamp) {
        Calendar target = Calendar.getInstance();
        target.setTimeInMillis(timestamp);
        Calendar today = Calendar.getInstance();
        SimpleDateFormat time = new SimpleDateFormat("HH:mm", Locale.CHINA);
        if (target.get(Calendar.YEAR) == today.get(Calendar.YEAR)
                && target.get(Calendar.DAY_OF_YEAR) == today.get(Calendar.DAY_OF_YEAR)) {
            return time.format(new Date(timestamp));
        }
        Calendar tomorrow = Calendar.getInstance();
        tomorrow.add(Calendar.DAY_OF_YEAR, 1);
        if (target.get(Calendar.YEAR) == tomorrow.get(Calendar.YEAR)
                && target.get(Calendar.DAY_OF_YEAR) == tomorrow.get(Calendar.DAY_OF_YEAR)) {
            return "明天 " + time.format(new Date(timestamp));
        }
        return new SimpleDateFormat("M月d日 HH:mm", Locale.CHINA).format(new Date(timestamp));
    }

    static String repeatLabel(String repeat) {
        if ("daily".equals(repeat)) return "每天";
        if ("weekdays".equals(repeat)) return "工作日";
        if ("weekly".equals(repeat)) return "每周";
        if ("monthly".equals(repeat)) return "每月";
        return "";
    }
}
