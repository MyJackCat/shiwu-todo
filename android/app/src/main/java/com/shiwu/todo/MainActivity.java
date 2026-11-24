package com.shiwu.todo;

import android.Manifest;
import android.app.Activity;
import android.app.AlarmManager;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.text.InputType;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONObject;

public class MainActivity extends Activity {
    private static final int REQUEST_NOTIFICATIONS = 1;
    private static boolean askedExactAlarm = false;

    private WebView webView;
    private String pendingTaskId;
    private String pendingNewAction;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Notifications.ensureChannel(this);

        FrameLayout container = new FrameLayout(this);
        webView = new WebView(this);
        webView.setBackgroundColor(getColor(R.color.widget_bg));
        container.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(container);

        // Android 15+ 强制沉浸式，手动留出状态栏/导航栏空间，避免底部导航被系统栏盖住
        if (Build.VERSION.SDK_INT >= 30) {
            container.setOnApplyWindowInsetsListener((view, insets) -> {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return insets;
            });
        } else {
            container.setFitsSystemWindows(true);
        }
        configureWebView();

        requestNotificationPermission();
        maybeAskExactAlarm();

        String taskId = getIntent() == null ? null : getIntent().getStringExtra("task_id");
        pendingTaskId = taskId;
        pendingNewAction = getIntent() == null ? null : getIntent().getStringExtra("new_action");
        if (Prefs.server(this).isEmpty()) {
            showServerDialog(true);
        } else {
            loadApp(pendingTaskId, pendingNewAction);
        }
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient());
        webView.addJavascriptInterface(new Bridge(), "TodoNative");
    }

    private void loadApp(String taskId, String newAction) {
        String server = Prefs.server(this);
        if (server.isEmpty()) return;
        StringBuilder url = new StringBuilder(server);
        url.append(server.contains("?") ? "&" : "?").append("android=1");
        if (taskId != null && !taskId.isEmpty()) {
            url.append("&task=").append(Uri.encode(taskId));
        }
        if (newAction != null && !newAction.isEmpty()) {
            url.append("&new=").append(Uri.encode(newAction));
        }
        webView.loadUrl(url.toString());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        pendingTaskId = intent.getStringExtra("task_id");
        pendingNewAction = intent.getStringExtra("new_action");
        if (Prefs.server(this).isEmpty()) showServerDialog(true);
        else loadApp(pendingTaskId, pendingNewAction);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
        TodoWidgetProvider.updateAll(this);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (webView != null) webView.onPause();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) webView.destroy();
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        menu.add(0, 1, 0, "设置服务器");
        menu.add(0, 2, 1, "刷新");
        menu.add(0, 3, 2, "通知设置");
        menu.add(0, 4, 3, "精确提醒设置");
        return true;
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        int id = item.getItemId();
        if (id == 1) {
            showServerDialog(false);
            return true;
        }
        if (id == 2) {
            webView.reload();
            return true;
        }
        if (id == 3) {
            try {
                Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                intent.putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
                startActivity(intent);
            } catch (Exception error) {
                Toast.makeText(this, "无法打开通知设置", Toast.LENGTH_SHORT).show();
            }
            return true;
        }
        if (id == 4) {
            openExactAlarmSettings();
            return true;
        }
        return super.onOptionsItemSelected(item);
    }

    private void showServerDialog(boolean firstRun) {
        EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setHint("http://192.168.1.10:8787");
        String current = Prefs.server(this);
        input.setText(current.isEmpty() ? "http://192.168.1.10:8787" : current);
        input.setSelectAllOnFocus(true);

        AlertDialog.Builder builder = new AlertDialog.Builder(this)
                .setTitle("同步服务器地址")
                .setMessage("填写运行事务待办服务的电脑地址。手机与电脑需在同一局域网，或通过 Tailscale / 内网穿透访问。")
                .setView(input)
                .setCancelable(!firstRun)
                .setPositiveButton("保存并打开", (dialog, which) -> {
                    String value = input.getText().toString().trim();
                    if (!value.startsWith("http://") && !value.startsWith("https://")) {
                        value = "http://" + value;
                    }
                    while (value.endsWith("/")) value = value.substring(0, value.length() - 1);
                    Prefs.setServer(this, value);
                    loadApp(pendingTaskId, pendingNewAction);
                });
        if (firstRun) {
            builder.setNegativeButton("退出", (dialog, which) -> finish());
        } else {
            builder.setNegativeButton("取消", null);
        }
        builder.show();
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQUEST_NOTIFICATIONS);
        }
    }

    private void maybeAskExactAlarm() {
        if (askedExactAlarm || Build.VERSION.SDK_INT < 31) return;
        AlarmManager manager = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
        if (manager == null || manager.canScheduleExactAlarms()) return;
        askedExactAlarm = true;
        new AlertDialog.Builder(this)
                .setTitle("允许精确闹钟")
                .setMessage("为了在设定时间准点提醒，请允许「闹钟和提醒」权限。")
                .setPositiveButton("去设置", (dialog, which) -> openExactAlarmSettings())
                .setNegativeButton("稍后", null)
                .show();
    }

    private void openExactAlarmSettings() {
        if (Build.VERSION.SDK_INT < 31) {
            Toast.makeText(this, "当前系统不需要额外设置", Toast.LENGTH_SHORT).show();
            return;
        }
        try {
            startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                    Uri.parse("package:" + getPackageName())));
        } catch (Exception error) {
            Toast.makeText(this, "无法打开精确闹钟设置", Toast.LENGTH_SHORT).show();
        }
    }

    private class Bridge {
        @JavascriptInterface
        public void setSession(String base, String token, String userJson) {
            if (base != null && !base.isEmpty()) {
                String value = base;
                while (value.endsWith("/")) value = value.substring(0, value.length() - 1);
                Prefs.setServer(MainActivity.this, value);
            }
            Prefs.setSession(MainActivity.this, token, userJson);
        }

        @JavascriptInterface
        public void pushSnapshot(String json) {
            if (json == null || json.isEmpty()) return;
            String apiBase = "";
            try {
                apiBase = new JSONObject(json).optString("apiBase", "");
            } catch (Exception ignored) {
            }
            if (!apiBase.isEmpty()) {
                String value = apiBase;
                while (value.endsWith("/")) value = value.substring(0, value.length() - 1);
                Prefs.setServer(MainActivity.this, value);
            }
            Prefs.saveSnapshot(MainActivity.this, json);
            runOnUiThread(() -> {
                TodoWidgetProvider.updateAll(MainActivity.this);
                ReminderScheduler.reschedule(MainActivity.this);
            });
        }

        @JavascriptInterface
        public void requestNotificationPermission() {
            runOnUiThread(() -> MainActivity.this.requestNotificationPermission());
        }

        @JavascriptInterface
        public String getServerUrl() {
            return Prefs.server(MainActivity.this);
        }

        @JavascriptInterface
        public void clearSession() {
            Prefs.clearSession(MainActivity.this);
            runOnUiThread(() -> {
                TodoWidgetProvider.updateAll(MainActivity.this);
                ReminderScheduler.cancelAll(MainActivity.this);
            });
        }

        @JavascriptInterface
        public void toast(String message) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show());
        }
    }
}
