package org.studieshub.app;

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

import org.json.JSONObject;

/** Saves materials to the phone one after another, in the background. It waits for the internet and carries on by itself. */
public class OfflineService extends Service {
    private static final String CH = "offline_save";
    private static final int NID = 9201;
    private static volatile boolean running = false;
    private int done = 0;

    static void start(Context c) {
        Intent i = new Intent(c, OfflineService.class);
        try { if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i); } catch (Throwable t) { }
    }

    @Override public IBinder onBind(Intent i) { return null; }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        Notification n = note("Saving materials to your phone", "Getting ready", -1);
        if (Build.VERSION.SDK_INT >= 29) startForeground(NID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC); else startForeground(NID, n);
        synchronized (OfflineService.class) {
            if (!running) { running = true; new Thread(this::loop).start(); }
        }
        return START_STICKY;
    }

    private boolean online() {
        try {
            android.net.ConnectivityManager cm = (android.net.ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            android.net.NetworkCapabilities nc = cm.getNetworkCapabilities(cm.getActiveNetwork());
            return nc != null && nc.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET);
        } catch (Throwable t) { return true; }
    }

    private void loop() {
        android.os.PowerManager.WakeLock wl = null;
        try {
            wl = ((android.os.PowerManager) getSystemService(POWER_SERVICE)).newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK, "studieshub:offline");
            wl.acquire(6 * 3600 * 1000L);
        } catch (Throwable t) { wl = null; }
        int failures = 0;
        while (true) {
            JSONObject j = OfflineStore.peek(this);
            if (j == null) {
                synchronized (OfflineService.class) { if (OfflineStore.peek(this) == null) { running = false; break; } }
                continue;
            }
            String slug = j.optString("slug"), uid = j.optString("uid"), title = j.optString("title");
            int total = done + OfflineStore.queued(this);
            if (!online()) {
                OfflineStore.STATUS.put(slug, "queued");
                update("Waiting for the internet", "Saving carries on by itself when your data or Wi-Fi is back. " + OfflineStore.queued(this) + " left.", -1);
                try { Thread.sleep(8000); } catch (InterruptedException e) { }
                continue;
            }
            update("Saving " + (done + 1) + " of " + total, title, 0);
            final int pos = done + 1;
            Thread pr = new Thread(() -> {
                String last = "";
                while (!Thread.currentThread().isInterrupted()) {
                    String st = OfflineStore.STATUS.get(slug);
                    if (st != null && st.startsWith("saving:") && !st.equals(last)) { last = st; try { update("Saving " + pos + " of " + total, title, Integer.parseInt(st.substring(7))); } catch (Exception e) { } }
                    try { Thread.sleep(700); } catch (InterruptedException e) { return; }
                }
            });
            pr.start();
            int r = OfflineStore.saveBlocking(this, uid, slug, title, j.optString("kind"), j.optString("course"));
            pr.interrupt();
            if (r == 0 || r == 2) { OfflineStore.drop(this, uid, slug); done++; failures = 0; }
            else { failures++; try { Thread.sleep(Math.min(30000, 3000L * failures)); } catch (InterruptedException e) { } }
        }
        try { if (wl != null && wl.isHeld()) wl.release(); } catch (Throwable t) { }
        done = 0;
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE); else stopForeground(true);
        stopSelf();
    }

    private long lastNote = 0;
    private void update(String title, String text, int pct) {
        long now = System.currentTimeMillis();
        if (pct > 0 && pct < 100 && now - lastNote < 700) return;
        lastNote = now;
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(NID, note(title, text, pct));
    }

    private Notification note(String title, String text, int pct) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CH) == null) {
            NotificationChannel c = new NotificationChannel(CH, "Saving materials", NotificationManager.IMPORTANCE_LOW);
            c.setSound(null, null);
            nm.createNotificationChannel(c);
        }
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CH) : new Notification.Builder(this);
        b.setSmallIcon(R.drawable.ic_stat).setColor(0xFF000000).setContentTitle(title).setContentText(text).setOngoing(true).setOnlyAlertOnce(true)
         .setContentIntent(PendingIntent.getActivity(this, 13, new Intent(this, MainActivity.class).putExtra("url", "/saved"), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        if (pct >= 0) b.setProgress(100, pct, false); else b.setProgress(0, 0, true);
        return b.build();
    }
}
