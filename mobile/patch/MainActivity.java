package africa.doanyon.churchlive;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.net.wifi.ScanResult;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import androidx.core.content.FileProvider;
import com.getcapacitor.BridgeActivity;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.URL;
import java.security.MessageDigest;
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
   4) Télécharge la mise à jour de l'APK, vérifie sa signature et sa version, puis l'installe par PackageInstaller (Android donne alors la VRAIE raison d'un échec).
   5) Liste les réseaux Wi-Fi visibles (le PC les propose dans une liste à choisir).
   6) Service au premier plan (LiveService) pendant le direct : Android ne gèle ni ne tue l'application. */
public class MainActivity extends BridgeActivity {
    private WifiManager.WifiLock wifiLock;
    private static final String ACT_INSTALL = "africa.doanyon.churchlive.INSTALL_RESULT";
    private BroadcastReceiver installReceiver;

    private int sigFlags() {
        return Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
    }

    private PackageInfo ownInfo() throws Exception {
        return getPackageManager().getPackageInfo(getPackageName(), sigFlags());
    }

    @SuppressWarnings("deprecation")
    private long versionCodeOf(PackageInfo p) {
        return Build.VERSION.SDK_INT >= 28 ? p.getLongVersionCode() : p.versionCode;
    }

    private static String sha256Hex(byte[] b) throws Exception {
        StringBuilder hex = new StringBuilder();
        for (byte x : MessageDigest.getInstance("SHA-256").digest(b)) hex.append(String.format("%02x", x));
        return hex.toString();
    }

    /* Empreintes des certificats qui signent l'APK (installé ou téléchargé) */
    @SuppressWarnings("deprecation")
    private Set<String> signers(PackageInfo p) {
        Set<String> out = new LinkedHashSet<String>();
        try {
            Signature[] ss = null;
            if (Build.VERSION.SDK_INT >= 28) {
                if (p.signingInfo != null) ss = p.signingInfo.getApkContentsSigners();
            } else {
                ss = p.signatures;
            }
            if (ss != null) for (Signature s : ss) out.add(sha256Hex(s.toByteArray()));
        } catch (Throwable ignored) {
        }
        return out;
    }

    /* Contrôle le fichier téléchargé AVANT d'ouvrir l'installation : mauvaise clé de signature ou version plus ancienne = Android répondrait
       seulement « application non installée ». Renvoie null si rien d'anormal, sinon {type, message}. */
    private String[] checkApk(File apk) {
        try {
            PackageInfo np = getPackageManager().getPackageArchiveInfo(apk.getAbsolutePath(), sigFlags());
            if (np == null) return new String[]{"invalid", "Le fichier téléchargé n'est pas une application Android valide."};
            if (!getPackageName().equals(np.packageName)) return new String[]{"invalid", "Le fichier téléchargé n'est pas TPR Live (" + np.packageName + ")."};
            PackageInfo op = ownInfo();
            long nv = versionCodeOf(np), ov = versionCodeOf(op);
            if (nv < ov) {
                return new String[]{"downgrade", "La version proposée (code " + nv + ") est plus ancienne que celle installée sur ce téléphone (code " + ov + "). Android refuse de revenir en arrière."};
            }
            Set<String> a = signers(op), b = signers(np);
            if (!a.isEmpty() && !b.isEmpty()) {
                boolean common = false;
                for (String x : b) if (a.contains(x)) common = true;
                if (!common) {
                    return new String[]{"signature", "Cette version est signée avec une autre clé que celle de l'application installée sur ce téléphone : Android refuse de l'installer par-dessus (il affiche « application non installée »). Il faut désinstaller TPR Live une seule fois, puis installer la nouvelle version. Les réglages (adresse du PC, code d'appairage, numéro de caméra) seront à saisir de nouveau."};
                }
            }
        } catch (Throwable ignored) {
        }
        return null;
    }

