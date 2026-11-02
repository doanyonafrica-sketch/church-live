package africa.doanyon.churchlive;

import android.content.Context;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/* Garde le Wi-Fi en mode haute performance pendant le direct.
   Sans cela, Android met la puce Wi-Fi en veille par à-coups : l'image se fige puis rattrape son retard. */
public class MainActivity extends BridgeActivity {
    private WifiManager.WifiLock wifiLock;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
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
