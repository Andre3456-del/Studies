package org.studieshub.app;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.webkit.GeolocationPermissions;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.GetCredentialException;
import com.google.android.libraries.identity.googleid.GetGoogleIdOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** Studies Hub: the website inside its own full-screen app window (no browser bar). */
public class MainActivity extends Activity {
    private static final String HOME = "https://studieshub.org/";
    private static final int REQ_FILE = 11, REQ_PERM = 12, REQ_GEO = 14, REQ_FIRST = 13, REQ_NOTE = 15;

    private WebView web;
    private View splash;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest pendingWebPerm;
    private String answerCall;
    // App lock
    private boolean lockOn, locked, authing, skipLock;
    private int lockMin;
    private long leftAt;
    private View overlay;
    private Runnable pendingOk, pendingFail;
    private static final int REQ_LOCK = 16, REQ_SND = 18;
    private String soundCat;
    private long lastUpdateCheck;
    private boolean inCall, frameBusy;
    private static final int REQ_PROJ = 17;
    private int dismissedVersion;
    private boolean updateAsked;
    private GeolocationPermissions.Callback geoCb;
    private String geoOrigin;

    private static boolean ours(Uri u) {
        String h = u.getHost();
        return h != null && (h.equals("studieshub.org") || h.endsWith(".studieshub.org"));
    }

