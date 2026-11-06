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
    static class Job { String id, url, fields, afterUrl, afterJson, title, name, mime, open; volatile boolean cancel; }
    static final ConcurrentLinkedQueue<Job> QUEUE = new ConcurrentLinkedQueue<>();
    /** id -> {state, pct}; state 1 queued, 2 running, 3 done, 4 failed */
    static final ConcurrentHashMap<String, int[]> STATUS = new ConcurrentHashMap<>();
    static final ConcurrentHashMap<String, Job> ALL = new ConcurrentHashMap<>();
    private static volatile boolean running = false;
    private static final String CH = "upload_progress";
    private static final int NID = 9001;
    private long lastNote = 0;

    static File cacheFile(Context c, String id) { return new File(c.getCacheDir(), "up_" + id.replaceAll("[^A-Za-z0-9_-]", "") + ".bin"); }

    static File metaFile(Context c, String id) { return new File(c.getCacheDir(), "up_" + id.replaceAll("[^A-Za-z0-9_-]", "") + ".json"); }

    static void save(Context c, Job j) {
        try {
            JSONObject o = new JSONObject().put("id", j.id).put("url", j.url).put("fields", j.fields).put("afterUrl", j.afterUrl).put("afterJson", j.afterJson).put("title", j.title).put("name", j.name).put("mime", j.mime).put("open", j.open == null ? "" : j.open);
            java.io.FileWriter w = new java.io.FileWriter(metaFile(c, j.id)); w.write(o.toString()); w.close();
        } catch (Exception e) { }
    }

    static boolean retry(Context c, String id) {
        Job j = ALL.get(id);
        try {
            if (j == null) {
                java.io.BufferedReader r = new java.io.BufferedReader(new java.io.FileReader(metaFile(c, id)));
                JSONObject o = new JSONObject(r.readLine()); r.close();
                j = new Job(); j.id = id; j.url = o.getString("url"); j.fields = o.optString("fields"); j.afterUrl = o.optString("afterUrl"); j.afterJson = o.optString("afterJson"); j.title = o.optString("title"); j.name = o.optString("name"); j.mime = o.optString("mime"); j.open = o.optString("open");
            }
        } catch (Exception e) { return false; }
        if (!cacheFile(c, id).exists()) return false;
        j.cancel = false;
        ((NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(9100 + (id.hashCode() & 0xff));
        enqueue(c, j);
        return true;
    }

    static void enqueue(Context c, Job j) {
        save(c, j);
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
        try { for (File x : getCacheDir().listFiles()) if (x.getName().startsWith("up_") && System.currentTimeMillis() - x.lastModified() > 3L * 86400000L) x.delete(); } catch (Throwable t) { }
        synchronized (UploadService.class) {
            if (!running) {
                running = true;
                new Thread(this::loop).start();
            }
        }
        return START_NOT_STICKY;
    }

    private void loop() {
        while (true) {
            Job j;
            while ((j = QUEUE.poll()) != null) {
                if (j.cancel) { STATUS.put(j.id, new int[]{4, 0}); cacheFile(this, j.id).delete(); continue; }
                run(j);
            }
            synchronized (UploadService.class) { if (QUEUE.isEmpty()) { running = false; break; } }
        }
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE); else stopForeground(true);
        stopSelf();
    }

    static final ConcurrentHashMap<String, String> ERR = new ConcurrentHashMap<>();
    private static final int PIECE = 1024 * 1024;

    private static String b64(String x) { return android.util.Base64.encodeToString(x.getBytes(StandardCharsets.UTF_8), android.util.Base64.NO_WRAP); }

    private String readAll(HttpURLConnection h) {
        try {
            InputStream in = h.getResponseCode() >= 400 ? h.getErrorStream() : h.getInputStream();
            if (in == null) return "";
            java.io.ByteArrayOutputStream o = new java.io.ByteArrayOutputStream();
            byte[] b = new byte[4096]; int r;
            while ((r = in.read(b)) > 0 && o.size() < 20000) o.write(b, 0, r);
            return o.toString("UTF-8");
        } catch (Exception e) { return ""; }
    }

    private static String jsonError(String body) {
        try { return new JSONObject(body).optString("error", ""); } catch (Exception e) { return ""; }
    }

    private HttpURLConnection open(String path, String method, String ck) throws Exception {
        HttpURLConnection h = (HttpURLConnection) new URL(BASE + path).openConnection();
        h.setRequestMethod(method);
        h.setConnectTimeout(15000); h.setReadTimeout(60000);
        if (ck != null) h.setRequestProperty("Cookie", ck);
        return h;
    }

    private void run(Job j) {
        File f = cacheFile(this, j.id);
        STATUS.put(j.id, new int[]{2, 0});
        ERR.remove(j.id);
        update(j, 0);
        boolean ok = false, hard = false;
        String why = "";
        android.os.PowerManager.WakeLock wl = null;
        try {
            android.os.PowerManager pm = (android.os.PowerManager) getSystemService(Context.POWER_SERVICE);
            wl = pm.newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK, "studieshub:upload");
            wl.acquire(2 * 3600 * 1000L);
        } catch (Throwable t) { wl = null; }
        try {
            if (!f.exists()) throw new Exception("The file is no longer on this phone.");
            String ck = CookieManager.getInstance().getCookie(BASE);
            long total = f.length();
            int pieces = (int) Math.max(1, (total + PIECE - 1) / PIECE);
            // What has the site already got from an earlier try?
            java.util.HashSet<Integer> have = new java.util.HashSet<>();
            try {
                HttpURLConnection h = open("/api/upload/status/" + j.id, "GET", ck);
                if (h.getResponseCode() == 200) {
                    JSONArray a = new JSONObject(readAll(h)).getJSONArray("have");
                    for (int k = 0; k < a.length(); k++) have.add(a.getInt(k));
                } else if (h.getResponseCode() == 401) { hard = true; throw new Exception("You are signed out. Open the app and sign in again."); }
                h.disconnect();
            } catch (java.io.IOException e) { /* offline: the piece loop below will retry */ }
            java.io.RandomAccessFile raf = new java.io.RandomAccessFile(f, "r");
            byte[] buf = new byte[PIECE];
            for (int k = 0; k < pieces; k++) {
                if (j.cancel) throw new Exception("cancelled");
                if (!have.contains(k)) {
                    raf.seek((long) k * PIECE);
                    int n = raf.read(buf, 0, (int) Math.min(PIECE, total - (long) k * PIECE));
                    if (n <= 0) throw new Exception("Could not read the file.");
                    boolean sent = false;
                    String last = "";
                    for (int attempt = 0; attempt < 8 && !sent; attempt++) {
                        if (j.cancel) throw new Exception("cancelled");
                        try {
                            HttpURLConnection h = open("/api/upload/chunk/" + j.id + "/" + k, "POST", ck);
                            h.setDoOutput(true);
                            h.setRequestProperty("Content-Type", "application/octet-stream");
                            h.setFixedLengthStreamingMode(n);
                            OutputStream os = h.getOutputStream();
                            os.write(buf, 0, n); os.flush();
                            int code = h.getResponseCode();
                            String body = readAll(h);
                            h.disconnect();
                            if (code == 200) sent = true;
                            else if (code == 401) { hard = true; throw new Exception("You are signed out. Open the app and sign in again."); }
                            else last = "The site answered " + code;
                        } catch (java.io.IOException e) { last = "No connection to the site"; }
                        if (!sent) { try { Thread.sleep(Math.min(15000, 1000L << attempt)); } catch (InterruptedException ie) { } }
                    }
                    if (!sent) throw new Exception(last.isEmpty() ? "Network problem" : last);
                }
                long done = Math.min(total, (long) (k + 1) * PIECE);
                int pct = (int) Math.min(99, done * 100 / Math.max(1, total));
                STATUS.put(j.id, new int[]{2, pct});
                update(j, pct);
            }
            raf.close();
            // Tell the site to join the pieces and finish the job, same as a normal upload would.
            JSONArray fl = new JSONArray(j.fields == null || j.fields.isEmpty() ? "[]" : j.fields), keep = new JSONArray();
            for (int k = 0; k < fl.length(); k++) { JSONArray p = fl.getJSONArray(k); if (!"__file".equals(p.getString(0))) keep.put(p); }
            String lastErr = "";
            for (int attempt = 0; attempt < 5 && !ok; attempt++) {
                try {
                    HttpURLConnection h = open(j.url, "POST", ck);
                    h.setDoOutput(true);
                    h.setFixedLengthStreamingMode(0);
                    h.setRequestProperty("X-Assembled", j.id);
                    h.setRequestProperty("X-Chunks", String.valueOf(pieces));
                    h.setRequestProperty("X-Fields", b64(keep.toString()));
                    h.setRequestProperty("X-Filename", b64(j.name));
                    h.setRequestProperty("X-Mime", j.mime);
                    h.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
                    h.getOutputStream().close();
                    int code = h.getResponseCode();
                    String body = readAll(h);
                    h.disconnect();
                    if (code >= 200 && code < 400) ok = true;
                    else if (code == 409 || code >= 500 || code == 408 || code == 429) lastErr = "The site answered " + code;
                    else { hard = true; String m = jsonError(body); throw new Exception(m.isEmpty() ? "The site refused the file (" + code + ")" : m); }
                } catch (java.io.IOException e) { lastErr = "No connection to the site"; }
                if (!ok) { try { Thread.sleep(2000L * (attempt + 1)); } catch (InterruptedException ie) { } }
            }
            if (!ok) throw new Exception(lastErr.isEmpty() ? "Network problem" : lastErr);
            if (j.afterUrl != null && !j.afterUrl.isEmpty()) {
                try {
                    HttpURLConnection a = open(j.afterUrl, "POST", ck);
                    a.setDoOutput(true);
                    a.setRequestProperty("Content-Type", "application/json");
                    a.getOutputStream().write((j.afterJson == null ? "{}" : j.afterJson).getBytes(StandardCharsets.UTF_8));
                    a.getResponseCode(); a.disconnect();
                } catch (Exception e) { /* caption is best effort */ }
            }
        } catch (Exception e) { ok = false; if (!j.cancel) why = e.getMessage() == null ? "Network problem" : e.getMessage(); }
        finally { try { if (wl != null && wl.isHeld()) wl.release(); } catch (Throwable t) { } }
        if (ok || j.cancel || hard) { f.delete(); metaFile(this, j.id).delete(); }
        if (!ok) ERR.put(j.id, why.replace("|", " "));
        STATUS.put(j.id, new int[]{ok ? 3 : 4, ok ? 100 : 0});
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (ok) {
            // Tell the person it went through; it stays until they open it.
            String url = j.open == null || j.open.isEmpty() ? "/" : j.open;
            Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, Sounds.channel(this, "uploads")) : new Notification.Builder(this);
            b.setSmallIcon(R.drawable.ic_stat).setColor(0xFF000000).setContentTitle("Upload complete").setContentText(j.title + " has been uploaded. Tap to open.").setAutoCancel(true)
             .setContentIntent(PendingIntent.getActivity(this, 15 + (j.id.hashCode() & 0xff), new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP).putExtra("url", url), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
            nm.notify(9300 + (j.id.hashCode() & 0xff), b.build());
            getSharedPreferences("noteurls", MODE_PRIVATE).edit().putInt(url, 9300 + (j.id.hashCode() & 0xff)).apply();
        }
        if (!ok && !j.cancel) {
            Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CH) : new Notification.Builder(this);
            b.setSmallIcon(R.drawable.ic_stat).setColor(0xFF000000).setContentTitle(hard ? "Upload failed" : "Upload paused").setContentText(j.title + ": " + why + (hard ? "" : ". Tap Retry to continue.")).setAutoCancel(true)
             .setContentIntent(PendingIntent.getActivity(this, 11, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
            if (!hard) {
                Intent ri = new Intent(this, UploadRetryReceiver.class).putExtra("id", j.id);
                b.addAction(new Notification.Action.Builder(R.drawable.ic_stat, "Retry", PendingIntent.getBroadcast(this, 9100 + (j.id.hashCode() & 0xff), ri, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT)).build());
            }
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
