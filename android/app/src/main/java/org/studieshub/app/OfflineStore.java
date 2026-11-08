package org.studieshub.app;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceResponse;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Materials kept on the phone: the page, its file, and the little libraries the page needs, so they open with no internet. */
final class OfflineStore {
    static final String BASE = "https://studieshub.org";
    static volatile String userId = "0";
    /** true while the phone is offline or the network is not steady */
    static volatile boolean hard = false;
    static volatile boolean offline = false;
    static final ConcurrentHashMap<String, String> STATUS = new ConcurrentHashMap<>();

    private OfflineStore() { }

    static File dir(Context c) { File d = new File(c.getFilesDir(), "offline/u" + userId.replaceAll("[^0-9]", "")); d.mkdirs(); return d; }
    static File libDir(Context c) { File d = new File(c.getFilesDir(), "offline/lib"); d.mkdirs(); return d; }
    static File slugDir(Context c, String slug) { return new File(dir(c), slug.replaceAll("[^A-Za-z0-9_-]", "")); }
    static boolean has(Context c, String slug) { return new File(slugDir(c, slug), "meta.json").exists(); }

    static String sha(String s) {
        try {
            byte[] h = MessageDigest.getInstance("SHA-1").digest(s.getBytes(StandardCharsets.UTF_8));
            StringBuilder b = new StringBuilder();
            for (byte x : h) b.append(String.format("%02x", x));
            return b.toString();
        } catch (Exception e) { return "x"; }
    }

    static void remove(Context c, String slug) {
        File d = slugDir(c, slug);
        File[] fs = d.listFiles();
        if (fs != null) for (File f : fs) f.delete();
        d.delete();
        drop(c, userId, slug);
        STATUS.remove(slug);
    }

    static String list(Context c) {
        JSONArray a = new JSONArray();
        File[] ds = dir(c).listFiles();
        if (ds != null) for (File d : ds) {
            try {
                File m = new File(d, "meta.json");
                if (!m.exists()) continue;
                java.io.BufferedReader r = new java.io.BufferedReader(new java.io.FileReader(m));
                a.put(new JSONObject(r.readLine())); r.close();
            } catch (Exception e) { }
        }
        return a.toString();
    }

    private static HttpURLConnection get(String url, String ua, String cookie) throws Exception {
        HttpURLConnection h = (HttpURLConnection) new URL(url).openConnection();
        h.setConnectTimeout(15000); h.setReadTimeout(60000);
        h.setRequestProperty("User-Agent", ua);
        if (cookie != null && url.startsWith(BASE)) h.setRequestProperty("Cookie", cookie);
        return h;
    }

    private static long copy(HttpURLConnection h, File to, String slug, long expect) throws Exception {
        long n = 0;
        try (InputStream in = h.getInputStream(); FileOutputStream o = new FileOutputStream(to)) {
            byte[] b = new byte[65536]; int r;
            while ((r = in.read(b)) > 0) {
                o.write(b, 0, r); n += r;
                if (expect > 0) STATUS.put(slug, "saving:" + Math.min(95, 10 + (int) (n * 85 / expect)));
            }
        }
        return n;
    }

    static volatile String ua = "Mozilla/5.0 StudiesHubApp/1.0";

    static File slugDirFor(Context c, String uid, String slug) {
        File d = new File(c.getFilesDir(), "offline/u" + uid.replaceAll("[^0-9]", "") + "/" + slug.replaceAll("[^A-Za-z0-9_-]", ""));
        d.getParentFile().mkdirs();
        return d;
    }

    // ---- the saving queue (kept in a file, so it carries on after the app is closed or the phone restarts) ----
    private static final Object QLOCK = new Object();
    private static File queueFile(Context c) { File d = new File(c.getFilesDir(), "offline"); d.mkdirs(); return new File(d, "queue.json"); }

    private static JSONArray readQueue(Context c) {
        try {
            java.io.BufferedReader r = new java.io.BufferedReader(new java.io.FileReader(queueFile(c)));
            String l = r.readLine(); r.close();
            return new JSONArray(l == null ? "[]" : l);
        } catch (Exception e) { return new JSONArray(); }
    }

    private static void writeQueue(Context c, JSONArray a) {
        try (FileOutputStream o = new FileOutputStream(queueFile(c))) { o.write((a.toString() + "\n").getBytes(StandardCharsets.UTF_8)); } catch (Exception e) { }
    }

