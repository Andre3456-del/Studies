package org.studieshub.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkInfo;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.webkit.CookieManager;

import java.net.HttpURLConnection;
import java.net.URL;

/** Keeps a person showing as "online" to their friends while their phone has internet, even when the app is closed. */
public class PresenceService extends Service {
    static volatile boolean running;
    private HandlerThread ht;
    private Handler h;
    private ConnectivityManager cm;
    private ConnectivityManager.NetworkCallback cb;
    private final Runnable tick = new Runnable() {
        @Override public void run() { ping(); if (h != null) h.postDelayed(this, 45000); }
    };

    @Override public IBinder onBind(Intent i) { return null; }

    @Override public int onStartCommand(Intent in, int flags, int startId) {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel("presence_v1") == null) {
                NotificationChannel ch = new NotificationChannel("presence_v1", "Online status", NotificationManager.IMPORTANCE_MIN);
                ch.setShowBadge(false);
                nm.createNotificationChannel(ch);
            }
            PendingIntent open = PendingIntent.getActivity(this, 3, new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0));
            Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, "presence_v1") : new Notification.Builder(this);
            b.setSmallIcon(android.R.drawable.presence_online).setContentTitle("Studies Hub").setContentText("You show as online to your friends")
             .setOngoing(true).setContentIntent(open);
            if (Build.VERSION.SDK_INT >= 34) startForeground(78, b.build(), android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            else startForeground(78, b.build());
            if (ht == null) {
                ht = new HandlerThread("studies-presence"); ht.start();
                h = new Handler(ht.getLooper());
                cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
                if (Build.VERSION.SDK_INT >= 24) {
                    cb = new ConnectivityManager.NetworkCallback() {
                        @Override public void onAvailable(Network n) { if (h != null) h.post(() -> ping()); } // the moment data comes back
                    };
                    try { cm.registerDefaultNetworkCallback(cb); } catch (Throwable t) { cb = null; }
                }
                running = true;
                h.post(tick);
            }
        } catch (Throwable t) { stopSelf(); }
        return START_STICKY;
    }

    private boolean online() {
        NetworkInfo n = cm == null ? null : cm.getActiveNetworkInfo();
        return n != null && n.isConnected();
    }

    private void ping() {
        try {
            if (!online()) return;
            String cookie = CookieManager.getInstance().getCookie("https://studieshub.org");
            if (cookie == null || !cookie.contains("sid=")) { stopSelf(); return; } // not logged in
            HttpURLConnection c = (HttpURLConnection) new URL("https://studieshub.org/api/ping").openConnection();
            c.setConnectTimeout(8000); c.setReadTimeout(8000);
            c.setRequestProperty("Cookie", cookie);
            c.setRequestProperty("User-Agent", "StudiesHubApp/1.0 presence");
            int code = c.getResponseCode();
            c.disconnect();
            if (code == 401) stopSelf(); // logged out
        } catch (Throwable t) { /* try again next time */ }
    }

    @Override public void onDestroy() {
        running = false;
        try { if (cm != null && cb != null) cm.unregisterNetworkCallback(cb); } catch (Throwable t) { }
        try { if (ht != null) ht.quitSafely(); } catch (Throwable t) { }
        h = null; ht = null;
        super.onDestroy();
    }
}
