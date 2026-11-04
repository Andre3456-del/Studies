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
    private static final int REQ_LOCK = 16;
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
        web = new WebView(this);
        web.setBackgroundColor(0xFF12121C);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        SharedPreferences lp = getSharedPreferences("studieshub", MODE_PRIVATE);
        lockOn = lp.getBoolean("lock_on", false);
        lockMin = lp.getInt("lock_min", 0);
        overlay = buildOverlay();
        root.addView(overlay, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        if (lockOn) { locked = true; getWindow().setFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE, android.view.WindowManager.LayoutParams.FLAG_SECURE); }
        else overlay.setVisibility(View.GONE);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setBuiltInZoomControls(false);
        s.setSupportZoom(false);
        s.setUserAgentString(s.getUserAgentString() + " StudiesHubApp/1.0");
        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(web, true);

        web.addJavascriptInterface(new Object() {
            @JavascriptInterface public void google(final boolean lecturer) { runOnUiThread(() -> startGoogle(lecturer)); }
            @JavascriptInterface public void notifications() { runOnUiThread(() -> startNotes()); }
            @JavascriptInterface public String lockInfo() {
                android.app.KeyguardManager km = (android.app.KeyguardManager) getSystemService(KEYGUARD_SERVICE);
                return "{\"on\":" + lockOn + ",\"min\":" + lockMin + ",\"secure\":" + (km != null && km.isDeviceSecure()) + "}";
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
            @Override public void onPageFinished(WebView v, String url) {
                CookieManager.getInstance().flush();
                if (answerCall != null && ours(Uri.parse(url))) {
                    String id = answerCall; answerCall = null;
                    v.evaluateJavascript("fetch('/api/calls/" + id + "/accept',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'}).then(function(r){return r.json()}).then(function(j){if(j&&j.url)location.href=j.url}).catch(function(){})", null);
                }
            }
            @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame()) {
                    v.loadDataWithBaseURL(null,
                        "<html><body style='margin:0;background:#12121c;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center'>"
                        + "<div style='padding:24px'><h2>No connection</h2><p style='opacity:.7'>Check your internet, then try again.</p>"
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

    private void askForWebPermission(PermissionRequest req) {
        List<String> need = new ArrayList<>();
        for (String r : req.getResources()) {
            if (r.equals(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) need.add(Manifest.permission.CAMERA);
            if (r.equals(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) need.add(Manifest.permission.RECORD_AUDIO);
        }
        List<String> missing = new ArrayList<>();
        for (String p : need) if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) missing.add(p);
        if (missing.isEmpty()) { req.grant(req.getResources()); return; }
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
            boolean ok = res.length > 0;
            for (int r : res) if (r != PackageManager.PERMISSION_GRANTED) ok = false;
            if (ok) pendingWebPerm.grant(pendingWebPerm.getResources()); else pendingWebPerm.deny();
            pendingWebPerm = null;
        }
    }

    @Override protected void onActivityResult(int code, int result, Intent data) {
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

    @Override protected void onSaveInstanceState(Bundle b) { super.onSaveInstanceState(b); web.saveState(b); }
    @Override protected void onPause() { super.onPause(); CookieManager.getInstance().flush(); web.onPause(); }
    @Override protected void onResume() { super.onResume(); web.onResume(); skipLock = false; }

    @Override protected void onStop() {
        super.onStop();
        if (lockOn && !skipLock) {
            leftAt = System.currentTimeMillis();
            if (lockMin == 0) { locked = true; overlay.setVisibility(View.VISIBLE); }
        }
    }

    @Override protected void onStart() {
        super.onStart();
        if (lockOn && !skipLock && !locked && leftAt > 0 && System.currentTimeMillis() - leftAt >= lockMin * 60000L) {
            locked = true; overlay.setVisibility(View.VISIBLE);
        }
        if (lockOn && locked && !authing) unlockNow();
    }

    private View buildOverlay() {
        android.widget.LinearLayout l = new android.widget.LinearLayout(this);
        l.setOrientation(android.widget.LinearLayout.VERTICAL);
        l.setGravity(android.view.Gravity.CENTER);
        l.setBackgroundColor(0xFF12121C);
        l.setClickable(true);
        android.widget.TextView t = new android.widget.TextView(this);
        t.setText("Studies Hub"); t.setTextColor(0xFFFFFFFF); t.setTextSize(26);
        android.widget.TextView s = new android.widget.TextView(this);
        s.setText("The app is locked"); s.setTextColor(0xB3FFFFFF); s.setTextSize(15); s.setPadding(0, 12, 0, 36);
        android.widget.Button b = new android.widget.Button(this);
        b.setText("Unlock"); b.setOnClickListener(v -> unlockNow());
        l.addView(t); l.addView(s); l.addView(b);
        return l;
    }

    private void unlockNow() {
        if (authing) return;
        authing = true;
        authenticate(() -> { authing = false; locked = false; overlay.setVisibility(View.GONE); },
                     () -> { authing = false; });
    }

    private void setLock(boolean on, int minutes) {
        lockOn = on; lockMin = minutes; locked = false; leftAt = 0;
        getSharedPreferences("studieshub", MODE_PRIVATE).edit().putBoolean("lock_on", on).putInt("lock_min", minutes).apply();
        if (on) getWindow().setFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE, android.view.WindowManager.LayoutParams.FLAG_SECURE);
        else getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE);
        overlay.setVisibility(View.GONE);
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
