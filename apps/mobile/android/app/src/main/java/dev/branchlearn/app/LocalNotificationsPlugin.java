package dev.branchlearn.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/** Device-local notifications. No push service, network, or exact-alarm permission. */
@CapacitorPlugin(name = "OctoNotifications", permissions = {
    @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
})
public class LocalNotificationsPlugin extends Plugin {
    private static final String CHANNEL = "response-complete";
    private static final String ACTION = "dev.branchlearn.app.OPEN_NOTIFICATION";
    private static final String SESSION = "octobooks.notification.session";
    private static final String SCOPE = "octobooks.notification.scope";
    private String pendingSession;
    private String pendingScope;

    @Override
    public void load() {
        ensureChannel();
        captureClick(getActivity().getIntent());
    }

    private NotificationManager manager() {
        return getContext().getSystemService(NotificationManager.class);
    }

    private void ensureChannel() {
        NotificationChannel channel = new NotificationChannel(CHANNEL,
            getContext().getString(R.string.notification_channel_name), NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription(getContext().getString(R.string.notification_channel_description));
        manager().createNotificationChannel(channel);
    }

    private String permission() {
        // On API33 a new install has app notifications disabled until first grant.
        // Preserve prompt state so the permission button can request the first grant.
        if (Build.VERSION.SDK_INT >= 33) {
            PermissionState state = getPermissionState("notifications");
            if (state == PermissionState.PROMPT || state == PermissionState.PROMPT_WITH_RATIONALE) return "default";
            if (state != PermissionState.GRANTED) return "denied";
        }
        NotificationChannel channel = manager().getNotificationChannel(CHANNEL);
        return manager().areNotificationsEnabled() && (channel == null || channel.getImportance() != NotificationManager.IMPORTANCE_NONE)
            ? "granted" : "denied";
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject result = new JSObject(); result.put("permission", permission()); call.resolve(result);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "permissionResult");
        } else status(call);
    }

    @PermissionCallback
    private void permissionResult(PluginCall call) { status(call); }

    @PluginMethod
    public void show(PluginCall call) {
        String session = call.getString("sessionId");
        String title = call.getString("title");
        String body = call.getString("body");
        String scope = call.getString("scope");
        if (session == null || !session.matches("[\\w-]{1,64}") || title == null || title.length() < 1 || title.length() > 120
            || body == null || body.length() > 240 || (scope != null && !scope.matches("[\\w:.-]{1,128}"))) {
            call.reject("Invalid local notification"); return;
        }
        JSObject result = new JSObject();
        if (!"granted".equals(permission())) { result.put("shown", false); call.resolve(result); return; }
        try {
            ensureChannel();
            Intent intent = new Intent(getContext(), MainActivity.class)
                .setAction(ACTION)
                .setData(Uri.parse("octobooks://notification/" + Uri.encode(scope == null ? "" : scope) + "/" + session))
                .putExtra(SESSION, session).putExtra(SCOPE, scope)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent click = PendingIntent.getActivity(getContext(), 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Notification notification = new Notification.Builder(getContext(), CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_notification).setContentTitle(title).setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setCategory(Notification.CATEGORY_MESSAGE).setVisibility(Notification.VISIBILITY_PRIVATE)
                .setAutoCancel(true).setContentIntent(click).build();
            // String tags avoid hash collisions and replace only this session's prior banner.
            manager().notify((scope == null ? "" : scope) + ":" + session, 0, notification);
            result.put("shown", true); call.resolve(result);
        } catch (Exception error) { call.reject("Could not show local notification", error); }
    }

    private synchronized void captureClick(Intent intent) {
        if (intent == null || !ACTION.equals(intent.getAction())) return;
        String session = intent.getStringExtra(SESSION);
        String scope = intent.getStringExtra(SCOPE);
        intent.removeExtra(SESSION); intent.removeExtra(SCOPE);
        if (session == null || !session.matches("[\\w-]{1,64}") || (scope != null && !scope.matches("[\\w:.-]{1,128}"))) return;
        pendingSession = session; pendingScope = scope;
        notifyListeners("notificationClick", new JSObject());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) { captureClick(intent); }

    @PluginMethod
    public synchronized void takePendingClick(PluginCall call) {
        JSObject result = new JSObject();
        if (pendingSession != null) {
            result.put("sessionId", pendingSession);
            if (pendingScope != null) result.put("scope", pendingScope);
        }
        pendingSession = null; pendingScope = null;
        call.resolve(result);
    }
}