    static boolean enqueue(Context c, String slug, String title, String kind, String course) {
        synchronized (QLOCK) {
            if (has(c, slug)) { STATUS.put(slug, "saved"); return true; }
            JSONArray q = readQueue(c);
            for (int i = 0; i < q.length(); i++) if (slug.equals(q.optJSONObject(i).optString("slug")) && userId.equals(q.optJSONObject(i).optString("uid"))) return true;
            try { q.put(new JSONObject().put("uid", userId).put("slug", slug).put("title", title).put("kind", kind).put("course", course == null ? "" : course)); } catch (Exception e) { return false; }
            writeQueue(c, q);
            STATUS.put(slug, "queued");
        }
        OfflineService.start(c);
        return true;
    }

    static JSONObject peek(Context c) { synchronized (QLOCK) { JSONArray q = readQueue(c); return q.length() == 0 ? null : q.optJSONObject(0); } }
    static int queued(Context c) { synchronized (QLOCK) { return readQueue(c).length(); } }

    static void drop(Context c, String uid, String slug) {
        synchronized (QLOCK) {
            JSONArray q = readQueue(c), n = new JSONArray();
            for (int i = 0; i < q.length(); i++) { JSONObject o = q.optJSONObject(i); if (!(slug.equals(o.optString("slug")) && uid.equals(o.optString("uid")))) n.put(o); }
            writeQueue(c, n);
        }
    }

    /** 0 = saved, 1 = no network (try again later), 2 = cannot be saved (message in STATUS) */
    static int saveBlocking(Context c, String uid, String slug, String title, String kind, String course) {
        final String cookie = android.webkit.CookieManager.getInstance().getCookie(BASE);
        final File d = slugDirFor(c, uid, slug);
        STATUS.put(slug, "saving:2");
        try {
            d.mkdirs();
            HttpURLConnection h = get(BASE + "/p/" + slug, ua, cookie);
            int code = h.getResponseCode();
            if (code != 200) { h.disconnect(); if (code >= 500 || code == 408 || code == 429) throw new java.io.IOException("server " + code); throw new Exception(code == 401 || code == 403 ? "You can't save this one." : "The site answered " + code); }
            java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
            try (InputStream in = h.getInputStream()) { byte[] b = new byte[16384]; int r; while ((r = in.read(b)) > 0) bo.write(b, 0, r); }
            h.disconnect();
            String html = bo.toString("UTF-8");
            if (!html.contains("/p/" + slug + "/raw") && ("pdf".equals(kind) || "doc".equals(kind) || "video".equals(kind) || "image".equals(kind))) throw new Exception("This material is locked. Unlock it first, then save.");
            STATUS.put(slug, "saving:8");
            long size = 0;
            String mime = "text/html";
            if ("pdf".equals(kind) || "doc".equals(kind) || "video".equals(kind) || "image".equals(kind)) {
                HttpURLConnection f = get(BASE + "/p/" + slug + "/raw", ua, cookie);
                int fc = f.getResponseCode();
                if (fc != 200) { f.disconnect(); if (fc >= 500 || fc == 408 || fc == 429) throw new java.io.IOException("server " + fc); throw new Exception("Could not download the file (" + fc + ")."); }
                mime = f.getContentType() == null ? "application/octet-stream" : f.getContentType().split(";")[0];
                size = copy(f, new File(d, "raw.bin"), slug, Math.max(0, f.getContentLength()));
                f.disconnect();
            }
            Matcher m = Pattern.compile("(?:https://cdnjs\\.cloudflare\\.com/[^\"'\\s)<>]+|(?:src|href)=\"(/[^\"#?]+\\.(?:png|jpg|svg|css|js|ico|webp))\")").matcher(html);
            HashSet<String> urls = new HashSet<>();
            while (m.find()) urls.add(m.group(1) != null ? BASE + m.group(1) : m.group(0));
            for (String u : urls) {
                File lf = new File(libDir(c), sha(u));
                if (lf.exists()) continue;
                try {
                    HttpURLConnection l = get(u, ua, cookie);
                    if (l.getResponseCode() != 200) continue;
                    String lm = l.getContentType() == null ? "application/octet-stream" : l.getContentType().split(";")[0];
                    copy(l, lf, slug, 0);
                    l.disconnect();
                    try (FileOutputStream o = new FileOutputStream(new File(libDir(c), sha(u) + ".mime"))) { o.write(lm.getBytes(StandardCharsets.UTF_8)); }
                } catch (Exception e) { lf.delete(); }
            }
            try (FileOutputStream o = new FileOutputStream(new File(d, "page.html"))) { o.write(html.getBytes(StandardCharsets.UTF_8)); }
            JSONObject meta = new JSONObject().put("slug", slug).put("title", title).put("kind", kind).put("course", course == null ? "" : course).put("mime", mime).put("size", size).put("savedAt", System.currentTimeMillis());
            try (FileOutputStream o = new FileOutputStream(new File(d, "meta.json"))) { o.write((meta.toString() + "\n").getBytes(StandardCharsets.UTF_8)); }
            STATUS.put(slug, "saved");
            return 0;
        } catch (java.io.IOException e) {
            File[] fs = d.listFiles(); if (fs != null) for (File f : fs) f.delete(); d.delete();
            STATUS.put(slug, "queued");
            return 1;
        } catch (Exception e) {
            File[] fs = d.listFiles(); if (fs != null) for (File f : fs) f.delete(); d.delete();
            STATUS.put(slug, "error:" + (e.getMessage() == null ? "Could not save" : e.getMessage().replace("|", " ")));
            return 2;
        }
    }