    private boolean online() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        NetworkInfo n = cm == null ? null : cm.getActiveNetworkInfo();
        return n != null && n.isConnected();
    }

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF12121C);
        web = new WebView(this) {
            @Override protected void onWindowVisibilityChanged(int v) {
                // keep the call page alive while sharing the screen or on a call and using other apps
                if (v != View.VISIBLE && (inCall || ScreenShareService.running)) super.onWindowVisibilityChanged(View.VISIBLE);
                else super.onWindowVisibilityChanged(v);
            }
        };
        web.setBackgroundColor(0xFF12121C);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        SharedPreferences lp = getSharedPreferences("studieshub", MODE_PRIVATE);
        lockOn = lp.getBoolean("lock_on", false);
        lockMin = lp.getInt("lock_min", 0);
        OfflineStore.userId = getSharedPreferences("studieshub", MODE_PRIVATE).getString("off_uid", "0");
        startNetWatch();
        overlay = buildOverlay();
        root.addView(overlay, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        if (lockOn) { locked = true; secure(true); }
        else overlay.setVisibility(View.GONE);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        if (Build.VERSION.SDK_INT >= 26) s.setSafeBrowsingEnabled(true);
        s.setBuiltInZoomControls(false);
        s.setSupportZoom(false);
        s.setUserAgentString(s.getUserAgentString() + " StudiesHubApp/1.0 (" + (Build.MANUFACTURER.substring(0, 1).toUpperCase() + Build.MANUFACTURER.substring(1)).replaceAll("[();]", "") + " " + Build.MODEL.replaceAll("[();]", "") + ")");
        OfflineStore.ua = s.getUserAgentString();
        // One-time clean-out of pages remembered by older versions, so nothing outdated (like a download-the-app entry) can show up inside the app.
        try { android.content.SharedPreferences sp0 = getSharedPreferences("studieshub", MODE_PRIVATE); if (sp0.getInt("cache_clean", 0) < 2) { web.clearCache(true); sp0.edit().putInt("cache_clean", 2).apply(); } } catch (Throwable t) { }
        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setCookie("https://studieshub.org", "shapp=1; Max-Age=31536000; Path=/; Secure"); // tells the site every request (even the page loader's) comes from the app
        cm.setAcceptThirdPartyCookies(web, true);

        web.addJavascriptInterface(new Object() {
            @JavascriptInterface public void google(final boolean lecturer) { runOnUiThread(() -> startGoogle(lecturer)); }
            @JavascriptInterface public void notifications() { runOnUiThread(() -> startNotes()); }
            @JavascriptInterface public void upBegin(String id) {
                try { UploadService.cacheFile(MainActivity.this, id).delete(); } catch (Throwable t) { }
            }
            @JavascriptInterface public boolean upChunk(String id, String b64) {
                try (java.io.FileOutputStream o = new java.io.FileOutputStream(UploadService.cacheFile(MainActivity.this, id), true)) {
                    o.write(android.util.Base64.decode(b64, android.util.Base64.DEFAULT));
                    return true;
                } catch (Throwable t) { return false; }
            }
            @JavascriptInterface public boolean upStart(String id, String url, String fields, String afterUrl, String afterJson, String title, String name, String mime) {
                try {
                    if (url == null || !url.startsWith("/")) return false;
                    UploadService.Job j = new UploadService.Job();
                    j.id = id; j.url = url; j.fields = fields; j.afterUrl = afterUrl; j.afterJson = afterJson; j.title = title == null || title.isEmpty() ? name : title; j.name = name; j.mime = mime == null || mime.isEmpty() ? "application/octet-stream" : mime;
                    UploadService.enqueue(MainActivity.this, j);
                    return true;
                } catch (Throwable t) { return false; }
            }
            @JavascriptInterface public String upStatus(String id) {
                int[] st = UploadService.STATUS.get(id);
                if (st == null) {
                    // The app was closed since: a saved file means it is paused, nothing saved means it is gone.
                    boolean saved = UploadService.metaFile(MainActivity.this, id).exists() && UploadService.cacheFile(MainActivity.this, id).exists();
                    return saved ? "5|0|Paused" : "0|0";
                }
                String why = UploadService.ERR.get(id);
                return st[0] + "|" + st[1] + (why == null ? "" : "|" + why);
            }
            @JavascriptInterface public void upOpen(String id, String url) {
                UploadService.Job j = UploadService.ALL.get(id);
                if (j != null && url != null && url.startsWith("/")) { j.open = url; UploadService.save(MainActivity.this, j); }
            }
            @JavascriptInterface public void offWifi(boolean on) { getSharedPreferences("studieshub", MODE_PRIVATE).edit().putBoolean("off_wifi", on).apply(); }
            @JavascriptInterface public boolean offWifiOn() { return getSharedPreferences("studieshub", MODE_PRIVATE).getBoolean("off_wifi", false); }
            @JavascriptInterface public boolean upRetry(String id) { return UploadService.retry(MainActivity.this, id); }
            @JavascriptInterface public void upCancel(String id) {
                UploadService.Job j = UploadService.ALL.get(id);
                if (j != null) j.cancel = true;
            }
            @JavascriptInterface public void privatePage(final boolean p) {
                priv = p;
                runOnUiThread(() -> secure(lockOn && locked));
            }
            @JavascriptInterface public void offUser(String id) { OfflineStore.userId = id == null ? "0" : id; if (!OfflineStore.userId.equals("0")) getSharedPreferences("studieshub", MODE_PRIVATE).edit().putString("off_uid", OfflineStore.userId).apply(); }
            @JavascriptInterface public boolean dlStart(String slug, String title, String file) {
                try {
                    askNotif();
                    String cookie = android.webkit.CookieManager.getInstance().getCookie("https://studieshub.org");
                    String name = (file == null || file.trim().isEmpty() ? slug : file).replaceAll("[\\\\/:*?\"<>|]", "_");
                    java.io.File dl = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                    if (new java.io.File(dl, name).exists()) { int dot = name.lastIndexOf('.'); String stem = dot > 0 ? name.substring(0, dot) : name, ext = dot > 0 ? name.substring(dot) : ""; name = stem + " (" + (System.currentTimeMillis() % 10000) + ")" + ext; }
                    DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                    DownloadManager.Request r = new DownloadManager.Request(Uri.parse("https://studieshub.org/p/" + slug + "/raw?dl=1"));
                    r.setTitle(title == null || title.isEmpty() ? name : title).setDescription("Studies Hub");
                    if (cookie != null) r.addRequestHeader("Cookie", cookie);
                    r.addRequestHeader("User-Agent", web.getSettings().getUserAgentString());
                    r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
                    long id = dm.enqueue(r);
                    getSharedPreferences("studieshub", MODE_PRIVATE).edit().putLong("dl_" + OfflineStore.userId + "_" + slug, id).apply();
                    return true;
                } catch (Throwable t) { return false; }
            }
            /** none | pending | saving:NN | done | error:why  (for "Download to phone") */
            @JavascriptInterface public String dlStatus(String slug) {
                try {
                    long id = getSharedPreferences("studieshub", MODE_PRIVATE).getLong("dl_" + OfflineStore.userId + "_" + slug, -1);
                    if (id < 0) return "none";
                    DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                    android.database.Cursor c = dm.query(new DownloadManager.Query().setFilterById(id));
                    if (c == null) return "none";
                    try {
                        if (!c.moveToFirst()) return "none";
                        int st = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                        long got = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)), tot = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                        if (st == DownloadManager.STATUS_SUCCESSFUL) return "done";
                        if (st == DownloadManager.STATUS_FAILED) return "error:The download did not finish";
                        if (st == DownloadManager.STATUS_PENDING || st == DownloadManager.STATUS_PAUSED || tot <= 0) return "pending";
                        return "saving:" + Math.min(99, (int) (got * 100 / tot));
                    } finally { c.close(); }
                } catch (Throwable t) { return "none"; }
            }
            @JavascriptInterface public boolean offSave(String slug, String title, String kind, String course) {
                try { askNotif(); OfflineStore.ua = web.getSettings().getUserAgentString(); return OfflineStore.enqueue(MainActivity.this, slug, title, kind, course); } catch (Throwable t) { return false; }
            }
            @JavascriptInterface public void offAuto(boolean on) {
                getSharedPreferences("studieshub", MODE_PRIVATE).edit().putBoolean("off_auto", on).apply();
                if (on) topUp();
            }
            @JavascriptInterface public boolean offAutoOn() { return getSharedPreferences("studieshub", MODE_PRIVATE).getBoolean("off_auto", false); }
            @JavascriptInterface public String offStatus(String slug) {
                String st = OfflineStore.STATUS.get(slug);
                if (st != null && !st.equals("saved")) return st;
                return OfflineStore.has(MainActivity.this, slug) ? "saved" : "none";
            }
            @JavascriptInterface public void offRemove(String slug) { OfflineStore.remove(MainActivity.this, slug); }
            @JavascriptInterface public String offList() { return OfflineStore.list(MainActivity.this); }
            @JavascriptInterface public String netState() { return net; }
            @JavascriptInterface public boolean notifOn() {
                try {
                    if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false;
                    return ((android.app.NotificationManager) getSystemService(NOTIFICATION_SERVICE)).areNotificationsEnabled();
                } catch (Throwable t) { return false; }
            }
            @JavascriptInterface public void incomingCall(final String id, final String title, final String body) {
                try { CallService.showCall(MainActivity.this, id, title, body); } catch (Throwable t) { }
            }
            @JavascriptInterface public void incomingEnd(final String id) {
                try { ((android.app.NotificationManager) getSystemService(NOTIFICATION_SERVICE)).cancel(id.hashCode()); } catch (Throwable t) { }
            }
            @JavascriptInterface public String soundInfo() {
                try {
                    JSONObject o = new JSONObject();
                    for (String k : Sounds.CATS) o.put(k, Sounds.name(MainActivity.this, k));
                    return o.toString();
                } catch (Throwable t) { return "{}"; }
            }
            @JavascriptInterface public void pickSound(final String cat) { runOnUiThread(() -> pickSoundNow(cat)); }
            @JavascriptInterface public void playSound(final String cat) { runOnUiThread(() -> playSoundNow(cat)); }
            @JavascriptInterface public boolean presenceOn() { return presenceWanted(); }
            @JavascriptInterface public void presence(final boolean on) {
                runOnUiThread(() -> {
                    getSharedPreferences("studieshub", MODE_PRIVATE).edit().putBoolean("presence", on).apply();
                    if (on) startPresence(); else stopService(new Intent(MainActivity.this, PresenceService.class));
                });
            }
            @JavascriptInterface public void shareStart() {
                runOnUiThread(() -> {
                    try {
                        skipLock = true;
                        android.media.projection.MediaProjectionManager pm = (android.media.projection.MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
                        startActivityForResult(pm.createScreenCaptureIntent(), REQ_PROJ);
                    } catch (Throwable t) { shareState("cancelled"); }
                });
            }
            @JavascriptInterface public void shareStop() {
                runOnUiThread(() -> startService(new Intent(MainActivity.this, ScreenShareService.class).setAction("stop")));
            }
            @JavascriptInterface public String lockInfo() {
                android.app.KeyguardManager km = (android.app.KeyguardManager) getSystemService(KEYGUARD_SERVICE);
                android.content.pm.PackageManager pm = getPackageManager();
                boolean fp = pm.hasSystemFeature(android.content.pm.PackageManager.FEATURE_FINGERPRINT);
                boolean face = Build.VERSION.SDK_INT >= 29 && pm.hasSystemFeature("android.hardware.biometrics.face");
                boolean iris = Build.VERSION.SDK_INT >= 29 && pm.hasSystemFeature("android.hardware.biometrics.iris");
                return "{\"on\":" + lockOn + ",\"min\":" + lockMin + ",\"secure\":" + (km != null && km.isDeviceSecure()) + ",\"fp\":" + fp + ",\"face\":" + face + ",\"iris\":" + iris + "}";
            }
            @JavascriptInterface public void lockEnable(final int minutes) {
                runOnUiThread(() -> authenticate(() -> { setLock(true, minutes); lockDone("on", true); }, () -> lockDone("on", false)));
            }
            @JavascriptInterface public void lockDisable() {
                runOnUiThread(() -> authenticate(() -> { setLock(false, 0); lockDone("off", true); }, () -> lockDone("off", false)));
            }
        }, "StudiesApp");

        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                // Never send Google sign-in to Chrome: use the phone's own account picker instead.
                if ("accounts.google.com".equals(u.getHost()) || (ours(u) && u.getPath() != null && u.getPath().equals("/auth/google"))) {
                    startGoogle("lecturer".equals(u.getQueryParameter("as")));
                    return true;
                }
                if (ours(u)) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception e) { }
                return true;
            }
            @Override public android.webkit.WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                return OfflineStore.serve(MainActivity.this, r.getUrl(), r.getMethod(), r.getRequestHeaders(), r.isForMainFrame());
            }
            @Override public void onPageFinished(WebView v, String url) {
                CookieManager.getInstance().flush();
                if (!"online".equals(net)) v.evaluateJavascript("window.__net&&__net('" + net + "',1)", null);
                else if (url != null) { OfflineStore.remember(MainActivity.this, url); warmUp(); }
                // Opening the thing a notification was about clears that notification.
                try {
                    Uri cu = Uri.parse(url);
                    String key = cu.getPath() == null ? "/" : cu.getPath();
                    android.content.SharedPreferences np = getSharedPreferences("noteurls", MODE_PRIVATE);
                    for (String k : new String[]{key, key + (cu.getQuery() == null ? "" : "?" + cu.getQuery())}) {
                        if (np.contains(k)) {
                            int id = np.getInt(k, 0);
                            ((android.app.NotificationManager) getSystemService(NOTIFICATION_SERVICE)).cancel(id);
                            getSharedPreferences("chatnotes", MODE_PRIVATE).edit().remove("n" + id).apply();
                            np.edit().remove(k).apply();
                        }
                    }
                } catch (Throwable t) { }
                inCall = url != null && url.contains("studieshub.org/call/");
                String ck = CookieManager.getInstance().getCookie("https://studieshub.org");
                if (ck != null && ck.contains("sid=")) startPresence();
                if (answerCall != null && ours(Uri.parse(url))) {
                    String id = answerCall; answerCall = null;
                    v.evaluateJavascript("fetch('/api/calls/" + id + "/accept',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'}).then(function(r){return r.json()}).then(function(j){if(j&&j.url)location.href=j.url}).catch(function(){})", null);
                }
            }
            @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame()) {
                    if (!"GET".equalsIgnoreCase(r.getMethod())) {
                        // a form that needed the internet: stay where you were and say so
                        android.widget.Toast.makeText(MainActivity.this, OfflineStore.NOINET, android.widget.Toast.LENGTH_LONG).show();
                        v.post(() -> { if (v.canGoBack()) v.goBack(); });
                        return;
                    }
                    v.loadDataWithBaseURL(null,
                        "<html><head><title>Offline</title></head><body style='margin:0;background:#000;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center'>"
                        + "<div style='padding:24px'><h2>No internet connection</h2><p style='opacity:.7'>Check your internet connection and try again.</p>"
                        + "<button style='font-size:16px;padding:12px 28px;border:0;border-radius:10px;background:#6c63ff;color:#fff' onclick=\"location.href='" + HOME + "'\">Try again</button></div></body></html>",
                        "text/html", "utf-8", null);
                }
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                try {
                    skipLock = true;
                    startActivityForResult(p.createIntent(), REQ_FILE);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) {
                if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                    cb.invoke(origin, true, false);
                } else {
                    geoCb = cb; geoOrigin = origin;
                    requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_GEO);
                }
            }
            @Override public boolean onJsAlert(WebView v, String url, String message, final android.webkit.JsResult r) {
                new android.app.AlertDialog.Builder(MainActivity.this).setMessage(message)
                    .setPositiveButton("OK", (d, w) -> r.confirm()).setOnCancelListener(d -> r.cancel()).show();
                return true;
            }
            @Override public boolean onJsConfirm(WebView v, String url, String message, final android.webkit.JsResult r) {
                new android.app.AlertDialog.Builder(MainActivity.this).setMessage(message)
                    .setPositiveButton("OK", (d, w) -> r.confirm()).setNegativeButton("Cancel", (d, w) -> r.cancel())
                    .setOnCancelListener(d -> r.cancel()).show();
                return true;
            }
            @Override public void onPermissionRequest(final PermissionRequest req) {
                runOnUiThread(() -> askForWebPermission(req));
            }
        });

        web.setDownloadListener((url, ua, cd, mime, len) -> {
            try {
                DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
                r.setMimeType(mime);
                r.addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url));
                r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, URLUtil.guessFileName(url, cd, mime));
                ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(r);
            } catch (Exception e) {
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception x) { }
            }
        });

        // First time the app opens: ask the PHONE (not the website) for the permissions the app uses.
        SharedPreferences sp = getSharedPreferences("studieshub", MODE_PRIVATE);
        if (!sp.getBoolean("asked", false)) {
            sp.edit().putBoolean("asked", true).apply();
            List<String> want = new ArrayList<>();
            want.add(Manifest.permission.CAMERA);
            want.add(Manifest.permission.RECORD_AUDIO);
            want.add(Manifest.permission.ACCESS_FINE_LOCATION);
            want.add(Manifest.permission.ACCESS_COARSE_LOCATION);
            if (Build.VERSION.SDK_INT >= 33) want.add(Manifest.permission.POST_NOTIFICATIONS);
            requestPermissions(want.toArray(new String[0]), REQ_FIRST);
        }

        CallService.channels(this);
        ScreenShareService.ui = this;
        checkUpdate();
        com.google.firebase.messaging.FirebaseMessaging.getInstance().getToken()
            .addOnSuccessListener(t -> CallService.rememberToken(this, t));
        String saved = sp.getString("fcm", null);
        if (saved != null) CallService.rememberToken(this, saved);

        String start = HOME;
        Intent in = getIntent();
        if (in != null && in.getData() != null && ours(in.getData())) start = in.getData().toString();
        start = fromIntent(in, start);
        if (b != null && answerCall == null) web.restoreState(b); else web.loadUrl(start);
    }

    /** Opened from a ringing call or a notification: work out where to go. */
    private String fromIntent(Intent in, String dflt) {
        if (in == null) return dflt;
        String callId = in.getStringExtra("callId");
        if (callId != null) {
            ((android.app.NotificationManager) getSystemService(NOTIFICATION_SERVICE)).cancel(callId.hashCode());
            if (in.getBooleanExtra("answer", false)) answerCall = callId;
            return HOME + "chat";
        }
        String u = in.getStringExtra("url");
        if (u != null && u.startsWith("/")) return "https://studieshub.org" + u;
        return dflt;
    }

    @Override protected void onNewIntent(Intent in) {
        super.onNewIntent(in);
        setIntent(in);
        web.loadUrl(fromIntent(in, HOME));
    }

    void shareState(final String st) { web.post(() -> web.evaluateJavascript("window.__scrState&&__scrState('" + st + "')", null)); }

    /** One small picture of the shared screen, for the call page. Skips pictures while the page is still busy with the last one. */
    void sendFrame(final String dataUrl) {
        if (frameBusy) return;
        frameBusy = true;
        web.post(() -> web.evaluateJavascript("window.__scrFrame&&__scrFrame('" + dataUrl + "')", v -> frameBusy = false));
    }

    private void pickSoundNow(String cat) {
        try {
            boolean call = "calls".equals(cat);
            Intent i = new Intent(android.media.RingtoneManager.ACTION_RINGTONE_PICKER);
            i.putExtra(android.media.RingtoneManager.EXTRA_RINGTONE_TYPE, call ? android.media.RingtoneManager.TYPE_RINGTONE : android.media.RingtoneManager.TYPE_NOTIFICATION);
            i.putExtra(android.media.RingtoneManager.EXTRA_RINGTONE_SHOW_DEFAULT, true);
            i.putExtra(android.media.RingtoneManager.EXTRA_RINGTONE_SHOW_SILENT, true);
            i.putExtra(android.media.RingtoneManager.EXTRA_RINGTONE_DEFAULT_URI, Sounds.defaultFor(this, cat));
            i.putExtra(android.media.RingtoneManager.EXTRA_RINGTONE_EXISTING_URI, Sounds.current(this, cat));
            i.putExtra(android.media.RingtoneManager.EXTRA_RINGTONE_TITLE, call ? "Ringing tone for calls" : "Notification sound");
            soundCat = cat;
            skipLock = true;
            startActivityForResult(i, REQ_SND);
        } catch (Throwable t) { web.evaluateJavascript("alert('This phone cannot open the sound list.')", null); }
    }

    private void playSoundNow(String cat) {
        try {
            Uri u = Sounds.current(this, cat);
            if (u == null) { android.widget.Toast.makeText(this, "Silent", android.widget.Toast.LENGTH_SHORT).show(); return; }
            final android.media.Ringtone r = android.media.RingtoneManager.getRingtone(this, u);
            if (r == null) return;
            r.play();
            new Handler(Looper.getMainLooper()).postDelayed(() -> { try { r.stop(); } catch (Throwable t) { } }, 3500);
        } catch (Throwable t) { /* ignore */ }
    }

    // The always-on "You show as online to your friends" helper (and its notification) is gone. Being reachable is worked out from the pushes
    // that reach the phone and from the app being open, so there is nothing to switch on. This only switches off an old copy left by an earlier version.
    private boolean presenceWanted() { return false; }

    private void startPresence() {
        try { stopService(new Intent(this, PresenceService.class)); } catch (Throwable t) { /* ignore */ }
    }

    /** Asks once for permission to show notifications (Android 13 and newer), so progress and "complete" notices can appear. */
    private void askNotif() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            runOnUiThread(() -> requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 77));
    }

    private void noteResult(boolean ok) { web.evaluateJavascript("window.studiesNote&&studiesNote(" + ok + ")", null); }

    private void startNotes() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTE);
            return;
        }
        boolean on = ((android.app.NotificationManager) getSystemService(NOTIFICATION_SERVICE)).areNotificationsEnabled();
        noteResult(on);
        if (!on) {
            try { startActivity(new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, getPackageName())); } catch (Exception e) { }
        }
    }

    private void googleFail(String msg) {
        web.evaluateJavascript("window.studiesGoogleFail&&studiesGoogleFail(" + JSONObject.quote(msg == null ? "" : msg) + ")", null);
    }

    /** "Continue with Google": the phone's own account picker, no browser page. */
    private void startGoogle(final boolean lecturer) {
        int rid = getResources().getIdentifier("default_web_client_id", "string", getPackageName());
        if (rid == 0) { googleFail("Google sign-in is not set up in this app yet."); return; }
        GetGoogleIdOption opt = new GetGoogleIdOption.Builder()
            .setFilterByAuthorizedAccounts(false).setAutoSelectEnabled(false).setServerClientId(getString(rid)).build();
        skipLock = true;
        GetCredentialRequest req = new GetCredentialRequest.Builder().addCredentialOption(opt).build();
        final Handler h = new Handler(Looper.getMainLooper());
        CredentialManager.create(this).getCredentialAsync(this, req, new CancellationSignal(), r -> h.post(r),
            new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override public void onResult(GetCredentialResponse res) {
                    try {
                        Credential cr = res.getCredential();
                        if (cr instanceof CustomCredential && cr.getType().equals(GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL)) {
                            String t = GoogleIdTokenCredential.createFrom(((CustomCredential) cr).getData()).getIdToken();
                            web.evaluateJavascript("window.studiesGoogle&&studiesGoogle(" + JSONObject.quote(t) + "," + lecturer + ")", null);
                            return;
                        }
                    } catch (Exception e) { }
                    googleFail("Could not read the Google account.");
                }
                @Override public void onError(GetCredentialException e) { googleFail(null); }
            });
    }

    private boolean has(String p) { return checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED; }

    /** The parts of a website's request that the phone has already allowed (microphone, camera). */
    private String[] allowedParts(PermissionRequest req) {
        List<String> ok = new ArrayList<>();
        for (String r : req.getResources()) {
            if (r.equals(PermissionRequest.RESOURCE_AUDIO_CAPTURE) && has(Manifest.permission.RECORD_AUDIO)) ok.add(r);
            else if (r.equals(PermissionRequest.RESOURCE_VIDEO_CAPTURE) && has(Manifest.permission.CAMERA)) ok.add(r);
        }
        return ok.toArray(new String[0]);
    }

    private void answerWebPermission(PermissionRequest req) {
        String[] ok = allowedParts(req);
        try { if (ok.length > 0) req.grant(ok); else req.deny(); } catch (Throwable t) { /* request already answered */ }
    }

    private void askForWebPermission(PermissionRequest req) {
        List<String> missing = new ArrayList<>();
        for (String r : req.getResources()) {
            if (r.equals(PermissionRequest.RESOURCE_VIDEO_CAPTURE) && !has(Manifest.permission.CAMERA)) missing.add(Manifest.permission.CAMERA);
            if (r.equals(PermissionRequest.RESOURCE_AUDIO_CAPTURE) && !has(Manifest.permission.RECORD_AUDIO)) missing.add(Manifest.permission.RECORD_AUDIO);
        }
        if (missing.isEmpty()) { answerWebPermission(req); return; }
        if (pendingWebPerm != null) answerWebPermission(pendingWebPerm);
        pendingWebPerm = req;
        skipLock = true;
        requestPermissions(missing.toArray(new String[0]), REQ_PERM);
    }

    @Override public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        super.onRequestPermissionsResult(code, perms, res);
        if (code == REQ_NOTE) { noteResult(res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED); return; }
        if (code == REQ_FIRST) {
            // So the phone doesn't put the app to sleep and miss calls.
            try { startActivity(new Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName()))); } catch (Exception e) { }
            return;
        }
        if (code == REQ_GEO && geoCb != null) {
            boolean ok = false;
            for (int r : res) if (r == PackageManager.PERMISSION_GRANTED) ok = true;
            geoCb.invoke(geoOrigin, ok, false);
            geoCb = null;
            return;
        }
        if (code == REQ_PERM && pendingWebPerm != null) {
            answerWebPermission(pendingWebPerm);
            pendingWebPerm = null;
        }
    }

    @Override protected void onActivityResult(int code, int result, Intent data) {
        if (code == REQ_SND) {
            if (result == RESULT_OK && soundCat != null && data != null) {
                Uri picked = data.getParcelableExtra(android.media.RingtoneManager.EXTRA_RINGTONE_PICKED_URI);
                if (picked == null) Sounds.save(this, soundCat, "silent");
                else if (picked.equals(Sounds.defaultFor(this, soundCat))) Sounds.save(this, soundCat, "default");
                else Sounds.save(this, soundCat, picked.toString());
                web.evaluateJavascript("window.studiesSoundSet&&studiesSoundSet()", null);
            }
            soundCat = null;
            return;
        }
        if (code == REQ_PROJ) {
            if (result == RESULT_OK && data != null) {
                Intent svc = new Intent(this, ScreenShareService.class).putExtra("code", result).putExtra("data", data);
                try { if (Build.VERSION.SDK_INT >= 26) startForegroundService(svc); else startService(svc); }
                catch (Throwable t) { shareState("cancelled"); }
            } else shareState("cancelled");
            return;
        }
        if (code == REQ_LOCK) {
            Runnable r = result == RESULT_OK ? pendingOk : pendingFail;
            pendingOk = null; pendingFail = null;
            if (r != null) r.run();
            return;
        }
        if (code == REQ_FILE && fileCallback != null) {
            Uri[] r = null;
            if (result == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int n = data.getClipData().getItemCount();
                    r = new Uri[n];
                    for (int i = 0; i < n; i++) r[i] = data.getClipData().getItemAt(i).getUri();
                } else if (data.getData() != null) {
                    r = new Uri[]{data.getData()};
                }
            }
            fileCallback.onReceiveValue(r);
            fileCallback = null;
            return;
        }
        super.onActivityResult(code, result, data);
    }

    @Override protected void onDestroy() { if (ScreenShareService.ui == this) ScreenShareService.ui = null; super.onDestroy(); }

    @Override protected void onSaveInstanceState(Bundle b) { super.onSaveInstanceState(b); web.saveState(b); }
    @Override protected void onPause() { super.onPause(); fg = false; if (lockOn) secure(true); CookieManager.getInstance().flush(); if (!(inCall || ScreenShareService.running)) web.onPause(); }
    @Override protected void onResume() {
        super.onResume(); fg = true; if (getSharedPreferences("studieshub", MODE_PRIVATE).getBoolean("off_auto", false) && System.currentTimeMillis() - lastTopUp > 1800000L) topUp(); if (OfflineStore.queued(this) > 0) OfflineService.start(this); web.onResume(); skipLock = false; if (!locked) secure(false);
        if (System.currentTimeMillis() - lastUpdateCheck > 120000L) checkUpdate();
    }

    @Override protected void onStop() {
        super.onStop();
        if (lockOn && !skipLock) {
            leftAt = System.currentTimeMillis();
            if (lockMin == 0) { locked = true; overlay.setVisibility(View.VISIBLE); secure(true); }
        }
    }

    @Override protected void onStart() {
        super.onStart();
        if (lockOn && !skipLock && !locked && leftAt > 0 && System.currentTimeMillis() - leftAt >= lockMin * 60000L) {
            locked = true; overlay.setVisibility(View.VISIBLE); secure(true);
        }
        if (lockOn && locked && !authing) unlockNow();
    }

    /** Asks the site if a newer app is ready; if so, offers to download and install it right here. */
    private void checkUpdate() {
        lastUpdateCheck = System.currentTimeMillis();
        new Thread(() -> {
            try {
                java.net.HttpURLConnection h = (java.net.HttpURLConnection) new java.net.URL("https://studieshub.org/app/version").openConnection();
                h.setConnectTimeout(8000); h.setReadTimeout(8000);
                java.io.BufferedReader br = new java.io.BufferedReader(new java.io.InputStreamReader(h.getInputStream()));
                StringBuilder sb = new StringBuilder(); String ln;
                while ((ln = br.readLine()) != null) sb.append(ln);
                final int latest = new JSONObject(sb.toString()).getInt("versionCode");
                final int mine = getPackageManager().getPackageInfo(getPackageName(), 0).versionCode;
                if (latest > mine && latest != dismissedVersion && !updateAsked) {
                    updateAsked = true;
                    runOnUiThread(() -> askUpdate(latest));
                }
            } catch (Exception e) { }
        }).start();
    }

    private void askUpdate(final int latest) {
        new android.app.AlertDialog.Builder(this).setTitle("Update ready")
            .setMessage("A new version of Studies Hub is ready. Update now? It takes a few seconds.")
            .setPositiveButton("Update now", (d, w) -> { updateAsked = false; startUpdate(); })
            .setNegativeButton("Later", (d, w) -> { dismissedVersion = latest; updateAsked = false; })
            .setOnCancelListener(d -> { dismissedVersion = latest; updateAsked = false; }).show();
    }

    private void startUpdate() {
        if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
            new android.app.AlertDialog.Builder(this).setMessage("To update, allow Studies Hub to install updates. Turn on the switch on the next screen, then come back.")
                .setPositiveButton("OK", (d, w) -> {
                    skipLock = true;
                    try { startActivity(new Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName()))); } catch (Exception e) { }
                }).show();
            return;
        }
        try {
            final java.io.File dir = getExternalFilesDir("updates");
            final java.io.File f = new java.io.File(dir, "StudiesHub.apk");
            if (f.exists()) f.delete();
            DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            DownloadManager.Request r = new DownloadManager.Request(Uri.parse("https://studieshub.org/StudiesHub.apk"));
            r.setTitle("Studies Hub update");
            r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            r.setDestinationInExternalFilesDir(this, "updates", "StudiesHub.apk");
            final long id = dm.enqueue(r);
            android.widget.Toast.makeText(this, "Downloading the update...", android.widget.Toast.LENGTH_LONG).show();
            android.content.BroadcastReceiver rc = new android.content.BroadcastReceiver() {
                @Override public void onReceive(android.content.Context c2, Intent i) {
                    if (i.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1) != id) return;
                    try { unregisterReceiver(this); } catch (Exception e) { }
                    try {
                        // only install if the download really finished and is a newer build
                        DownloadManager.Query q = new DownloadManager.Query().setFilterById(id);
                        android.database.Cursor cu = dm.query(q);
                        boolean ok = false;
                        if (cu != null) { if (cu.moveToFirst()) ok = cu.getInt(cu.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)) == DownloadManager.STATUS_SUCCESSFUL; cu.close(); }
                        android.content.pm.PackageInfo pi = ok && f.length() > 1000000 ? getPackageManager().getPackageArchiveInfo(f.getAbsolutePath(), 0) : null;
                        if (pi == null || pi.versionCode <= getPackageManager().getPackageInfo(getPackageName(), 0).versionCode) {
                            f.delete();
                            android.widget.Toast.makeText(MainActivity.this, pi == null ? "The update did not download fully. Please try again." : "The update is not ready yet. Please try again in a minute.", android.widget.Toast.LENGTH_LONG).show();
                            return;
                        }
                        Uri u = androidx.core.content.FileProvider.getUriForFile(MainActivity.this, "org.studieshub.app.fileprovider", f);
                        Intent in = new Intent(Intent.ACTION_VIEW).setDataAndType(u, "application/vnd.android.package-archive")
                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                        skipLock = true;
                        startActivity(in);
                    } catch (Exception e) {
                        android.widget.Toast.makeText(MainActivity.this, "The update could not be opened. Try again later.", android.widget.Toast.LENGTH_LONG).show();
                    }
                }
            };
            android.content.IntentFilter flt = new android.content.IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
            if (Build.VERSION.SDK_INT >= 33) registerReceiver(rc, flt, RECEIVER_EXPORTED); else registerReceiver(rc, flt);
        } catch (Exception e) {
            android.widget.Toast.makeText(this, "The update could not start. Try again later.", android.widget.Toast.LENGTH_LONG).show();
        }
    }

    private View buildOverlay() {
        final float d = getResources().getDisplayMetrics().density;
        android.widget.FrameLayout root = new android.widget.FrameLayout(this);
        root.setClickable(true);
        root.setBackground(new android.graphics.drawable.GradientDrawable(android.graphics.drawable.GradientDrawable.Orientation.TOP_BOTTOM, new int[]{0xFF000000, 0xFF000000, 0xFF000000}));
        android.widget.LinearLayout l = new android.widget.LinearLayout(this);
        l.setOrientation(android.widget.LinearLayout.VERTICAL);
        l.setGravity(android.view.Gravity.CENTER_HORIZONTAL);
        l.setPadding((int) (32 * d), 0, (int) (32 * d), 0);
        android.widget.FrameLayout.LayoutParams lp = new android.widget.FrameLayout.LayoutParams(-1, -2, android.view.Gravity.CENTER);
        // logo inside a soft glowing ring
        android.widget.FrameLayout ring = new android.widget.FrameLayout(this);
        android.graphics.drawable.GradientDrawable rg = new android.graphics.drawable.GradientDrawable();
        rg.setShape(android.graphics.drawable.GradientDrawable.OVAL); rg.setColor(0xFF000000); rg.setStroke((int) (2 * d), 0xAA6D5EFC);
        ring.setBackground(rg);
        android.widget.ImageView logo = new android.widget.ImageView(this);
        logo.setImageResource(R.mipmap.ic_launcher);
        int ls = (int) (72 * d);
        ring.addView(logo, new android.widget.FrameLayout.LayoutParams(ls, ls, android.view.Gravity.CENTER));
        l.addView(ring, new android.widget.LinearLayout.LayoutParams((int) (128 * d), (int) (128 * d)));
        android.widget.TextView t = new android.widget.TextView(this);
        t.setText("Studies Hub is locked"); t.setTextColor(0xFFFFFFFF); t.setTextSize(24); t.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        t.setGravity(android.view.Gravity.CENTER); t.setPadding(0, (int) (28 * d), 0, (int) (8 * d));
        android.widget.TextView s = new android.widget.TextView(this);
        s.setText("Confirm it\u2019s you to carry on studying.\nYour account stays safe while the app is locked."); s.setTextColor(0xB3FFFFFF); s.setTextSize(15);
        s.setGravity(android.view.Gravity.CENTER); s.setLineSpacing(0, 1.25f); s.setPadding(0, 0, 0, (int) (36 * d));
        android.widget.TextView b = new android.widget.TextView(this);
        b.setText("\uD83D\uDD12  Unlock"); b.setTextColor(0xFFFFFFFF); b.setTextSize(17); b.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        b.setGravity(android.view.Gravity.CENTER);
        android.graphics.drawable.GradientDrawable bg = new android.graphics.drawable.GradientDrawable(android.graphics.drawable.GradientDrawable.Orientation.LEFT_RIGHT, new int[]{0xFF6D5EFC, 0xFF8B5CF6});
        bg.setCornerRadius(40 * d);
        b.setBackground(bg); b.setClickable(true); b.setOnClickListener(v -> unlockNow());
        l.addView(t); l.addView(s);
        l.addView(b, new android.widget.LinearLayout.LayoutParams(-1, (int) (56 * d)));
        root.addView(l, lp);
        android.widget.TextView f = new android.widget.TextView(this);
        f.setText("Protected by your phone\u2019s lock"); f.setTextColor(0x66FFFFFF); f.setTextSize(12); f.setGravity(android.view.Gravity.CENTER);
        android.widget.FrameLayout.LayoutParams fp = new android.widget.FrameLayout.LayoutParams(-1, -2, android.view.Gravity.BOTTOM);
        fp.bottomMargin = (int) (36 * d);
        root.addView(f, fp);
        return root;
    }

    private void unlockNow() {
        if (authing) return;
        authing = true;
        authenticate(() -> { authing = false; locked = false; overlay.setVisibility(View.GONE); secure(false); },
                     () -> { authing = false; });
    }


    // ---- network watching: online, offline, or "not steady" (which also switches to offline mode) ----
    private long lastWarm = 0;
    /** Once in a while, quietly keeps the main pages so they open with no internet even if they were not visited first. */
    private void warmUp() {
        if (System.currentTimeMillis() - lastWarm < 6 * 3600 * 1000L) return;
        lastWarm = System.currentTimeMillis();
        for (String p : new String[]{"/", "/dashboard", "/chat", "/news", "/settings", "/settings/profile", "/settings/active-status", "/settings/appearance", "/settings/notifications", "/settings/security", "/saved"})
            OfflineStore.remember(this, "https://studieshub.org" + p);
        OfflineStore.prune(this);
    }

    private volatile String net = "online";
    private volatile boolean fg = false;
    private int pingOk = 0, pingBad = 0;
    private final java.util.ArrayList<Long> flips = new java.util.ArrayList<>();

    private void setNet(final String n) {
        if (n.equals(net)) return;
        String old = net;
        net = n;
        OfflineStore.offline = !"online".equals(n);
        synchronized (flips) { flips.add(System.currentTimeMillis()); }
        runOnUiThread(() -> { try { web.evaluateJavascript("window.__net&&__net('" + n + "')", null); if ("online".equals(n)) web.evaluateJavascript("if(document.title==='Offline')location.reload()", null); } catch (Throwable t) { } });
    }

    private boolean hasNetwork() {
        try {
            android.net.ConnectivityManager cm = (android.net.ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            android.net.NetworkCapabilities nc = cm.getNetworkCapabilities(cm.getActiveNetwork());
            return nc != null && nc.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET);
        } catch (Throwable t) { return true; }
    }

    private long lastTopUp = 0;
    /** With "save all" on: find materials not on the phone yet and queue them. */
    private void topUp() {
        if (OfflineStore.userId.equals("0")) return;
        lastTopUp = System.currentTimeMillis();
        OfflineStore.ua = web.getSettings().getUserAgentString();
        final String ck = CookieManager.getInstance().getCookie("https://studieshub.org");
        new Thread(() -> {
            try {
                java.net.HttpURLConnection h = (java.net.HttpURLConnection) new java.net.URL("https://studieshub.org/api/saved/available").openConnection();
                h.setConnectTimeout(10000); h.setReadTimeout(20000);
                h.setRequestProperty("User-Agent", OfflineStore.ua);
                if (ck != null) h.setRequestProperty("Cookie", ck);
                if (h.getResponseCode() != 200) return;
                java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
                try (java.io.InputStream in = h.getInputStream()) { byte[] b = new byte[8192]; int r; while ((r = in.read(b)) > 0) bo.write(b, 0, r); }
                org.json.JSONArray a = new org.json.JSONObject(bo.toString("UTF-8")).getJSONArray("items");
                for (int i = 0; i < a.length(); i++) { org.json.JSONObject o = a.getJSONObject(i); OfflineStore.enqueue(MainActivity.this, o.getString("slug"), o.getString("title"), o.getString("kind"), o.optString("course")); }
            } catch (Exception e) { }
        }).start();
    }

    private void startNetWatch() {
        try {
            android.net.ConnectivityManager cm = (android.net.ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            cm.registerDefaultNetworkCallback(new android.net.ConnectivityManager.NetworkCallback() {
                @Override public void onLost(android.net.Network n) { pingOk = 0; pingBad = 3; setNet("offline"); }
            });
        } catch (Throwable t) { }
        new Thread(() -> {
            while (true) {
                try { Thread.sleep(fg ? 5000 : 20000); } catch (InterruptedException e) { return; }
                long t0 = System.currentTimeMillis();
                boolean ok = false;
                if (hasNetwork()) {
                    try {
                        java.net.HttpURLConnection h = (java.net.HttpURLConnection) new java.net.URL("https://studieshub.org/health").openConnection();
                        h.setConnectTimeout(4000); h.setReadTimeout(4000);
                        ok = h.getResponseCode() < 500;
                        h.disconnect();
                    } catch (Exception e) { ok = false; }
                }
                long ms = System.currentTimeMillis() - t0;
                if (ok && ms < 2500) { pingOk++; pingBad = 0; } else { pingBad++; pingOk = 0; }
                // many ups and downs in a minute count as unsteady even if each ping works
                long now = System.currentTimeMillis();
                boolean flappy;
                synchronized (flips) { for (int k = flips.size() - 1; k >= 0; k--) if (now - flips.get(k) > 60000) flips.remove(k); flappy = flips.size() >= 4; }
                if (pingBad >= 2 || (ok && ms >= 2500 && pingBad >= 1)) setNet(hasNetwork() ? "unstable" : "offline");
                else if (!hasNetwork()) setNet("offline");
                else if (pingOk >= 2 && !flappy) setNet("online");
            }
        }).start();
    }

    private void setLock(boolean on, int minutes) {
        lockOn = on; lockMin = minutes; locked = false; leftAt = 0;
        getSharedPreferences("studieshub", MODE_PRIVATE).edit().putBoolean("lock_on", on).putInt("lock_min", minutes).apply();
        secure(false);
        overlay.setVisibility(View.GONE);
    }

    /** Hide the screen from screenshots, recordings and the recent-apps picture, but only while the lock screen is up or the app is out of sight. Once you are in, everything shows normally. */
    private volatile boolean priv = false;
    private void secure(boolean on) {
        on = on || priv;
        if (on) getWindow().setFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE, android.view.WindowManager.LayoutParams.FLAG_SECURE);
        else getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE);
    }

    private void lockDone(String kind, boolean ok) {
        web.evaluateJavascript("window.studiesLockDone&&studiesLockDone('" + kind + "'," + ok + ")", null);
    }

    /** The phone's own lock: fingerprint / face, or the phone PIN, pattern or password. */
    private void authenticate(final Runnable ok, final Runnable fail) {
        android.app.KeyguardManager km = (android.app.KeyguardManager) getSystemService(KEYGUARD_SERVICE);
        if (km == null || !km.isDeviceSecure()) { fail.run(); web.evaluateJavascript("alert('Set a screen lock (PIN, pattern or fingerprint) in your phone settings first.')", null); return; }
        skipLock = true;
        boolean started = false;
        if (Build.VERSION.SDK_INT >= 30) {
            try {
                android.hardware.biometrics.BiometricPrompt bp = new android.hardware.biometrics.BiometricPrompt.Builder(this)
                    .setTitle("Studies Hub").setSubtitle("Confirm it is you")
                    .setAllowedAuthenticators(android.hardware.biometrics.BiometricManager.Authenticators.BIOMETRIC_WEAK | android.hardware.biometrics.BiometricManager.Authenticators.DEVICE_CREDENTIAL)
                    .build();
                bp.authenticate(new CancellationSignal(), getMainExecutor(), new android.hardware.biometrics.BiometricPrompt.AuthenticationCallback() {
                    @Override public void onAuthenticationSucceeded(android.hardware.biometrics.BiometricPrompt.AuthenticationResult r) { ok.run(); }
                    @Override public void onAuthenticationError(int code, CharSequence msg) { fail.run(); }
                });
                started = true;
            } catch (Throwable t) { started = false; }
        }
        if (!started) {
            try {
                Intent i = km.createConfirmDeviceCredentialIntent("Studies Hub", "Confirm it is you");
                if (i == null) { fail.run(); return; }
                pendingOk = ok; pendingFail = fail;
                startActivityForResult(i, REQ_LOCK);
            } catch (Throwable t) { fail.run(); }
        }
    }

    @Override public void onBackPressed() {
        if (locked) { moveTaskToBack(true); return; }
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }
}
