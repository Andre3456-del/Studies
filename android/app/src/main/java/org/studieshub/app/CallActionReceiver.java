package org.studieshub.app;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.webkit.CookieManager;

import java.net.HttpURLConnection;
import java.net.URL;

/** The Decline button on the ringing notification. */
public class CallActionReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent i) {
        final String id = i.getStringExtra("callId");
        if (id == null) return;
        if (i.getBooleanExtra("hangup", false)) { // Hang up on a call in progress: the open call page ends it; without a page, tell the site directly
            CallService.endOngoing(c, id);
            MainActivity m = MainActivity.live == null ? null : MainActivity.live.get();
            if (m != null && m.hangUpFromNotification()) return;
            CallService.ack("POST", "/api/calls/" + id + "/leave");
            return;
        }
        ((NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(id.hashCode());
        final String cookie = CookieManager.getInstance().getCookie("https://studieshub.org");
        final PendingResult pr = goAsync();
        new Thread(() -> {
            try {
                HttpURLConnection h = (HttpURLConnection) new URL("https://studieshub.org/api/calls/" + id + "/decline").openConnection();
                h.setRequestMethod("POST");
                h.setConnectTimeout(8000); h.setReadTimeout(8000);
                if (cookie != null) h.setRequestProperty("Cookie", cookie);
                h.setRequestProperty("Content-Type", "application/json");
                h.setDoOutput(true);
                h.getOutputStream().write("{}".getBytes());
                h.getResponseCode();
                h.disconnect();
            } catch (Exception e) { /* the call simply times out */ }
            pr.finish();
        }).start();
    }
}
