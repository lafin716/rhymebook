package dev.branchlearn.app;

import android.content.Context;
import android.graphics.Rect;
import android.util.AttributeSet;
import android.view.ActionMode;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import com.getcapacitor.CapacitorWebView;

/**
 * 본문 텍스트를 선택할 때 Android 텍스트 선택 툴바(복사·공유·전체 선택…)를 비운다.
 * 앱의 선택 메뉴(가지·서식·복사)와 겹치지 않게 한다. 입력창을 편집할 때는 웹이 해제를 알려 기본 툴바를 쓴다.
 * 선택 자체(핸들)는 그대로 둔다 — 액션 모드를 거부하면 Chromium이 선택을 지운다.
 */
public class AppWebView extends CapacitorWebView {

    static volatile boolean suppressed = true;

    public AppWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    @Override
    public ActionMode startActionMode(ActionMode.Callback callback, int type) {
        return super.startActionMode(wrap(callback), type);
    }

    @Override
    public ActionMode startActionMode(ActionMode.Callback callback) {
        return super.startActionMode(wrap(callback));
    }

    private static ActionMode.Callback wrap(ActionMode.Callback callback) {
        return new ActionMode.Callback2() {
            @Override
            public boolean onCreateActionMode(ActionMode mode, Menu menu) {
                boolean result = callback.onCreateActionMode(mode, menu);
                if (suppressed) menu.clear();
                return result;
            }

            @Override
            public boolean onPrepareActionMode(ActionMode mode, Menu menu) {
                boolean result = callback.onPrepareActionMode(mode, menu);
                if (suppressed) menu.clear();
                return result;
            }

            @Override
            public boolean onActionItemClicked(ActionMode mode, MenuItem item) {
                return callback.onActionItemClicked(mode, item);
            }

            @Override
            public void onDestroyActionMode(ActionMode mode) {
                callback.onDestroyActionMode(mode);
            }

            @Override
            public void onGetContentRect(ActionMode mode, View view, Rect outRect) {
                if (callback instanceof ActionMode.Callback2) ((ActionMode.Callback2) callback).onGetContentRect(mode, view, outRect);
                else super.onGetContentRect(mode, view, outRect);
            }
        };
    }
}