    /* Traduit la réponse du programme d'installation d'Android en phrase claire */
    private String[] explain(int status, String detail) {
        String d = detail == null ? "" : detail;
        String u = d.toUpperCase();
        if (u.contains("SIGNATURES DO NOT MATCH") || u.contains("UPDATE_INCOMPATIBLE") || u.contains("SIGNATURE")) {
            return new String[]{"signature", "Android refuse : la nouvelle version est signée avec une autre clé que celle installée. Il faut désinstaller TPR Live une seule fois, puis installer la nouvelle version. (" + d + ")"};
        }
        if (u.contains("DOWNGRADE")) {
            return new String[]{"downgrade", "Android refuse : la version proposée est plus ancienne que celle installée. (" + d + ")"};
        }
        switch (status) {
            case PackageInstaller.STATUS_FAILURE_ABORTED:
                return new String[]{"aborted", "Installation annulée. Touchez à nouveau la mise à jour pour réessayer."};
            case PackageInstaller.STATUS_FAILURE_BLOCKED:
                return new String[]{"blocked", "Android a bloqué l'installation (Play Protect ou réglage du téléphone). " + d};
            case PackageInstaller.STATUS_FAILURE_STORAGE:
                return new String[]{"storage", "Espace de stockage insuffisant sur le téléphone : libérez de la place puis réessayez. " + d};
            case PackageInstaller.STATUS_FAILURE_INVALID:
                return new String[]{"invalid", "Android juge le fichier d'installation invalide. " + d};
            case PackageInstaller.STATUS_FAILURE_INCOMPATIBLE:
                return new String[]{"incompatible", "Cette version n'est pas compatible avec ce téléphone. " + d};
            case PackageInstaller.STATUS_FAILURE_CONFLICT:
                return new String[]{"conflict", "Conflit avec la version déjà installée. " + d};
            default:
                return new String[]{"other", "Échec de l'installation (code " + status + "). " + d};
        }
    }

