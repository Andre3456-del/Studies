package org.studieshub.app;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;

import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.Scope;
import com.google.android.gms.tasks.Tasks;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.Arrays;
import java.util.concurrent.TimeUnit;

/**
 * Keeps the person's backup in their own Google Drive, in the hidden app folder only Studies Hub can see.
 * It uses their Google storage, not ours. Only the list of saved materials and the app settings go there.
 */
final class Gdrive {
    private Gdrive() { }

    static final int REQ = 7421;
    static final String SCOPE = "https://www.googleapis.com/auth/drive.appdata";
    static volatile String msg = "";

    static SharedPreferences p(Context c) { return c.getSharedPreferences("studieshub", Context.MODE_PRIVATE); }

    static boolean on(Context c) { return p(c).getBoolean("gd_on", false); }

    private static AuthorizationRequest request() {
        return AuthorizationRequest.builder().setRequestedScopes(Arrays.asList(new Scope(SCOPE))).build();
    }

    /** Asks the person to allow it (a Google screen), or finishes straight away if they already did. */
    static void connect(final Activity a) {
        msg = "Connecting…";
        try {
            Identity.getAuthorizationClient(a).authorize(request()).addOnSuccessListener(r -> {
                if (r.hasResolution()) {
                    try { a.startIntentSenderForResult(r.getPendingIntent().getIntentSender(), REQ, null, 0, 0, 0); }
                    catch (Throwable t) { msg = "Could not open the Google screen."; }
                } else granted(a);
            }).addOnFailureListener(e -> msg = "Google did not allow it: " + String.valueOf(e.getMessage()));
        } catch (Throwable t) { msg = "Could not start Google sign-in."; }
    }

    static void granted(final Context c) {
        p(c).edit().putBoolean("gd_on", true).apply();
        msg = "Connected. Looking for a backup…";
        new Thread(() -> peek(c)).start();
    }

    static void off(Context c) { p(c).edit().putBoolean("gd_on", false).remove("gd_found").apply(); msg = "Disconnected."; }

    static String info(Context c) {
        try {
            SharedPreferences s = p(c);
            JSONObject o = new JSONObject().put("on", s.getBoolean("gd_on", false)).put("last", s.getLong("gd_last", 0)).put("msg", msg);
            String f = s.getString("gd_found", null);
            if (f != null) o.put("found", new JSONObject(f));
            return o.toString();
        } catch (Exception e) { return "{}"; }
    }

    private static String token(Context c) throws Exception {
        AuthorizationResult r = Tasks.await(Identity.getAuthorizationClient(c).authorize(request()), 25, TimeUnit.SECONDS);
        return r.hasResolution() ? null : r.getAccessToken();
    }

    private static String name(Context c) { return "studieshub_backup_" + p(c).getString("off_uid", "0").replaceAll("[^0-9]", "") + ".json"; }

    private static String read(HttpURLConnection h) throws Exception {
        InputStream in = h.getResponseCode() < 400 ? h.getInputStream() : h.getErrorStream();
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        byte[] b = new byte[8192]; int n;
        while (in != null && (n = in.read(b)) > 0) o.write(b, 0, n);
        return o.toString("UTF-8");
    }

    private static HttpURLConnection open(String url, String tok, String method) throws Exception {
        HttpURLConnection h = (HttpURLConnection) new URL(url).openConnection();
        h.setConnectTimeout(15000); h.setReadTimeout(60000);
        h.setRequestProperty("Authorization", "Bearer " + tok);
        if ("PATCH".equals(method)) { h.setRequestMethod("POST"); h.setRequestProperty("X-HTTP-Method-Override", "PATCH"); }
        else h.setRequestMethod(method);
        return h;
    }

    private static String findId(Context c, String tok) throws Exception {
        String q = URLEncoder.encode("name='" + name(c) + "'", "UTF-8");
        HttpURLConnection h = open("https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id)&q=" + q, tok, "GET");
        String s = read(h);
        JSONArray a = new JSONObject(s).optJSONArray("files");
        return a != null && a.length() > 0 ? a.getJSONObject(0).getString("id") : null;
    }