    // ---- remembering the pages and pictures the person has opened, so they open again with no internet ----
    private static final java.util.concurrent.ExecutorService BG = java.util.concurrent.Executors.newSingleThreadExecutor();
    private static final HashMap<String, Long> recent = new HashMap<>();
    static final String NOINET = "No internet connection. Check your internet connection and try again.";

    static File pdir(Context c) { File d = new File(c.getFilesDir(), "offline/c" + userId.replaceAll("[^0-9]", "")); d.mkdirs(); return d; }
    static String pkey(String url) {
        String u = url.split("#")[0].replaceFirst("^https?://(www\\.)?studieshub\\.org", "");
        return sha(u.isEmpty() ? "/" : u);
    }
    private static boolean ourHost(Uri u) { String h = u.getHost() == null ? "" : u.getHost(); return h.equals("studieshub.org") || h.equals("www.studieshub.org"); }
    private static boolean pageOk(String path) {
        return !(path.startsWith("/api/") || path.startsWith("/logout") || path.startsWith("/call") || path.startsWith("/login") || path.startsWith("/signup")
            || path.startsWith("/auth") || path.startsWith("/forgot") || path.startsWith("/reset") || path.equals("/health") || path.equals("/sw.js")
            || path.endsWith(".apk") || path.matches("^/p/[^/]+/raw/?$"));
    }
    private static byte[] readAll(InputStream in, int max) throws java.io.IOException {
        java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
        byte[] b = new byte[16384]; int r;
        while ((r = in.read(b)) > 0) { bo.write(b, 0, r); if (bo.size() > max) return null; }
        return bo.toByteArray();
    }
    private static void store(File f, String mime, byte[] body) throws java.io.IOException {
        try (FileOutputStream o = new FileOutputStream(f)) { o.write(body); }
        try (FileOutputStream o = new FileOutputStream(new File(f.getPath() + ".mime"))) { o.write(mime.getBytes(StandardCharsets.UTF_8)); }
    }

    /** Quietly keeps a copy of a page the person just opened (only while online). */
    static void remember(Context c0, String url) {
        try {
            final Context c = c0.getApplicationContext();
            Uri u = Uri.parse(url);
            if (offline || "0".equals(userId) || !ourHost(u) || !pageOk(u.getPath() == null ? "/" : u.getPath())) return;
            synchronized (recent) {
                Long t = recent.get(url);
                if (t != null && System.currentTimeMillis() - t < 20000) return;
                recent.put(url, System.currentTimeMillis());
            }
            final String uid = userId, fu = url;
            BG.execute(() -> {
                try {
                    HttpURLConnection h = get(fu, ua, android.webkit.CookieManager.getInstance().getCookie(BASE));
                    h.setInstanceFollowRedirects(false);
                    String ct = h.getContentType();
                    if (h.getResponseCode() != 200 || ct == null || !ct.toLowerCase().startsWith("text/html")) { h.disconnect(); return; }
                    byte[] body = readAll(h.getInputStream(), 3000000);
                    h.disconnect();
                    if (body == null || !uid.equals(userId)) return;
                    store(new File(pdir(c), pkey(fu)), "text/html", body);
                } catch (Throwable t) { }
            });
        } catch (Throwable t) { }
    }

