package com.shiwu.todo;

import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.RemoteViews;

/**
 * 仅调试包可用：把主屏小组件实际渲染出来，方便在模拟器上检查效果。
 * adb shell am start -n com.shiwu.todo/.WidgetPreviewActivity
 */
public class WidgetPreviewActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        float density = getResources().getDisplayMetrics().density;
        int pad = Math.round(18 * density);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFFB8B3A9);
        root.setPadding(pad, pad, pad, pad);

        FrameLayout host = new FrameLayout(this);
        root.addView(host, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, Math.round(520 * density)));

        RemoteViews views = TodoWidgetProvider.build(this);
        View content = views.apply(this, host);
        host.addView(content, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        setContentView(root);
    }
}
