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
            ch.setBypassDnd(true);
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
        if (type.equals("ring")) showCall(this, d.get("id"), title, body);
        else if (type.equals("note")) note(nm, title, body, d.get("url"), d.get("tag"), d.get("cat"), d.get("chat"), d.get("cid"));
    }

    static int flags() { return PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0); }

    /** A call notification with Answer / Decline. While the phone is in use it is a small banner at the top; only a sleeping or locked phone gets the full call screen. */
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
         .setColor(0xFF6D5EFC).setLargeIcon(android.graphics.BitmapFactory.decodeResource(c.getResources(), R.mipmap.ic_launcher)).setCategory(Notification.CATEGORY_CALL).setOngoing(true).setAutoCancel(true).setOnlyAlertOnce(true)
         .setContentIntent(tap)
         .addAction(new Notification.Action.Builder(android.R.drawable.sym_action_call, "Answer", answer).build())
         .addAction(new Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel, "Decline", decline).build());
        if (!inUse) b.setFullScreenIntent(tap, true); // screen off or locked: show the call screen
        if (Build.VERSION.SDK_INT >= 26) b.setTimeoutAfter(45000);
        else { b.setPriority(Notification.PRIORITY_MAX).setVibrate(new long[]{0, 800, 600, 800, 600, 800}); Uri ru = Sounds.current(c, "calls"); if (ru != null) b.setSound(ru, AudioManager_STREAM_RING()); }
        Notification n = b.build();
        n.flags |= Notification.FLAG_INSISTENT; // keep ringing until answered, declined or timed out
        nm.notify(nid, n);
    }

    private static int AudioManager_STREAM_RING() { return android.media.AudioManager.STREAM_RING; }

    private void note(NotificationManager nm, String title, String body, String url, String tag, String cat, String chat, String cid) {
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP).putExtra("url", url == null ? "/" : url);
        int nid = (tag == null || tag.isEmpty() ? title + body : tag).hashCode();
        PendingIntent pi = PendingIntent.getActivity(this, nid, open, flags());
        String c = cat == null || cat.isEmpty() ? "general" : cat;
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, Sounds.channel(this, c)) : new Notification.Builder(this);
        if (Build.VERSION.SDK_INT < 26) { Uri nu = Sounds.current(this, c); if (nu != null) b.setSound(nu); }
        b.setSmallIcon(R.drawable.ic_stat).setColor(0xFF6D5EFC).setLargeIcon(android.graphics.BitmapFactory.decodeResource(getResources(), R.mipmap.ic_launcher))
         .setContentTitle(title).setContentText(body).setStyle(new Notification.BigTextStyle().bigText(body)).setAutoCancel(true).setContentIntent(pi);
        // Only a chat message can be answered, marked as read or muted from here. News, uploads and the rest just open.
        if (chat != null && cid != null && !cid.isEmpty()) {
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
    }

    private Intent chatIntent(String act, String chat, String cid, int nid) {
        return new Intent(this, ChatActionReceiver.class).setAction("chat." + act + "." + nid).putExtra("act", act).putExtra("chat", chat).putExtra("cid", cid).putExtra("nid", nid);
    }
}