    /** Pictures are kept as they are shown, so the same pictures can be shown again with no internet. */
    private static WebResourceResponse teeImage(Context c, Uri u, Map<String, String> reqH) {
        try {
            String acc = reqH == null ? null : reqH.get("Accept");
            if (acc == null || !acc.contains("image/") || reqH.get("Range") != null || "0".equals(userId)) return null;
            if (!ourHost(u) || u.getPath() == null || u.getPath().matches("^/p/[^/]+/raw/?$")) return null;
            File f = new File(pdir(c), pkey(u.toString())), mf = new File(f.getPath() + ".mime");
            Map<String, String> hd = new HashMap<>(); hd.put("Cache-Control", "no-cache");
            if (f.exists() && mf.exists() && System.currentTimeMillis() - f.lastModified() < 120000) {
                String m = readLine(mf);
                return resp(m == null ? "image/png" : m, null, 200, "OK", hd, new FileInputStream(f));
            }
            HttpURLConnection h = get(u.toString(), ua, android.webkit.CookieManager.getInstance().getCookie(BASE));
            String ct = h.getContentType();
            if (h.getResponseCode() != 200 || ct == null || !ct.toLowerCase().startsWith("image/") || h.getContentLength() > 6000000) { h.disconnect(); return null; }
            byte[] b = readAll(h.getInputStream(), 6000000);
            h.disconnect();
            if (b == null) return null;
            String mime = ct.split(";")[0].trim();
            try { store(f, mime, b); } catch (Throwable t) { }
            return resp(mime, null, 200, "OK", hd, new ByteArrayInputStream(b));
        } catch (Throwable t) { return null; }
    }

    private static WebResourceResponse placeholder(String path) {
        boolean person = path.startsWith("/avatar/") || path.startsWith("/group-avatar/") || path.contains("avatar");
        String svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' fill='#3b3b4d'/>"
            + (person ? "<circle cx='50' cy='38' r='18' fill='#9a9ab0'/><path d='M14 100c0-22 16-36 36-36s36 14 36 36z' fill='#9a9ab0'/>"
                      : "<circle cx='68' cy='34' r='8' fill='#9a9ab0'/><path d='M18 78l22-30 15 20 10-12 17 22z' fill='#9a9ab0'/>") + "</svg>";
        Map<String, String> h = new HashMap<>(); h.put("Cache-Control", "no-store");
        return resp("image/svg+xml", "utf-8", 200, "OK", h, new ByteArrayInputStream(svg.getBytes(StandardCharsets.UTF_8)));
    }

    /** Keeps the remembered pages and pictures from growing without limit. */
    static void prune(Context c0) {
        BG.execute(() -> {
            try {
                File d = pdir(c0.getApplicationContext());
                File[] fs = d.listFiles(); if (fs == null) return;
                long tot = 0; for (File f : fs) tot += f.length();
                if (tot < 150L * 1048576) return;
                java.util.Arrays.sort(fs, (a, b) -> Long.compare(a.lastModified(), b.lastModified()));
                for (File f : fs) { if (tot < 110L * 1048576) break; tot -= f.length(); f.delete(); }
            } catch (Throwable t) { }
        });
    }

    // ---- serving to the WebView ----

    private static WebResourceResponse resp(String mime, String enc, int code, String reason, Map<String, String> hdr, InputStream in) {
        WebResourceResponse r = new WebResourceResponse(mime, enc, code, reason, hdr, in);
        return r;
    }

    private static String readLine(File f) { try (java.io.BufferedReader r = new java.io.BufferedReader(new java.io.FileReader(f))) { return r.readLine(); } catch (Exception e) { return null; } }

    private static class Limited extends InputStream {
        final InputStream in; long left;
        Limited(InputStream in, long n) { this.in = in; this.left = n; }
        @Override public int read() throws java.io.IOException { if (left <= 0) return -1; int b = in.read(); if (b >= 0) left--; return b; }
        @Override public int read(byte[] b, int o, int l) throws java.io.IOException { if (left <= 0) return -1; int n = in.read(b, o, (int) Math.min(l, left)); if (n > 0) left -= n; return n; }
        @Override public void close() throws java.io.IOException { in.close(); }
    }

