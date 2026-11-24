package com.shiwu.todo;

import android.content.Context;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;

/** 后台增量同步：让主屏小组件和闹钟在没有打开网页界面时也能保持更新。 */
final class SyncEngine {
    private SyncEngine() {
    }

    static void sync(Context context) {
        String base = Prefs.server(context);
        while (base.endsWith("/")) base = base.substring(0, base.length() - 1);
        String token = Prefs.token(context);
        if (base.isEmpty() || token.isEmpty()) return;

        try {
            String raw = Http.get(base + "/api/changes?since=" + Prefs.seq(context), token);
            JSONObject data = new JSONObject(raw);
            long serverSeq = data.optLong("serverSeq", Prefs.seq(context));
            JSONArray changes = data.optJSONArray("tasks");

            JSONObject snapshot;
            try {
                snapshot = new JSONObject(Prefs.snapshot(context));
            } catch (Exception error) {
                snapshot = new JSONObject();
            }

            LinkedHashMap<String, JSONObject> map = new LinkedHashMap<>();
            JSONArray existing = snapshot.optJSONArray("tasks");
            if (existing != null) {
                for (int i = 0; i < existing.length(); i++) {
                    JSONObject item = existing.optJSONObject(i);
                    if (item != null && !item.optString("id").isEmpty()) {
                        map.put(item.optString("id"), item);
                    }
                }
            }
            if (changes != null) {
                for (int i = 0; i < changes.length(); i++) {
                    JSONObject item = changes.optJSONObject(i);
                    if (item == null) continue;
                    String id = item.optString("id");
                    if (id.isEmpty()) continue;
                    if (item.optLong("deletedAt", 0) > 0) map.remove(id);
                    else map.put(id, item);
                }
            }

            List<JSONObject> list = new ArrayList<>(map.values());
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

            JSONArray tasks = new JSONArray();
            for (JSONObject item : list) tasks.put(item);

            JSONObject next = new JSONObject();
            next.put("updatedAt", System.currentTimeMillis());
            next.put("seq", serverSeq);
            next.put("tasks", tasks);
            next.put("occurrences", Occurrences.expand(tasks, System.currentTimeMillis()));

            Prefs.saveSnapshot(context, next.toString());
            Prefs.setSeq(context, serverSeq);
            TodoWidgetProvider.updateAll(context);
            ReminderScheduler.reschedule(context);
        } catch (Exception error) {
            Log.w("ShiwuSync", "后台同步失败: " + error.getMessage());
        }
    }
}
