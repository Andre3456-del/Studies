package org.studieshub.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.webkit.CookieManager;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/** Gets wake-up messages from Google, even when the app is closed: rings for calls, shows normal notifications. */
public class CallService extends FirebaseMessagingService {
    static final String CH_CALLS = "calls_v1", CH_NOTES = "notes_v1";

    /** Saves the phone's ID where the website can see it (a cookie), so the site knows where to ring this person. */
    static void rememberToken(Context c, String token) {
        if (token == null || token.isEmpty()) return;
        c.getSharedPreferences("studieshub", MODE_PRIVATE).edit().putString("fcm", token).apply();
        CookieManager cm = CookieManager.getInstance();
        cm.setCookie("https://studieshub.org", "fcm=" + token + "; Path=/; Max-Age=31536000; Secure; SameSite=Lax");
        cm.flush();
    }

    @Override public void onNewToken(String token) { rememberToken(this, token); }

    static void channels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CH_CALLS) == null) {
            NotificationChannel ch = new NotificationChannel(CH_CALLS, "Incoming calls", NotificationManager.IMPORTANCE_HIGH);
            Uri ring = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            ch.setSound(ring, new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build());
            ch.enableVibration(true);
            ch.setVibrationPattern(new long[]{0, 800, 600, 800, 600, 800});
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(ch);
        }
        if (nm.getNotificationChannel(CH_NOTES) == null) {
            nm.createNotificationChannel(new NotificationChannel(CH_NOTES, "Notifications", NotificationManager.IMPORTANCE_DEFAULT));
        }
    }

    @Override public void onMessageReceived(RemoteMessage m) {
        Map<String, String> d = m.getData();
        String type = d.get("type");
        if (type == null) return;
        channels(this);
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (type.equals("end")) {
            if (d.get("id") != null) nm.cancel(d.get("id").hashCode());
            return;
        }
        String title = d.get("title") == null ? "Studies Hub" : d.get("title");
        String body = d.get("body") == null ? "" : d.get("body");
        // The push reached this phone, so its data is on: tell the server right away. That turns the sender's one tick into two ticks
        // (and makes a call say "Ringing…" instead of "Calling…"), even while the app is closed.
        if (type.equals("ring") && d.get("id") != null) ack("POST", "/api/calls/" + d.get("id") + "/ringing");
        else if (type.equals("note")) ack("GET", "/api/ping");
        if (type.equals("ring")) showCall(this, d.get("id"), title, body);
        else if (type.equals("note")) note(nm, title, body, d.get("url"), d.get("tag"), d.get("cat"), d.get("chat"), d.get("cid"), d.get("av"), d.get("missed") != null);
    }

    static void ack(final String method, final String path) {
        new Thread(() -> {
            // The phone has only just got its data back, so the first try can fail: try a few times, a little further apart each time.
            long[] wait = {0, 2500, 6000, 15000};
            for (long w : wait) {
                try {
                    if (w > 0) Thread.sleep(w);
                    String cookie = CookieManager.getInstance().getCookie("https://studieshub.org");
                    if (cookie == null || !cookie.contains("sid=")) return;
                    java.net.HttpURLConnection h = (java.net.HttpURLConnection) new java.net.URL("https://studieshub.org" + path).openConnection();
                    h.setRequestMethod(method);
                    h.setConnectTimeout(8000); h.setReadTimeout(8000);
                    h.setRequestProperty("Cookie", cookie);
                    if (method.equals("POST")) { h.setRequestProperty("Content-Type", "application/json"); h.setDoOutput(true); h.getOutputStream().write("{}".getBytes()); }
                    int code = h.getResponseCode();
                    h.disconnect();
                    if (code >= 200 && code < 300) return;
                } catch (Throwable t) { }
            }
        }).start();
    }

    static int flags() { return PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0); }

    /** A call notification with Answer / Decline. While the phone is in use it is a small banner at the top; only a sleeping or locked phone gets the full call screen. */
    /** The notification for a call the person is on or making: "Calling…", "Ringing…", then the running time, with a Hang up button. */
    static void showOngoing(Context c, String id, String name, String text, long since, boolean video) {
        if (id == null) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel("call_ongoing_v1") == null) {
            NotificationChannel ch = new NotificationChannel("call_ongoing_v1", "Calls in progress", NotificationManager.IMPORTANCE_LOW);
            ch.setSound(null, null); ch.enableVibration(false); ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        int nid = ("ongoing:" + id).hashCode();
        Intent open = new Intent(c, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT).putExtra("ongoing", true);
        Intent end = new Intent(c, CallActionReceiver.class).putExtra("callId", id).putExtra("hangup", true);
        PendingIntent tap = PendingIntent.getActivity(c, nid, open, flags());
        PendingIntent hang = PendingIntent.getBroadcast(c, nid + 1, end, flags());
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, "call_ongoing_v1") : new Notification.Builder(c);
        b.setSmallIcon(android.R.drawable.sym_call_outgoing).setContentTitle(name).setContentText(text)
         .setColor(0xFF000000).setCategory(Notification.CATEGORY_CALL).setOngoing(true).setAutoCancel(false).setOnlyAlertOnce(true)
         .setVisibility(Notification.VISIBILITY_PUBLIC).setContentIntent(tap);
        if (since > 0) b.setUsesChronometer(true).setWhen(since); else b.setWhen(System.currentTimeMillis());
        if (Build.VERSION.SDK_INT >= 31) {
            android.app.Person p = new android.app.Person.Builder().setName(name).setImportant(true).build();
            b.setStyle(Notification.CallStyle.forOngoingCall(p, hang));
        } else {
            b.addAction(new Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel, "Hang up", hang).build());
        }
        nm.notify(nid, b.build());
    }

    static void endOngoing(Context c, String id) {
        if (id == null) return;
        ((NotificationManager) c.getSystemService(NOTIFICATION_SERVICE)).cancel(("ongoing:" + id).hashCode());
    }

    static void showCall(Context c, String id, String title, String body) {
        if (id == null) return;
        channels(c);
        NotificationManager nm = (NotificationManager) c.getSystemService(NOTIFICATION_SERVICE);
        int nid = id.hashCode();
        Intent open = new Intent(c, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP).putExtra("callId", id).putExtra("answer", false);
        Intent yes = new Intent(c, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP).putExtra("callId", id).putExtra("answer", true);
        Intent no = new Intent(c, CallActionReceiver.class).putExtra("callId", id);
        PendingIntent tap = PendingIntent.getActivity(c, nid, open, flags());
        PendingIntent answer = PendingIntent.getActivity(c, nid + 1, yes, flags());
        PendingIntent decline = PendingIntent.getBroadcast(c, nid + 2, no, flags());
        android.os.PowerManager pm = (android.os.PowerManager) c.getSystemService(Context.POWER_SERVICE);
        android.app.KeyguardManager km = (android.app.KeyguardManager) c.getSystemService(Context.KEYGUARD_SERVICE);
        boolean inUse = pm != null && pm.isInteractive() && km != null && !km.isKeyguardLocked();
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, Sounds.channel(c, "calls")) : new Notification.Builder(c);
        b.setSmallIcon(android.R.drawable.sym_call_incoming).setContentTitle(title).setContentText(body)
         .setColor(0xFF000000).setLargeIcon(android.graphics.BitmapFactory.decodeResource(c.getResources(), R.mipmap.ic_launcher)).setCategory(Notification.CATEGORY_CALL).setOngoing(true).setAutoCancel(false).setOnlyAlertOnce(false)
         .setVisibility(Notification.VISIBILITY_PUBLIC)
         .setContentIntent(tap);
        // The banner stays up, with Answer and Decline, until the call is answered, declined or really over (the site tells us when it ends).
        b.setFullScreenIntent(tap, true); // phone in use: this shows as the banner. Screen off or locked: the call screen opens.
        if (Build.VERSION.SDK_INT >= 31) {
            android.app.Person caller = new android.app.Person.Builder().setName(title).setImportant(true).build();
            b.setStyle(Notification.CallStyle.forIncomingCall(caller, decline, answer));
        } else {
            b.addAction(new Notification.Action.Builder(android.R.drawable.sym_action_call, "Answer", answer).build())
             .addAction(new Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel, "Decline", decline).build());
        }
        if (Build.VERSION.SDK_INT >= 26) b.setTimeoutAfter(120000);
        else { b.setPriority(Notification.PRIORITY_MAX).setVibrate(new long[]{0, 800, 600, 800, 600, 800}); Uri ru = Sounds.current(c, "calls"); if (ru == null) ru = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE); b.setSound(ru, AudioManager_STREAM_RING()); }
        Notification n = b.build();
        n.flags |= Notification.FLAG_INSISTENT; // keep ringing until answered, declined or over
        nm.notify(nid, n);
    }

    private static int AudioManager_STREAM_RING() { return android.media.AudioManager.STREAM_RING; }

    private void note(NotificationManager nm, String title, String body, String url, String tag, String cat, String chat, String cid, String av, boolean missed) {
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP).putExtra("url", url == null ? "/" : url);
        int nid = (tag == null || tag.isEmpty() ? title + body : tag).hashCode();
        PendingIntent pi = PendingIntent.getActivity(this, nid, open, flags());
        String c = cat == null || cat.isEmpty() ? "general" : cat;
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, Sounds.channel(this, c)) : new Notification.Builder(this);
        if (Build.VERSION.SDK_INT < 26) { Uri nu = Sounds.current(this, c); if (nu != null) b.setSound(nu); }
        b.setSmallIcon(R.drawable.ic_stat).setColor(0xFF000000).setContentTitle(title).setContentText(body).setAutoCancel(true).setContentIntent(pi);
        boolean isChat = chat != null && cid != null && !cid.isEmpty();
        android.graphics.Bitmap pic = null;
        if (isChat && av != null) pic = fetchAvatar("https://studieshub.org" + av);
        if (pic == null) pic = isChat ? initials(title) : android.graphics.BitmapFactory.decodeResource(getResources(), R.mipmap.ic_launcher);
        b.setLargeIcon(round(pic));
        if (isChat) {
            // Like WhatsApp: the last few messages of this chat stack up in one conversation notification.
            boolean group = "group".equals(chat);
            String who = title, text = body;
            if (group) { int k = body.indexOf(": "); if (k > 0 && k < 40) { who = body.substring(0, k); text = body.substring(k + 2); } }
            final boolean p28 = Build.VERSION.SDK_INT >= 28;
            Notification.MessagingStyle ms = p28 ? new Notification.MessagingStyle(new android.app.Person.Builder().setName("You").build()) : new Notification.MessagingStyle("You");
            if (group) { ms.setConversationTitle(title); if (p28) ms.setGroupConversation(true); }
            android.graphics.drawable.Icon pic28 = p28 ? android.graphics.drawable.Icon.createWithBitmap(round(pic)) : null;
            try {
                SharedPreferences sp = getSharedPreferences("chatnotes", MODE_PRIVATE);
                org.json.JSONArray old = new org.json.JSONArray(sp.getString("n" + nid, "[]")), keep = new org.json.JSONArray();
                long now = System.currentTimeMillis();
                for (int k = Math.max(0, old.length() - 5); k < old.length(); k++) { org.json.JSONObject o = old.getJSONObject(k); if (now - o.getLong("t") < 3600000L) keep.put(o); }
                keep.put(new org.json.JSONObject().put("w", who).put("x", text).put("t", now));
                sp.edit().putString("n" + nid, keep.toString()).apply();
                for (int k = 0; k < keep.length(); k++) {
                    org.json.JSONObject o = keep.getJSONObject(k);
                    if (p28) ms.addMessage(new Notification.MessagingStyle.Message(o.getString("x"), o.getLong("t"), new android.app.Person.Builder().setName(o.getString("w")).setIcon(pic28).build()));
                    else ms.addMessage(o.getString("x"), o.getLong("t"), o.getString("w"));
                }
            } catch (Throwable t) { ms.addMessage(text, System.currentTimeMillis(), who); }
            b.setStyle(ms).setGroup("sh_chats").setCategory(Notification.CATEGORY_MESSAGE);
            try {
                String sid = "chat_" + chat + "_" + cid;
                if (Build.VERSION.SDK_INT >= 30) {
                    android.content.pm.ShortcutManager sm = getSystemService(android.content.pm.ShortcutManager.class);
                    android.content.pm.ShortcutInfo si = new android.content.pm.ShortcutInfo.Builder(this, sid).setShortLabel(title).setLongLived(true)
                        .setIntent(new Intent(this, MainActivity.class).setAction(Intent.ACTION_VIEW).putExtra("url", url == null ? "/" : url))
                        .setPerson(new android.app.Person.Builder().setName(title).setIcon(pic28).setImportant(true).build()).setIcon(pic28).build();
                    sm.pushDynamicShortcut(si);
                    b.setShortcutId(sid);
                }
            } catch (Throwable t) { }
        } else b.setStyle(new Notification.BigTextStyle().bigText(body));
        // Only a chat message can be answered, marked as read or muted from here. News, uploads and the rest just open.
        if (isChat && !missed) {
            int base = Math.abs(nid % 100000) * 4;
            android.app.RemoteInput ri = new android.app.RemoteInput.Builder("reply_text").setLabel("Reply").build();
            Notification.Action reply = new Notification.Action.Builder(R.drawable.ic_stat, "Reply",
                PendingIntent.getBroadcast(this, base + 1, chatIntent("reply", chat, cid, nid), PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0)))
                .addRemoteInput(ri).build();
            Notification.Action read = new Notification.Action.Builder(R.drawable.ic_stat, "Mark as read",
                PendingIntent.getBroadcast(this, base + 2, chatIntent("read", chat, cid, nid), flags())).build();
            Notification.Action mute = new Notification.Action.Builder(R.drawable.ic_stat, "Mute",
                PendingIntent.getBroadcast(this, base + 3, chatIntent("mute", chat, cid, nid), flags())).build();
            b.addAction(reply).addAction(read).addAction(mute);
        }
        nm.notify(nid, b.build());
        getSharedPreferences("noteurls", MODE_PRIVATE).edit().putInt(url == null ? "/" : url, nid).apply();
        if (isChat) {
            // One "Studies Hub" header that holds all the chats; news, uploads and the rest stay outside it.
            Notification.Builder sb = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, Sounds.channel(this, "messages")) : new Notification.Builder(this);
            sb.setSmallIcon(R.drawable.ic_stat).setColor(0xFF000000).setContentTitle("Studies Hub").setContentText("New messages").setGroup("sh_chats").setGroupSummary(true).setAutoCancel(true).setContentIntent(PendingIntent.getActivity(this, 7, new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP).putExtra("url", "/chat"), flags()));
            if (Build.VERSION.SDK_INT >= 26) sb.setGroupAlertBehavior(Notification.GROUP_ALERT_CHILDREN);
            nm.notify(7, sb.build());
        }
    }

    private android.graphics.Bitmap initials(String name) {
        int sz = 128;
        android.graphics.Bitmap bm = android.graphics.Bitmap.createBitmap(sz, sz, android.graphics.Bitmap.Config.ARGB_8888);
        android.graphics.Canvas cv = new android.graphics.Canvas(bm);
        int[] cols = {0xFF6D5EFC, 0xFF0EA5E9, 0xFF10B981, 0xFFF59E0B, 0xFFEF4444, 0xFFEC4899, 0xFF8B5CF6};
        android.graphics.Paint p = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);
        p.setColor(cols[Math.abs(name.hashCode()) % cols.length]);
        cv.drawRect(0, 0, sz, sz, p);
        p.setColor(0xFFFFFFFF); p.setTextSize(64); p.setTextAlign(android.graphics.Paint.Align.CENTER); p.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        String t = name == null || name.trim().isEmpty() ? "?" : name.trim().substring(0, name.trim().offsetByCodePoints(0, 1)).toUpperCase();
        cv.drawText(t, sz / 2f, sz / 2f + 22, p);
        return bm;
    }

    private android.graphics.Bitmap fetchAvatar(String u) {
        try {
            java.net.HttpURLConnection h = (java.net.HttpURLConnection) new java.net.URL(u).openConnection();
            h.setConnectTimeout(4000); h.setReadTimeout(4000);
            if (h.getResponseCode() != 200) return null;
            android.graphics.Bitmap bm = android.graphics.BitmapFactory.decodeStream(h.getInputStream());
            h.disconnect();
            return bm;
        } catch (Throwable t) { return null; }
    }

    private static android.graphics.Bitmap round(android.graphics.Bitmap src) {
        int sz = 128;
        android.graphics.Bitmap out = android.graphics.Bitmap.createBitmap(sz, sz, android.graphics.Bitmap.Config.ARGB_8888);
        android.graphics.Canvas cv = new android.graphics.Canvas(out);
        android.graphics.Paint p = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);
        cv.drawCircle(sz / 2f, sz / 2f, sz / 2f, p);
        p.setXfermode(new android.graphics.PorterDuffXfermode(android.graphics.PorterDuff.Mode.SRC_IN));
        int m = Math.min(src.getWidth(), src.getHeight());
        android.graphics.Rect from = new android.graphics.Rect((src.getWidth() - m) / 2, (src.getHeight() - m) / 2, (src.getWidth() + m) / 2, (src.getHeight() + m) / 2);
        cv.drawBitmap(src, from, new android.graphics.Rect(0, 0, sz, sz), p);
        return out;
    }

    private Intent chatIntent(String act, String chat, String cid, int nid) {
        return new Intent(this, ChatActionReceiver.class).setAction("chat." + act + "." + nid).putExtra("act", act).putExtra("chat", chat).putExtra("cid", cid).putExtra("nid", nid);
    }
}