    static WebResourceResponse serve(Context c, Uri u, String method, Map<String, String> reqH, boolean mainFrame) {
        try {
            if (!"GET".equalsIgnoreCase(method)) return null;
            String host = u.getHost() == null ? "" : u.getHost();
            String path = u.getPath() == null ? "" : u.getPath();
            // saved libraries (any host) are always read from the phone
            String full = u.toString().split("#")[0];
            File lf = new File(libDir(c), sha(full.contains("?") && host.endsWith("studieshub.org") ? full.substring(0, full.indexOf('?')) : full));
            if (lf.exists() && new File(lf.getPath() + ".mime").exists()) {
                String lm = readLine(new File(lf.getPath() + ".mime"));
                Map<String, String> h = new HashMap<>(); h.put("Cache-Control", "max-age=86400"); h.put("Access-Control-Allow-Origin", "*");
                return resp(lm == null ? "application/octet-stream" : lm, null, 200, "OK", h, new FileInputStream(lf));
            }
            if (!host.equals("studieshub.org") && !host.equals("www.studieshub.org")) return null;
            // The shared parts every page uses (styles and scripts) are carried inside the app itself: they open instantly, with or without data.
            Matcher am = Pattern.compile("^/assets/([a-f0-9]{12}\\.(js|css))$").matcher(path);
            if (am.find()) {
                try {
                    InputStream in = c.getAssets().open("webassets/" + am.group(1));
                    Map<String, String> h = new HashMap<>(); h.put("Cache-Control", "public, max-age=31536000, immutable"); h.put("Access-Control-Allow-Origin", "*");
                    return resp("js".equals(am.group(2)) ? "application/javascript" : "text/css", "utf-8", 200, "OK", h, in);
                } catch (IOException e) { /* not in this version of the app: fetch it from the site */ }
            }
            Matcher m = Pattern.compile("^/p/([A-Za-z0-9_-]+)(/raw)?/?$").matcher(path);
            if (m.find()) {
                String slug = m.group(1);
                File d = slugDir(c, slug);
                if (new File(d, "meta.json").exists()) {
                    if (m.group(2) != null && mainFrame) {
                        // Saved materials are for reading inside the app. Opening the file on its own (a download) is not allowed.
                        return resp("text/html", "utf-8", 403, "Forbidden", new HashMap<String, String>(), new ByteArrayInputStream("<html><body style='font-family:sans-serif;padding:24px'><h3>View only</h3><p>Saved materials can be read inside Studies Hub, but not downloaded.</p></body></html>".getBytes(StandardCharsets.UTF_8)));
                    }
                    if (m.group(2) != null && new File(d, "raw.bin").exists()) {
                        JSONObject meta = new JSONObject(readLine(new File(d, "meta.json")));
                        File raw = new File(d, "raw.bin");
                        long total = raw.length();
                        String range = reqH == null ? null : reqH.get("Range");
                        Map<String, String> h = new HashMap<>();
                        h.put("Accept-Ranges", "bytes"); h.put("Cache-Control", "no-store");
                        String mime = meta.optString("mime", "application/octet-stream");
                        if (range != null) {
                            Matcher rm = Pattern.compile("bytes=(\\d*)-(\\d*)").matcher(range);
                            if (rm.find() && (!rm.group(1).isEmpty() || !rm.group(2).isEmpty())) {
                                long s = rm.group(1).isEmpty() ? Math.max(0, total - Long.parseLong(rm.group(2))) : Long.parseLong(rm.group(1));
                                long e = rm.group(2).isEmpty() || rm.group(1).isEmpty() ? total - 1 : Math.min(total - 1, Long.parseLong(rm.group(2)));
                                if (s <= e && s < total) {
                                    FileInputStream in = new FileInputStream(raw); in.skip(s);
                                    h.put("Content-Range", "bytes " + s + "-" + e + "/" + total); h.put("Content-Length", String.valueOf(e - s + 1));
                                    return resp(mime, null, 206, "Partial Content", h, new Limited(in, e - s + 1));
                                }
                            }
                        }
                        h.put("Content-Length", String.valueOf(total));
                        return resp(mime, null, 200, "OK", h, new FileInputStream(raw));
                    }
                    // the page itself: from the phone only when there is no steady internet, so it stays fresh otherwise
                    if (m.group(2) == null && offline && new File(d, "page.html").exists()) {
                        Map<String, String> h = new HashMap<>(); h.put("Cache-Control", "no-store");
                        return resp("text/html", "utf-8", 200, "OK", h, new FileInputStream(new File(d, "page.html")));
                    }
                }
            }
            if (offline) {
                File cf = new File(pdir(c), pkey(u.toString())), cm = new File(cf.getPath() + ".mime");
                if (cf.exists() && cm.exists()) {
                    String cmime = readLine(cm);
                    Map<String, String> h = new HashMap<>(); h.put("Cache-Control", "no-store");
                    return resp(cmime == null ? "text/html" : cmime, cmime != null && cmime.startsWith("text/") ? "utf-8" : null, 200, "OK", h, new FileInputStream(cf));
                }
                // A weak connection is not "no connection": let the page try the network. Only when there truly is none, show the app's own empty frame.
                if (!hard) return null;
                if (mainFrame) {
                    Map<String, String> h = new HashMap<>(); h.put("Cache-Control", "no-store");
                    return resp("text/html", "utf-8", 200, "OK", h, new ByteArrayInputStream(offlinePage(c).getBytes(StandardCharsets.UTF_8)));
                }
                String acc = reqH == null ? null : reqH.get("Accept");
                if ((acc != null && acc.contains("image/")) || path.matches("(?i).*\\.(png|jpe?g|gif|webp|svg)$") || path.startsWith("/avatar/") || path.startsWith("/group-avatar/")) return placeholder(path);
                if (path.startsWith("/api/") || path.equals("/health")) {
                    return resp("application/json", "utf-8", 503, "Offline", new HashMap<String, String>(), new ByteArrayInputStream(("{\"error\":\"" + NOINET + "\"}").getBytes(StandardCharsets.UTF_8)));
                }
            } else {
                WebResourceResponse t = teeImage(c, u, reqH);
                if (t != null) return t;
            }
        } catch (Throwable t) { }
        return null;
    }