    private static String download(String tok, String id) throws Exception {
        HttpURLConnection h = open("https://www.googleapis.com/drive/v3/files/" + id + "?alt=media", tok, "GET");
        if (h.getResponseCode() >= 400) return null;
        return read(h);
    }

    /** Looks for a backup already in the person's Drive and remembers what it holds. */
    static void peek(Context c) {
        try {
            String tok = token(c);
            if (tok == null) { msg = "Allow Google Drive again, please."; return; }
            String id = findId(c, tok);
            if (id == null) { p(c).edit().remove("gd_found").apply(); msg = "Connected. No backup in your Drive yet."; return; }
            String d = download(tok, id);
            JSONObject o = d == null ? null : new JSONObject(d);
            if (o == null) { msg = "Connected."; return; }
            p(c).edit().putString("gd_found", new JSONObject().put("at", o.optLong("at")).put("items", o.optJSONArray("items") == null ? 0 : o.getJSONArray("items").length()).toString()).apply();
            msg = "Connected. A backup was found in your Drive.";
        } catch (Throwable t) { msg = "Could not reach Google Drive."; }
    }

    /** Puts the backup in the person's Drive. Returns true when it worked. */
    static boolean backupNow(Context c) {
        try {
            String err = Backup.payloadError(c);
            if (err != null) { msg = err; return false; }
            String tok = token(c);
            if (tok == null) { msg = "Allow Google Drive again, please."; return false; }
            msg = "Backing up to Google Drive…";
            JSONObject pl = Backup.payload(c).put("at", System.currentTimeMillis()).put("v", 1);
            String json = pl.toString();
            String id = findId(c, tok);
            HttpURLConnection h;
            if (id == null) {
                String bd = "shbk" + System.currentTimeMillis();
                h = open("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", tok, "POST");
                h.setRequestProperty("Content-Type", "multipart/related; boundary=" + bd);
                String meta = new JSONObject().put("name", name(c)).put("parents", new JSONArray().put("appDataFolder")).toString();
                String body = "--" + bd + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + meta + "\r\n--" + bd + "\r\nContent-Type: application/json\r\n\r\n" + json + "\r\n--" + bd + "--";
                h.setDoOutput(true); h.getOutputStream().write(body.getBytes("UTF-8"));
            } else {
                h = open("https://www.googleapis.com/upload/drive/v3/files/" + id + "?uploadType=media", tok, "PATCH");
                h.setRequestProperty("Content-Type", "application/json");
                h.setDoOutput(true); h.getOutputStream().write(json.getBytes("UTF-8"));
            }
            int code = h.getResponseCode();
            String resp = read(h);
            if (code >= 200 && code < 300) {
                p(c).edit().putLong("gd_last", System.currentTimeMillis()).putString("gd_found", new JSONObject().put("at", System.currentTimeMillis()).put("items", pl.getJSONArray("items").length()).toString()).apply();
                msg = "Backed up to Google Drive.";
                return true;
            }
            msg = "Google Drive did not accept the backup (" + code + "): " + why(resp);
        } catch (Throwable t) { msg = "Could not reach Google Drive."; }
        return false;
    }

    /** Google's own words for what went wrong, shortened. */
    private static String why(String resp) {
        try {
            JSONObject e = new JSONObject(resp).getJSONObject("error");
            String m = e.optString("message", "");
            JSONArray er = e.optJSONArray("errors");
            String r = er != null && er.length() > 0 ? er.getJSONObject(0).optString("reason", "") : "";
            String t = (r.isEmpty() ? "" : r + ". ") + m;
            return t.length() > 220 ? t.substring(0, 220) : t;
        } catch (Throwable t) { return resp == null ? "" : (resp.length() > 160 ? resp.substring(0, 160) : resp); }
    }

    /** The backup stored in the person's Drive, or null. */
    static String restoreData(Context c) {
        try {
            String tok = token(c);
            if (tok == null) { msg = "Allow Google Drive again, please."; return null; }
            String id = findId(c, tok);
            if (id == null) return null;
            return download(tok, id);
        } catch (Throwable t) { msg = "Could not reach Google Drive."; return null; }
    }
}
