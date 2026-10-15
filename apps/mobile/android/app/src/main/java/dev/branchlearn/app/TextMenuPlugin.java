package dev.branchlearn.app;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** 웹이 입력창 편집 여부에 따라 시스템 텍스트 선택 메뉴를 켜고 끈다 (AppWebView) */
@CapacitorPlugin(name = "TextMenu")
public class TextMenuPlugin extends Plugin {

    @PluginMethod
    public void setSuppressed(PluginCall call) {
        AppWebView.suppressed = Boolean.TRUE.equals(call.getBoolean("value", true));
        call.resolve();
    }
}
