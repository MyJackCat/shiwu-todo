package com.shiwu.todo;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Set;

final class Prefs {
    private static final String FILE = "shiwu";

    private Prefs() {
    }

    private static SharedPreferences sp(Context context) {
        return context.getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    static String server(Context context) {
        return sp(context).getString("server", "");
    }

    static void setServer(Context context, String value) {
        sp(context).edit().putString("server", value).apply();
    }

    static String token(Context context) {
        return sp(context).getString("token", "");
    }

    static String user(Context context) {
        return sp(context).getString("user", "");
    }

    static void setSession(Context context, String token, String user) {
        sp(context).edit().putString("token", token == null ? "" : token)
                .putString("user", user == null ? "" : user).apply();
    }

    static void clearSession(Context context) {
        sp(context).edit().remove("token").remove("user").remove("snapshot")
                .putLong("seq", 0).remove("scheduled_keys").remove("fired_keys").apply();
    }

    static boolean wasFired(Context context, String key) {
        try {
            JSONObject fired = new JSONObject(sp(context).getString("fired_keys", "{}"));
            long at = fired.optLong(key, 0);
            return at > 0 && at > System.currentTimeMillis() - 2 * 86400000L;
        } catch (Exception ignored) {
            return false;
        }
    }

    static void markFired(Context context, String key) {
        try {
            JSONObject fired = new JSONObject(sp(context).getString("fired_keys", "{}"));
            long now = System.currentTimeMillis();
            fired.put(key, now);
            java.util.List<String> stale = new java.util.ArrayList<>();
            java.util.Iterator<String> iterator = fired.keys();
            while (iterator.hasNext()) {
                String item = iterator.next();
                if (now - fired.optLong(item, 0) > 2 * 86400000L) stale.add(item);
            }
            for (String item : stale) fired.remove(item);
            sp(context).edit().putString("fired_keys", fired.toString()).apply();
        } catch (Exception ignored) {
        }
    }

    static String snapshot(Context context) {
        return sp(context).getString("snapshot", "");
    }

    static void saveSnapshot(Context context, String json) {
        long seq = 0;
        try {
            seq = new JSONObject(json).optLong("seq", 0);
        } catch (Exception ignored) {
        }
        SharedPreferences.Editor editor = sp(context).edit().putString("snapshot", json);
        if (seq > 0) editor.putLong("seq", seq);
        editor.apply();
    }

    static long seq(Context context) {
        return sp(context).getLong("seq", 0);
    }

    static void setSeq(Context context, long value) {
        sp(context).edit().putLong("seq", value).apply();
    }

    static Set<String> scheduledKeys(Context context) {
        Set<String> keys = new HashSet<>();
        try {
            JSONArray array = new JSONArray(sp(context).getString("scheduled_keys", "[]"));
            for (int i = 0; i < array.length(); i++) keys.add(array.optString(i));
        } catch (Exception ignored) {
        }
        return keys;
    }

    static void setScheduledKeys(Context context, Set<String> keys) {
        JSONArray array = new JSONArray();
        for (String key : keys) array.put(key);
        sp(context).edit().putString("scheduled_keys", array.toString()).apply();
    }
}
