package org.studieshub.app;

import android.app.NotificationManager;
import android.app.RemoteInput;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.webkit.CookieManager;

import java.net.HttpURLConnection;
import java.net.URL;

/** Reply / Mark as read / Mute buttons on a chat notification. Works with the app closed. */
public class ChatActionReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent i) {
        final String act = i.getStringExtra("act"), chat = i.getStringExtra("chat"), cid = i.getStringExtra("cid");
        final int nid = i.getIntExtra("nid", 0);
        if (act == null || chat == null || cid == null) return;
        String reply = null;
        if ("reply".equals(act)) {
            Bundle r = RemoteInput.getResultsFromIntent(i);
            CharSequence cs = r == null ? null : r.getCharSequence("reply_text");
            if (cs == null || cs.toString().trim().isEmpty()) return;
            reply = cs.toString().trim();
        }
        final String text = reply;
        final NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        final String cookie = CookieManager.getInstance().getCookie("https://studieshub.org");
        final PendingResult pr = goAsync();
        new Thread(() -> {
            boolean ok = false;
            try {
                String path, json;
                boolean group = "group".equals(chat);
                String idJson = group ? "\"group\":" + Long.parseLong(cid) : "\"to\":" + Long.parseLong(cid);
                if ("reply".equals(act)) { path = "/api/messages/send"; json = "{\"body\":" + org.json.JSONObject.quote(text) + "," + idJson + "}"; }
                else { path = "/api/chats/prefs"; json = "{\"action\":\"" + ("mute".equals(act) ? "mute" : "mark_read") + "\",\"items\":[{\"kind\":\"" + (group ? "group" : "dm") + "\",\"id\":" + Long.parseLong(cid) + "}]}"; }
                HttpURLConnection h = (HttpURLConnection) new URL("https://studieshub.org" + path).openConnection();
                h.setRequestMethod("POST");
                h.setConnectTimeout(10000); h.setReadTimeout(10000);
                if (cookie != null) h.setRequestProperty("Cookie", cookie);
                h.setRequestProperty("Content-Type", "application/json");
                h.setDoOutput(true);
                h.getOutputStream().write(json.getBytes("UTF-8"));
                ok = h.getResponseCode() == 200;
                h.disconnect();
            } catch (Exception e) { /* fall through */ }
            if (ok) nm.cancel(nid);
            else if ("reply".equals(act)) {
                // keep the notification and tell the person it did not go
                nm.cancel(nid);
                android.os.Handler hd = new android.os.Handler(android.os.Looper.getMainLooper());
                hd.post(() -> android.widget.Toast.makeText(c.getApplicationContext(), "Could not send your reply. Open the app to try again.", android.widget.Toast.LENGTH_LONG).show());
            }
            pr.finish();
        }).start();
    }
}
