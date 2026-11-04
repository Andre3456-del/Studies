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
        if (type.equals("ring")) ring(nm, d.get("id"), title, body);
        else if (type.equals("note")) note(nm, title, body, d.get("url"), d.get("tag"));
    }

    private static int flags() { return PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0); }

    private void ring(NotificationManager nm, String id, String title, String body) {
        if (id == null) return;
        int nid = id.hashCode();
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP).putExtra("callId", id).putExtra("answer", false);
        Intent yes = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP).putExtra("callId", id).putExtra("answer", true);
        Intent no = new Intent(this, CallActionReceiver.class).putExtra("callId", id);
        PendingIntent full = PendingIntent.getActivity(this, nid, open, flags());
        PendingIntent answer = PendingIntent.getActivity(this, nid + 1, yes, flags());
        PendingIntent decline = PendingIntent.getBroadcast(this, nid + 2, no, flags());
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CH_CALLS) : new Notification.Builder(this);
        b.setSmallIcon(android.R.drawable.sym_call_incoming).setContentTitle(title).setContentText(body)
         .setCategory(Notification.CATEGORY_CALL).setOngoing(true).setAutoCancel(true)
         .setContentIntent(full).setFullScreenIntent(full, true)
         .addAction(new Notification.Action.Builder(android.R.drawable.sym_action_call, "Answer", answer).build())
         .addAction(new Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel, "Decline", decline).build());
        if (Build.VERSION.SDK_INT >= 26) b.setTimeoutAfter(45000);
        else {
            b.setPriority(Notification.PRIORITY_MAX).setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE), AudioManager_STREAM_RING()).setVibrate(new long[]{0, 800, 600, 800, 600, 800});
        }
        Notification n = b.build();
        n.flags |= Notification.FLAG_INSISTENT; // keep ringing until answered, declined or timed out
        nm.notify(nid, n);
    }

    private static int AudioManager_STREAM_RING() { return android.media.AudioManager.STREAM_RING; }

    private void note(NotificationManager nm, String title, String body, String url, String tag) {
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP).putExtra("url", url == null ? "/" : url);
        int nid = (tag == null || tag.isEmpty() ? title + body : tag).hashCode();
        PendingIntent pi = PendingIntent.getActivity(this, nid, open, flags());
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CH_NOTES) : new Notification.Builder(this);
        b.setSmallIcon(android.R.drawable.stat_notify_chat).setContentTitle(title).setContentText(body).setAutoCancel(true).setContentIntent(pi);
        nm.notify(nid, b.build());
    }
}
