package africa.doanyon.churchlive;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/* Service au premier plan « caméra + micro », démarré par la page seulement quand le direct a commencé
   (TPRNative.keepAlive(true)) et arrêté à la fin du direct.
   Il dit à Android que l'application filme : le système ne la gèle pas et ne la tue pas en arrière-plan, et une notification
   « Direct en cours » reste affichée. Le processeur reste éveillé tant que le direct dure.
   Tout est protégé : en cas d'échec, le service s'arrête simplement et le direct continue comme avant. */
public class LiveService extends Service {
    private static final String CHANNEL = "tpr_live";
    private static final int NOTIF_ID = 7101;
    private PowerManager.WakeLock cpuLock;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        try {
            Notification.Builder b;
            if (Build.VERSION.SDK_INT >= 26) {
                NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Direct en cours", NotificationManager.IMPORTANCE_LOW));
                b = new Notification.Builder(this, CHANNEL);
            } else {
                b = new Notification.Builder(this);
            }
            b.setContentTitle("TPR Live");
            b.setContentText("Direct en cours : la caméra reste active");
            b.setSmallIcon(android.R.drawable.ic_menu_camera);
            b.setOngoing(true);
            Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
            if (open != null) {
                int fl = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
                b.setContentIntent(PendingIntent.getActivity(this, 0, open, fl));
            }
            Notification n = b.build();
            if (Build.VERSION.SDK_INT >= 30) {
                startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA | ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
            } else {
                startForeground(NOTIF_ID, n);
            }
        } catch (Throwable t) {
            stopSelf();
            return START_NOT_STICKY;
        }
        try {
            if (cpuLock == null) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                cpuLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "TPRLive:direct");
                cpuLock.setReferenceCounted(false);
                cpuLock.acquire(12L * 60 * 60 * 1000);   /* garde-fou : jamais plus de 12 h, même si l'arrêt est oublié */
            }
        } catch (Throwable ignored) {
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        try {
            if (cpuLock != null && cpuLock.isHeld()) cpuLock.release();
        } catch (Throwable ignored) {
        }
        try {
            stopForeground(true);
        } catch (Throwable ignored) {
        }
        super.onDestroy();
    }
}
