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
import android.webkit.CookieManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;

/** Uploads files on its own, so they keep going when the person leaves the chat or closes the app. */
public class UploadService extends Service {
    static final String BASE = "https://studieshub.org";
    static class Job { String id, url, fields, afterUrl, afterJson, title, name, mime; volatile boolean cancel; }
    static final ConcurrentLinkedQueue<Job> QUEUE = new ConcurrentLinkedQueue<>();
    /** id -> {state, pct}; state 1 queued, 2 running, 3 done, 4 failed */
    static final ConcurrentHashMap<String, int[]> STATUS = new ConcurrentHashMap<>();
    static final ConcurrentHashMap<String, Job> ALL = new ConcurrentHashMap<>();
    private static volatile boolean running = false;
    private static final String CH = "upload_progress";
    private static final int NID = 9001;
    private long lastNote = 0;

    static File cacheFile(Context c, String id) { return new File(c.getCacheDir(), "up_" + id.replaceAll("[^A-Za-z0-9_-]", "") + ".bin"); }

    static void enqueue(Context c, Job j) {
        STATUS.put(j.id, new int[]{1, 0});
        ALL.put(j.id, j);
        QUEUE.add(j);
        Intent i = new Intent(c, UploadService.class);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
    }

    @Override public IBinder onBind(Intent i) { return null; }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        Notification n = build("Getting your upload ready", "", -1);
        if (Build.VERSION.SDK_INT >= 29) startForeground(NID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC); else startForeground(NID, n);
        synchronized (UploadService.class) {
            if (!running) {
                running = true;
                new Thread(this::loop).start();
            }
        }
        return START_NOT_STICKY;
    }

    private void loop() {
        Job j;
        while ((j = QUEUE.poll()) != null) {
            if (j.cancel) { STATUS.put(j.id, new int[]{4, 0}); cacheFile(this, j.id).delete(); continue; }
            run(j);
        }
        synchronized (UploadService.class) { running = false; }
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE); else stopForeground(true);
        stopSelf();
    }

    private void run(Job j) {
        File f = cacheFile(this, j.id);
        STATUS.put(j.id, new int[]{2, 0});
        update(j, 0);
        boolean ok = false;
        try {
            if (!f.exists()) throw new Exception("missing");
            String boundary = "----sh" + System.nanoTime();
            StringBuilder head = new StringBuilder();
            String fileField = "file";
            JSONArray fl = new JSONArray(j.fields == null || j.fields.isEmpty() ? "[]" : j.fields);
            for (int k = 0; k < fl.length(); k++) {
                JSONArray p = fl.getJSONArray(k);
                if ("__file".equals(p.getString(0))) { fileField = p.getString(1).replaceAll("[^A-Za-z0-9_-]", ""); continue; }
                head.append("--").append(boundary).append("\r\nContent-Disposition: form-data; name=\"").append(p.getString(0).replace("\"", "")).append("\"\r\n\r\n").append(p.getString(1)).append("\r\n");
            }
            head.append("--").append(boundary).append("\r\nContent-Disposition: form-data; name=\"").append(fileField).append("\"; filename=\"").append(j.name.replace("\"", "").replace("\r", "").replace("\n", "")).append("\"\r\nContent-Type: ").append(j.mime).append("\r\n\r\n");
            byte[] hb = head.toString().getBytes(StandardCharsets.UTF_8), tb = ("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8);
            long total = f.length();
            HttpURLConnection h = (HttpURLConnection) new URL(BASE + j.url).openConnection();
            h.setRequestMethod("POST");
            h.setConnectTimeout(20000); h.setReadTimeout(120000);
            h.setDoOutput(true);
            h.setFixedLengthStreamingMode(hb.length + total + tb.length);
            String ck = CookieManager.getInstance().getCookie(BASE);
            if (ck != null) h.setRequestProperty("Cookie", ck);
            h.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
            OutputStream os = h.getOutputStream();
            os.write(hb);
            byte[] buf = new byte[65536];
            long sent = 0;
            try (InputStream in = new FileInputStream(f)) {
                int r;
                while ((r = in.read(buf)) > 0) {
                    if (j.cancel) { h.disconnect(); throw new Exception("cancelled"); }
                    os.write(buf, 0, r);
                    sent += r;
                    int pct = total == 0 ? 100 : (int) Math.min(100, sent * 100 / total);
                    STATUS.put(j.id, new int[]{2, pct});
                    update(j, pct);
                }
            }
            os.write(tb);
            os.flush();
            int code = h.getResponseCode();
            ok = code >= 200 && code < 400;
            h.disconnect();
            if (ok && j.afterUrl != null && !j.afterUrl.isEmpty()) {
                try {
                    HttpURLConnection a = (HttpURLConnection) new URL(BASE + j.afterUrl).openConnection();
                    a.setRequestMethod("POST"); a.setDoOutput(true);
                    if (ck != null) a.setRequestProperty("Cookie", ck);
                    a.setRequestProperty("Content-Type", "application/json");
                    a.getOutputStream().write((j.afterJson == null ? "{}" : j.afterJson).getBytes(StandardCharsets.UTF_8));
                    a.getResponseCode(); a.disconnect();
                } catch (Exception e) { /* caption is best effort */ }
            }
        } catch (Exception e) { ok = false; }
        f.delete();
        STATUS.put(j.id, new int[]{ok ? 3 : 4, ok ? 100 : 0});
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (!ok && !j.cancel) {
            Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CH) : new Notification.Builder(this);
            b.setSmallIcon(R.drawable.ic_stat).setColor(0xFF000000).setContentTitle("Upload did not finish").setContentText(j.title + " could not be uploaded. Open the app and try again.").setAutoCancel(true)
             .setContentIntent(PendingIntent.getActivity(this, 11, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
            nm.notify(9100 + (j.id.hashCode() & 0xff), b.build());
        }
    }

    private void update(Job j, int pct) {
        long now = System.currentTimeMillis();
        if (pct < 100 && pct > 0 && now - lastNote < 600) return;
        lastNote = now;
        int more = QUEUE.size();
        ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE)).notify(NID, build("Uploading " + j.title, pct + "%" + (more > 0 ? "  ·  " + more + " waiting" : ""), pct));
    }

    private Notification build(String title, String text, int pct) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CH) == null) {
            NotificationChannel c = new NotificationChannel(CH, "Uploads in progress", NotificationManager.IMPORTANCE_LOW);
            c.setSound(null, null);
            nm.createNotificationChannel(c);
        }
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CH) : new Notification.Builder(this);
        b.setSmallIcon(R.drawable.ic_stat).setColor(0xFF000000).setContentTitle(title).setContentText(text).setOngoing(true).setOnlyAlertOnce(true)
         .setContentIntent(PendingIntent.getActivity(this, 12, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        if (pct >= 0) b.setProgress(100, pct, false); else b.setProgress(0, 0, true);
        return b.build();
    }
}