    private void callJs(final String js) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    getBridge().getWebView().evaluateJavascript(js, null);
                } catch (Throwable ignored) {
                }
            }
        });
    }

    /* Signale un échec de mise à jour à la page : window.onTprUpdateFailed(texte, type) */
    private void updateFailedKind(String kind, String why) {
        callJs("window.onTprUpdateFailed&&window.onTprUpdateFailed(" + JSONObject.quote(why) + "," + JSONObject.quote(kind) + ")");
    }

    private void updateInfo(String text) {
        callJs("window.onTprUpdateInfo&&window.onTprUpdateInfo(" + JSONObject.quote(text) + ")");
    }

    /* Réponse du programme d'installation : demande de confirmation à l'utilisateur, succès ou échec avec la raison */
    private void registerInstallReceiver() {
        if (installReceiver != null) return;
        installReceiver = new BroadcastReceiver() {
            @SuppressWarnings("deprecation")
            @Override
            public void onReceive(Context c, Intent i) {
                int st = i.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
                String detail = i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
                if (st == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                    Intent confirm = (Intent) i.getParcelableExtra(Intent.EXTRA_INTENT);
                    if (confirm != null) {
                        try {
                            confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            MainActivity.this.startActivity(confirm);
                        } catch (Throwable t) {
                            updateFailedKind("other", "Impossible d'ouvrir l'écran d'installation d'Android.");
                        }
                    }
                    return;
                }
                if (st == PackageInstaller.STATUS_SUCCESS) return;
                String[] ex = explain(st, detail);
                updateFailedKind(ex[0], ex[1]);
            }
        };
        IntentFilter f = new IntentFilter(ACT_INSTALL);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(installReceiver, f, Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(installReceiver, f);
    }

    /* Installation par session : Android renvoie le résultat (et la vraie raison d'un refus) à installReceiver */
    private void installViaSession(File apk) throws Exception {
        registerInstallReceiver();
        PackageInstaller pi = getPackageManager().getPackageInstaller();
        try {
            for (PackageInstaller.SessionInfo si : pi.getMySessions()) {
                try {
                    pi.abandonSession(si.getSessionId());   /* une ancienne session restée ouverte peut bloquer la nouvelle */
                } catch (Throwable ignored) {
                }
            }
        } catch (Throwable ignored) {
        }
        PackageInstaller.SessionParams sp = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        sp.setAppPackageName(getPackageName());
        int id = pi.createSession(sp);
        PackageInstaller.Session s = pi.openSession(id);
        try {
            InputStream in = new FileInputStream(apk);
            OutputStream out = s.openWrite("church-live.apk", 0, apk.length());
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            s.fsync(out);
            out.close();
            in.close();
            Intent it = new Intent(ACT_INSTALL).setPackage(getPackageName());
            int fl = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            PendingIntent pend = PendingIntent.getBroadcast(MainActivity.this, id, it, fl);
            s.commit(pend.getIntentSender());
        } catch (Exception e) {
            try {
                s.abandon();
            } catch (Throwable ignored) {
            }
            throw e;
        } finally {
            s.close();
        }
    }

    /* Ancienne méthode (ouvre l'écran d'installation d'Android), gardée en secours si la session est refusée */
    private void installViaView(File apk) {
        Uri uri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".fileprovider", apk);
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(uri, "application/vnd.android.package-archive");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(i);
    }

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
                    int fq = wi.getFrequency();   /* en MHz : 2412 à 2484 = bande 2,4 GHz, 5170 et plus = bande 5 GHz */
                    if (fq > 0) o.put("freq", fq);
                    String ss = wi.getSSID();   /* Android ne donne le nom qu'avec l'autorisation de localisation : sinon « <unknown ssid> », qu'on ignore */
                    if (ss != null && !ss.contains("unknown")) o.put("ssid", ss.replace("\"", ""));
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
            try {
                /* Chaleur du téléphone (0 = normal … 3 = sévère, Android 10 et plus) : sert à prévenir avant que le téléphone ne ralentisse */
                if (Build.VERSION.SDK_INT >= 29) {
                    PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                    if (pm != null) o.put("thermal", pm.getCurrentThermalStatus());
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

        /* Direct en cours : démarre (true) ou arrête (false) le service au premier plan caméra + micro (voir LiveService).
           Si Android refuse, rien ne change pour le direct. */
        @JavascriptInterface
        public void keepAlive(boolean on) {
            try {
                Intent i = new Intent(MainActivity.this, LiveService.class);
                if (on) {
                    if (Build.VERSION.SDK_INT >= 26) MainActivity.this.startForegroundService(i);
                    else MainActivity.this.startService(i);
                } else {
                    MainActivity.this.stopService(i);
                }
            } catch (Throwable ignored) {
            }
        }

        /* Version installée, code de version et empreinte de la clé de signature (pour comprendre un refus de mise à jour) */
        @JavascriptInterface
        public String appInfo() {
            JSONObject o = new JSONObject();
            try {
                PackageInfo p = ownInfo();
                o.put("versionName", p.versionName == null ? "" : p.versionName);
                o.put("versionCode", versionCodeOf(p));
                Set<String> sg = signers(p);
                if (!sg.isEmpty()) o.put("signer", sg.iterator().next().substring(0, 12));
                o.put("canInstall", Build.VERSION.SDK_INT < 26 || getPackageManager().canRequestPackageInstalls());
            } catch (Throwable ignored) {
            }
            return o.toString();
        }

        /* Ouvre la désinstallation de TPR Live (nécessaire une seule fois si la clé de signature a changé) */
        @JavascriptInterface
        public void uninstallSelf() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        Intent i = new Intent(Intent.ACTION_DELETE, Uri.parse("package:" + getPackageName()));
                        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(i);
                    } catch (Throwable t) {
                        try {
                            Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()));
                            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            startActivity(i);
                        } catch (Throwable ignored) {
                        }
                    }
                }
            });
        }

        /* Réseaux Wi-Fi vus par le téléphone : [{ssid, freq, level}]. Android exige l'autorisation de localisation (la position n'est jamais lue)
           et la localisation activée. Un appel lance une recherche et renvoie la dernière liste connue ; la page rappelle quelques secondes plus tard. */
        @SuppressWarnings("deprecation")
        @JavascriptInterface
        public String scanWifi() {
            JSONArray arr = new JSONArray();
            try {
                WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                try {
                    wm.startScan();
                } catch (Throwable ignored) {
                }
                List<ScanResult> rs = wm.getScanResults();
                if (rs != null) {
                    for (ScanResult r : rs) {
                        if (arr.length() >= 60) break;
                        String ssid = r.SSID;
                        if (ssid == null || ssid.length() == 0 || ssid.contains("unknown ssid")) continue;
                        JSONObject o = new JSONObject();
                        o.put("ssid", ssid);
                        o.put("freq", r.frequency);
                        o.put("level", r.level);
                        arr.put(o);
                    }
                }
            } catch (Throwable ignored) {
            }
            return arr.toString();
        }

        private void updateFailed(String why) {
            updateFailedKind("other", why);
        }

        /* Télécharge l'APK, vérifie son empreinte SHA-256, puis seulement ouvre l'installation.
           Sans empreinte valide ou en cas de différence, rien n'est installé (et le fichier est supprimé). */
        @JavascriptInterface
        public void install(final String url, final String sha256) {
            if (url == null || !(url.startsWith("http://") || url.startsWith("https://"))) return;
            final String expected = sha256 == null ? "" : sha256.trim().toLowerCase();
            if (!expected.matches("[0-9a-f]{64}")) {
                updateFailed("Mise à jour refusée : empreinte de sécurité absente.");
                return;
            }
            new Thread(new Runnable() {
                @Override
                public void run() {
                    File apk = null;
                    boolean downloaded = false;
                    try {
                        File dir = new File(getCacheDir(), "updates");
                        dir.mkdirs();
                        apk = new File(dir, "church-live.apk");
                        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                        c.setConnectTimeout(10000);
                        c.setReadTimeout(30000);
                        c.setInstanceFollowRedirects(true);
                        MessageDigest md = MessageDigest.getInstance("SHA-256");
                        InputStream in = c.getInputStream();
                        FileOutputStream out = new FileOutputStream(apk);
                        byte[] buf = new byte[65536];
                        int n;
                        while ((n = in.read(buf)) > 0) {
                            out.write(buf, 0, n);
                            md.update(buf, 0, n);
                        }
                        out.close();
                        in.close();
                        StringBuilder hex = new StringBuilder();
                        for (byte x : md.digest()) hex.append(String.format("%02x", x));
                        if (!hex.toString().equals(expected)) {
                            apk.delete();
                            updateFailed("Mise à jour refusée : le fichier téléchargé ne correspond pas à l'empreinte attendue.");
                            return;
                        }
                        downloaded = true;
                        updateInfo("Vérification de la version…");
                        String[] bad = checkApk(apk);
                        if (bad != null) {
                            updateFailedKind(bad[0], bad[1]);
                            return;
                        }
                        if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
                            runOnUiThread(new Runnable() {
                                @Override
                                public void run() {
                                    try {
                                        Intent si = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName()));
                                        si.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                        startActivity(si);
                                    } catch (Throwable ignored) {
                                    }
                                }
                            });
                            updateFailedKind("permission", "Autorisez TPR Live à installer des applications (l'écran de réglage vient de s'ouvrir), puis revenez ici et touchez à nouveau la mise à jour.");
                            return;
                        }
                        updateInfo("Ouverture de l'installation Android…");
                        try {
                            installViaSession(apk);
                        } catch (Throwable t) {
                            installViaView(apk);   /* secours : ancienne méthode */
                        }
                    } catch (Throwable t) {
                        if (downloaded) {
                            updateFailed("Échec de l'ouverture de l'installation : " + t);
                        } else {
                            try {
                                if (apk != null) apk.delete();
                            } catch (Throwable ignored) {
                            }
                            updateFailed("Échec du téléchargement de la mise à jour (le PC ou GitHub ne répond pas, ou la connexion a été coupée).");
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
            getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);   /* l'écran ne s'éteint pas pendant le direct */
        } catch (Throwable ignored) {
        }
        try {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        } catch (Throwable ignored) {
        }
        try {
            getBridge().getWebView().addJavascriptInterface(new Updater(), "TPRNative");
        } catch (Throwable ignored) {
        }
        try {
            registerInstallReceiver();
        } catch (Throwable ignored) {
        }
        try {
            /* Autorisations demandées en une seule fenêtre : la notification « Direct en cours » (Android 13+, le service fonctionne même si elle est refusée)
               et la localisation, uniquement pour que le PC puisse lire le NOM du réseau Wi-Fi (Android refuse de le donner sans elle).
               La position de l'appareil n'est jamais lue. Pour que le nom apparaisse : choisir « Position précise » et laisser la localisation du téléphone activée. */
            if (Build.VERSION.SDK_INT >= 23) {
                ArrayList<String> need = new ArrayList<String>();
                if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
                    need.add("android.permission.POST_NOTIFICATIONS");
                }
                if (checkSelfPermission("android.permission.ACCESS_FINE_LOCATION") != PackageManager.PERMISSION_GRANTED) {
                    need.add("android.permission.ACCESS_FINE_LOCATION");
                }
                if (!need.isEmpty()) {
                    requestPermissions(need.toArray(new String[0]), 7101);
                }
            }
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
            if (installReceiver != null) unregisterReceiver(installReceiver);
        } catch (Throwable ignored) {
        }
        try {
            if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        } catch (Throwable ignored) {
        }
        try {
            stopService(new Intent(this, LiveService.class));
        } catch (Throwable ignored) {
        }
        super.onDestroy();
    }
}
