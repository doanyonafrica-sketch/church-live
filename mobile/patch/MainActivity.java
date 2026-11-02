package africa.doanyon.churchlive;

import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ActivityInfo;
import android.net.Uri;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import androidx.core.content.FileProvider;
import com.getcapacitor.BridgeActivity;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

/* 1) Force le mode paysage (image 16:9 pour YouTube).
   2) Garde le Wi-Fi en haute performance pendant le direct (évite les gels périodiques).
   3) Retrouve automatiquement le PC sur le réseau (Wi-Fi ou partage USB).
   4) Télécharge la mise à jour de l'APK puis ouvre directement l'écran d'installation Android. */
public class MainActivity extends BridgeActivity {
    private WifiManager.WifiLock wifiLock;

    /* Appelés depuis la page : TPRNative.install(url), TPRNative.discover() et TPRNative.status() */
    private class Updater {
        /* Signal Wi-Fi, vitesse de liaison et batterie, affichés dans la fenêtre du PC */
        @JavascriptInterface
        public String status() {
            JSONObject o = new JSONObject();
            try {
                WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                WifiInfo wi = wm.getConnectionInfo();
                if (wi != null) {
                    int rssi = wi.getRssi();
                    if (rssi > -127 && rssi < 0) o.put("rssi", rssi);
                    int ls = wi.getLinkSpeed();
                    if (ls > 0) o.put("link", ls);
                }
            } catch (Throwable ignored) {
            }
            try {
                Intent b = registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
                if (b != null) {
                    int lv = b.getIntExtra("level", -1);
                    int sc = b.getIntExtra("scale", 100);
                    if (lv >= 0 && sc > 0) o.put("battery", Math.round(100f * lv / sc));
                    o.put("charging", b.getIntExtra("plugged", 0) != 0);
                }
            } catch (Throwable ignored) {
            }
            return o.toString();
        }

        /* Balaie le réseau du téléphone (port 3000) et renvoie les PC où TPR Live tourne, via window.onTprFound([...]) */
        @JavascriptInterface
        public void discover() {
            new Thread(new Runnable() {
                @Override
                public void run() {
                    final List<String> found = Collections.synchronizedList(new ArrayList<String>());
                    try {
                        Set<String> prefixes = new LinkedHashSet<String>();
                        Enumeration<NetworkInterface> ifs = NetworkInterface.getNetworkInterfaces();
                        while (ifs != null && ifs.hasMoreElements()) {
                            NetworkInterface ni = ifs.nextElement();
                            if (!ni.isUp() || ni.isLoopback()) continue;
                            for (InterfaceAddress ia : ni.getInterfaceAddresses()) {
                                InetAddress a = ia.getAddress();
                                if (a instanceof Inet4Address) {
                                    String ip = a.getHostAddress();
                                    prefixes.add(ip.substring(0, ip.lastIndexOf('.') + 1));
                                }
                            }
                        }
                        ExecutorService ex = Executors.newFixedThreadPool(64);
                        for (final String pre : prefixes) {
                            for (int i = 1; i < 255; i++) {
                                final String host = pre + i;
                                ex.execute(new Runnable() {
                                    @Override
                                    public void run() {
                                        probe(host, found);
                                    }
                                });
                            }
                        }
                        ex.shutdown();
                        ex.awaitTermination(25, TimeUnit.SECONDS);
                    } catch (Throwable ignored) {
                    }
                    final String json = new JSONArray(new ArrayList<String>(found)).toString();
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            try {
                                getBridge().getWebView().evaluateJavascript("window.onTprFound&&window.onTprFound(" + json + ")", null);
                            } catch (Throwable ignored) {
                            }
                        }
                    });
                }
            }).start();
        }

        private void probe(String host, List<String> found) {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL("http://" + host + ":3000/info").openConnection();
                c.setConnectTimeout(500);
                c.setReadTimeout(1000);
                if (c.getResponseCode() != 200) return;
                BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), "UTF-8"));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = r.readLine()) != null && sb.length() < 8192) sb.append(line);
                r.close();
                JSONObject o = new JSONObject(sb.toString());
                if ("tpr-live".equals(o.optString("app"))) {
                    found.add(host + ":3000\t" + o.optString("name", host));
                }
            } catch (Throwable ignored) {
            }
        }

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
