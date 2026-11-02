package africa.doanyon.churchlive;

import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import androidx.core.content.FileProvider;
import com.getcapacitor.BridgeActivity;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/* 1) Force le mode paysage (image 16:9 pour YouTube).
   2) Garde le Wi-Fi en haute performance pendant le direct (évite les gels périodiques).
   3) Télécharge la mise à jour de l'APK puis ouvre directement l'écran d'installation Android. */
public class MainActivity extends BridgeActivity {
    private WifiManager.WifiLock wifiLock;

    /* Appelé depuis la page : TPRNative.install(url) */
    private class Updater {
        @JavascriptInterface
        public void install(final String url) {
            if (url == null || !(url.startsWith("http://") || url.startsWith("https://"))) return;
            new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        File dir = new File(getCacheDir(), "updates");
                        dir.mkdirs();
                        File apk = new File(dir, "church-live.apk");
                        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                        c.setConnectTimeout(10000);
                        c.setReadTimeout(30000);
                        c.setInstanceFollowRedirects(true);
                        InputStream in = c.getInputStream();
                        FileOutputStream out = new FileOutputStream(apk);
                        byte[] buf = new byte[65536];
                        int n;
                        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                        out.close();
                        in.close();
                        Uri uri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".fileprovider", apk);
                        Intent i = new Intent(Intent.ACTION_VIEW);
                        i.setDataAndType(uri, "application/vnd.android.package-archive");
                        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(i);
                    } catch (Throwable t) {
                        try {
                            Intent b = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                            b.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            startActivity(b);
                        } catch (Throwable ignored) {
                        }
                    }
                }
            }).start();
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        } catch (Throwable ignored) {
        }
        try {
            getBridge().getWebView().addJavascriptInterface(new Updater(), "TPRNative");
        } catch (Throwable ignored) {
        }
        try {
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            int mode = Build.VERSION.SDK_INT >= 29
                    ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY
                    : WifiManager.WIFI_MODE_FULL_HIGH_PERF;
            wifiLock = wm.createWifiLock(mode, "TPRLive");
            wifiLock.setReferenceCounted(false);
            wifiLock.acquire();
        } catch (Throwable ignored) {
        }
    }

    @Override
    public void onDestroy() {
        try {
            if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        } catch (Throwable ignored) {
        }
        super.onDestroy();
    }
}
