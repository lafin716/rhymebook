package dev.branchlearn.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/**
 * 응답 생성 중에만 켜는 포그라운드 서비스 (ADR-106).
 * 앱을 백그라운드로 보내도 프로세스가 얼지 않아 WebView의 스트리밍·원격 소켓이 이어지고,
 * 끝나면 응답 완료 알림을 보낼 수 있다. 생성이 끝나면 JS가 바로 멈춘다.
 */
public class ResponseWorkService extends Service {
    static final String CHANNEL = "response-working";
    private static final int ID = 4107;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        NotificationChannel channel = new NotificationChannel(CHANNEL,
            getString(R.string.work_channel_name), NotificationManager.IMPORTANCE_LOW);
        channel.setDescription(getString(R.string.work_channel_description));
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent click = PendingIntent.getActivity(this, 1, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_notification)
            .setContentTitle(getString(R.string.work_title))
            .setContentText(getString(R.string.work_body))
            .setOngoing(true).setOnlyAlertOnce(true).setContentIntent(click)
            .setCategory(Notification.CATEGORY_PROGRESS)
            .build();
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            else startForeground(ID, notification);
        } catch (Exception error) {
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onTimeout(int startId, int fgsType) {
        // Android 15+: dataSync 하루 사용 한도에 닿으면 바로 멈춘다
        stopSelf();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