    private static String esc(String s) { return s == null ? "" : s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;"); }

    /** A page never opened on this phone, with no internet: the app's own frame (top bar, empty cards, bottom tabs), no message to read. */
    static String offlinePage(Context c) {
        String ico = "<svg width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>";
        return "<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Offline</title><style>"
            + ":root{color-scheme:dark light}*{box-sizing:border-box}body{margin:0;background:#0b0d14;color:#fff;font-family:system-ui,sans-serif;min-height:100vh}@media(prefers-color-scheme:light){body{background:#f3f4f8;color:#111}}"
            + ".bar{height:56px;display:flex;align-items:center;padding:0 20px;font-weight:700;font-size:20px;background:rgba(127,127,140,.12)}"
            + ".sk{margin:16px;height:92px;border-radius:18px;background:rgba(127,127,140,.14)}.sk.s{height:56px}"
            + ".tab{position:fixed;left:0;right:0;bottom:0;height:64px;display:flex;justify-content:space-around;align-items:center;background:rgba(127,127,140,.16)}.tab a{color:#5bc8ff;padding:14px}"
            + "</style></head><body><div class='bar'>Studies Hub</div><div class='sk'></div><div class='sk s'></div><div class='sk'></div><div class='sk s'></div><div class='sk'></div>"
            + "<div class='tab'><a href='/dashboard'>" + ico + "<path d='M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z'/></svg></a><a href='/news'>" + ico + "<rect x='4' y='3' width='16' height='18' rx='2'/><path d='M8 8h8M8 12h8M8 16h5'/></svg></a><a href='/chat'>" + ico + "<path d='M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z'/></svg></a><a href='/settings'>" + ico + "<path d='M4 6h16M4 12h16M4 18h16'/></svg></a></div>"
            + "<script>(function(){var A=window.StudiesApp;function pill(){var on=false;try{on=String(A.netState())==='offline'}catch(e){}var p=document.getElementById('shOffPill');if(on&&!p){p=document.createElement('div');p.id='shOffPill';p.textContent='Offline';p.style.cssText='position:fixed;top:14px;right:12px;background:rgba(60,60,70,.92);color:#fff;font:600 12px system-ui;padding:4px 10px;border-radius:999px';document.body.appendChild(p)}else if(!on&&p)p.remove()}window.__net=function(){pill()};pill()})()</script></body></html>";
    }
}
