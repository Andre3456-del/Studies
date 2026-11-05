package org.studieshub.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.media.AudioAttributes;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.app.Notification;

/** Which sound plays for which kind of notification. Calls use the phone's ringtone unless the person picks another. */
final class Sounds {
    static final String[] CATS = {"messages", "news", "uploads", "general", "calls"};

    static Uri chime(Context c) { return Uri.parse("android.resource://" + c.getPackageName() + "/" + R.raw.chime); }

    static Uri defaultFor(Context c, String cat) {
        return "calls".equals(cat) ? RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE) : chime(c);
    }

    static String pref(Context c, String cat) { return c.getSharedPreferences("studieshub", Context.MODE_PRIVATE).getString("snd_" + cat, "default"); }

    static void save(Context c, String cat, String v) { c.getSharedPreferences("studieshub", Context.MODE_PRIVATE).edit().putString("snd_" + cat, v).apply(); }

    /** null means silent. */
    static Uri current(Context c, String cat) {
        String v = pref(c, cat);
        if ("default".equals(v)) return defaultFor(c, cat);
        if ("silent".equals(v)) return null;
        try { return Uri.parse(v); } catch (Throwable t) { return defaultFor(c, cat); }
    }

    static String name(Context c, String cat) {
        String v = pref(c, cat);
        if ("default".equals(v)) return "calls".equals(cat) ? "Phone's ringtone" : "Studies Hub chime";
        if ("silent".equals(v)) return "Silent";
        try {
            Ringtone r = RingtoneManager.getRingtone(c, Uri.parse(v));
            String t = r == null ? null : r.getTitle(c);
            return t == null || t.isEmpty() ? "Custom sound" : t;
        } catch (Throwable t) { return "Custom sound"; }
    }

    /** The notification channel that carries the sound this person chose for this kind (Android keeps the sound on the channel). */
    static String channel(Context c, String cat) {
        if (!java.util.Arrays.asList(CATS).contains(cat)) cat = "general";
        Uri u = current(c, cat);
        String id = "snd_" + cat + "_" + (u == null ? "silent" : Integer.toHexString(u.toString().hashCode()));
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = c.getSystemService(NotificationManager.class);
            if (nm.getNotificationChannel(id) == null) {
                boolean call = "calls".equals(cat);
                NotificationChannel ch = new NotificationChannel(id, call ? "Incoming calls" : "Notifications: " + cat,
                    call || "messages".equals(cat) ? NotificationManager.IMPORTANCE_HIGH : NotificationManager.IMPORTANCE_DEFAULT);
                if (u == null) ch.setSound(null, null);
                else ch.setSound(u, new AudioAttributes.Builder()
                    .setUsage(call ? AudioAttributes.USAGE_NOTIFICATION_RINGTONE : AudioAttributes.USAGE_NOTIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
                if (call) {
                    ch.enableVibration(true);
                    ch.setVibrationPattern(new long[]{0, 800, 600, 800, 600, 800});
                    ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                    ch.setBypassDnd(true);
                }
                nm.createNotificationChannel(ch);
            }
            for (NotificationChannel x : nm.getNotificationChannels())
                if (x.getId().startsWith("snd_" + cat + "_") && !x.getId().equals(id)) nm.deleteNotificationChannel(x.getId());
        }
        return id;
    }
}
