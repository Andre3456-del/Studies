package org.studieshub.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.os.StatFs;
import android.webkit.CookieManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;

/**
 * Backs up the list of what the person saved in the app (and their app settings) to their Studies Hub account,
 * so a fresh install can bring it all back. The files themselves are not copied: they are downloaded again from the site on restore.
 * The person picks how often, and whether mobile data may be used.
 */
final class Backup {
    private Backup() { }

    static SharedPreferences p(Context c) { return c.getSharedPreferences("studieshub", Context.MODE_PRIVATE); }

    static long days(String f) { return "day".equals(f) ? 1 : "week".equals(f) ? 7 : "month".equals(f) ? 30 : 0; }

    static String get(Context c) {
        try {
            SharedPreferences s = p(c);
            return new JSONObject().put("freq", s.getString("bk_freq", "off")).put("wifiOnly", s.getBoolean("bk_wifi", true)).put("last", s.getLong("bk_last", 0)).toString();
        } catch (Exception e) { return "{}"; }
    }

    static void set(Context c, String freq, boolean wifiOnly) {
        p(c).edit().putString("bk_freq", freq == null ? "off" : freq).putBoolean("bk_wifi", wifiOnly).apply();
        PingJob.schedule(c);
    }

    private static long size(File f) {
        if (f == null || !f.exists()) return 0;
        if (f.isFile()) return f.length();
        long n = 0;
        File[] k = f.listFiles();
        if (k != null) for (File x : k) n += size(x);
        return n;
    }

    /** How much room the app takes on the phone, and how much the phone has. */
    static String space(Context c) {
        try {
            StatFs s = new StatFs(c.getFilesDir().getPath());
            long app = size(c.getFilesDir()) + size(c.getCacheDir());
            return new JSONObject().put("app", app).put("free", s.getAvailableBytes()).put("total", s.getTotalBytes()).toString();
        } catch (Exception e) { return "{}"; }
    }

    private static boolean busy() {
        for (String v : OfflineStore.STATUS.values()) if (v != null && (v.equals("queued") || v.startsWith("saving"))) return true;
        return false;
    }

    /** Is a scheduled backup due, and is the connection one the person allowed? */
    static boolean due(Context c) {
        try {
            SharedPreferences s = p(c);
            long d = days(s.getString("bk_freq", "off"));
            if (d == 0) return false;
            if (System.currentTimeMillis() - s.getLong("bk_last", 0) < d * 86400000L - 600000L) return false;
            ConnectivityManager cm = (ConnectivityManager) c.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null || cm.getActiveNetworkInfo() == null) return false;
            if (s.getBoolean("bk_wifi", true) && cm.isActiveNetworkMetered()) return false;
            return true;
        } catch (Throwable t) { return false; }
    }

    /** Why a backup must not be made right now, or null when it can go ahead. */
    static String payloadError(Context c) {
        try {
            SharedPreferences s = p(c);
            OfflineStore.userId = s.getString("off_uid", "0");
            if (busy()) return "Saving is still running. Try again when it is done.";
            // An empty phone must never replace a backup that is waiting to be restored.
            if (new JSONArray(OfflineStore.list(c)).length() == 0) return "Nothing saved on this phone yet.";
            return null;
        } catch (Throwable t) { return "Could not read what is saved."; }
    }

    static JSONObject payload(Context c) throws Exception {
        SharedPreferences s = p(c);
        OfflineStore.userId = s.getString("off_uid", "0");
        JSONObject prefs = new JSONObject().put("auto", s.getBoolean("off_auto", false)).put("wifi", s.getBoolean("off_wifi", false))
            .put("bkFreq", s.getString("bk_freq", "off")).put("bkWifi", s.getBoolean("bk_wifi", true));
        return new JSONObject().put("items", new JSONArray(OfflineStore.list(c))).put("prefs", prefs);
    }

    /** Sends the backup now. Returns "ok" or a short reason. */
    static String run(Context c) {
        try {
            SharedPreferences s = p(c);
            String err = payloadError(c);
            if (err != null) return err;
            String cookie = CookieManager.getInstance().getCookie("https://studieshub.org");
            if (cookie == null || !cookie.contains("sid=")) return "Log in first.";
            byte[] body = payload(c).toString().getBytes("UTF-8");
            java.net.HttpURLConnection h = (java.net.HttpURLConnection) new java.net.URL("https://studieshub.org/api/backup").openConnection();
            h.setRequestMethod("POST");
            h.setConnectTimeout(15000); h.setReadTimeout(30000);
            h.setRequestProperty("Cookie", cookie);
            h.setRequestProperty("Content-Type", "application/json");
            h.setDoOutput(true);
            h.getOutputStream().write(body);
            int code = h.getResponseCode();
            h.disconnect();
            if (code >= 200 && code < 300) { s.edit().putLong("bk_last", System.currentTimeMillis()).apply(); return "ok"; }
            return "The server did not accept the backup (" + code + ").";
        } catch (Throwable t) { return "Could not reach the server."; }
    }
}
