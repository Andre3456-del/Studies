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

    static void save(final Context c, final String ua, final String cookie, final String slug, final String title, final String kind, final String course) {
        if (STATUS.containsKey(slug) && STATUS.get(slug).startsWith("saving")) return;
        STATUS.put(slug, "saving:2");
        final File d = slugDir(c, slug);
        new Thread(() -> {
            try {
                d.mkdirs();
                // 1. the page itself
                HttpURLConnection h = get(BASE + "/p/" + slug, ua, cookie);
                if (h.getResponseCode() != 200) throw new Exception(h.getResponseCode() == 401 || h.getResponseCode() == 403 ? "You can't save this one." : "The site answered " + h.getResponseCode());
                java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
                try (InputStream in = h.getInputStream()) { byte[] b = new byte[16384]; int r; while ((r = in.read(b)) > 0) bo.write(b, 0, r); }
                h.disconnect();
                String html = bo.toString("UTF-8");
                // A page asking for payment or sign-in is not the material.
                if (!html.contains("/p/" + slug + "/raw") && ("pdf".equals(kind) || "doc".equals(kind) || "video".equals(kind))) throw new Exception("This material is locked. Unlock it first, then save.");
                STATUS.put(slug, "saving:8");
                // 2. the file
                long size = 0;
                String mime = "text/html";
                if ("pdf".equals(kind) || "doc".equals(kind) || "video".equals(kind)) {
                    HttpURLConnection f = get(BASE + "/p/" + slug + "/raw", ua, cookie);
                    if (f.getResponseCode() != 200) throw new Exception("Could not download the file (" + f.getResponseCode() + ").");
                    mime = f.getContentType() == null ? "application/octet-stream" : f.getContentType().split(";")[0];
                    size = copy(f, new File(d, "raw.bin"), slug, Math.max(0, f.getContentLength()));
                    f.disconnect();
                }
                // 3. the pieces the page needs (the PDF reader, fonts of the page, small pictures)
                Matcher m = Pattern.compile("(?:https://cdnjs\\.cloudflare\\.com/[^\"'\\s)<>]+|(?:src|href)=\"(/[^\"#?]+\\.(?:png|jpg|svg|css|js|ico|webp))\")").matcher(html);
                HashSet<String> urls = new HashSet<>();
                while (m.find()) {
                    String u = m.group(1) != null ? BASE + m.group(1) : m.group(0);
                    urls.add(u);
                }
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
            } catch (Exception e) {
                File[] fs = d.listFiles();
                if (fs != null) for (File f : fs) f.delete();
                d.delete();
                STATUS.put(slug, "error:" + (e.getMessage() == null ? "Network problem" : e.getMessage().replace("|", " ")));
            }
        }).start();
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
                if (mainFrame) {
                    Map<String, String> h = new HashMap<>(); h.put("Cache-Control", "no-store");
                    return resp("text/html", "utf-8", 200, "OK", h, new ByteArrayInputStream(offlinePage(c).getBytes(StandardCharsets.UTF_8)));
                }
                if (path.startsWith("/api/") || path.equals("/health")) {
                    return resp("application/json", "utf-8", 503, "Offline", new HashMap<String, String>(), new ByteArrayInputStream("{\"error\":\"You are offline.\"}".getBytes(StandardCharsets.UTF_8)));
                }
            }
        } catch (Throwable t) { }
        return null;
    }

    private static String esc(String s) { return s == null ? "" : s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;"); }

    static String offlinePage(Context c) {
        StringBuilder b = new StringBuilder();
        try {
            JSONArray a = new JSONArray(list(c));
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.getJSONObject(i);
                String k = o.optString("kind");
                b.append("<a class='it' href='/p/").append(esc(o.optString("slug"))).append("'><span class='ic'>").append("pdf".equals(k) ? "\uD83D\uDCD5" : "video".equals(k) ? "\uD83C\uDFAC" : "\uD83D\uDCC4").append("</span><span class='tx'><b>").append(esc(o.optString("title"))).append("</b><small>").append(esc(o.optString("course"))).append(o.optString("course").isEmpty() ? "" : " \u00b7 ").append(String.format("%.1f MB", o.optLong("size") / 1048576.0)).append("</small></span></a>");
            }
        } catch (Exception e) { }
        String list = b.length() == 0 ? "<p class='mut'>Nothing is saved on this phone yet.<br>When you are online, open a material and tap <b>Save for offline</b>.</p>" : b.toString();
        return "<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Offline</title><style>"
            + ":root{color-scheme:dark light}body{margin:0;background:#000;color:#fff;font-family:system-ui,sans-serif;padding:20px 16px 40px}@media(prefers-color-scheme:light){body{background:#fff;color:#111}.it{background:#f1f1f5!important}}"
            + "h1{margin:6px 0 4px;font-size:24px}.mut{opacity:.7;line-height:1.5}.top{background:#1d1b3a;border-radius:16px;padding:16px;margin-bottom:18px}@media(prefers-color-scheme:light){.top{background:#ecebff}}"
            + ".it{display:flex;gap:12px;align-items:center;text-decoration:none;color:inherit;background:#15151f;border-radius:14px;padding:14px;margin:10px 0}.ic{font-size:28px}.tx{display:block;min-width:0}.tx b{display:block}.tx small{opacity:.65}"
            + "button{font-size:16px;padding:12px 24px;border:0;border-radius:12px;background:#6c63ff;color:#fff;margin-top:8px}"
            + "</style></head><body><div class='top'><h1>You are offline</h1><p class='mut' style='margin:0'>Only the materials you saved on this phone are available. Everything else needs the internet.</p><button onclick=\"location.href='/'\">Try again</button></div>"
            + "<h3>Saved on this phone</h3>" + list + "</body></html>";
    }
}
