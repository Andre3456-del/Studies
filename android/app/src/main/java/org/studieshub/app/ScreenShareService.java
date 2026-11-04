package org.studieshub.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.SystemClock;
import android.util.Base64;
import android.util.DisplayMetrics;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;

/** Captures the phone screen (after the person agrees) and hands small pictures of it to the call page. */
public class ScreenShareService extends Service {
    static volatile MainActivity ui;
    static volatile boolean running;

    private MediaProjection mp;
    private VirtualDisplay vd;
    private ImageReader ir;
    private HandlerThread ht;
    private Handler h;
    private long lastSent;

    @Override public IBinder onBind(Intent i) { return null; }

    @Override public int onStartCommand(Intent in, int flags, int startId) {
        if (in == null || "stop".equals(in.getAction())) { finish(false); return START_NOT_STICKY; }
        try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel("share_v1") == null)
                nm.createNotificationChannel(new NotificationChannel("share_v1", "Screen sharing", NotificationManager.IMPORTANCE_LOW));
            PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, ScreenShareService.class).setAction("stop"),
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0));
            PendingIntent open = PendingIntent.getActivity(this, 2, new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0));
            Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, "share_v1") : new Notification.Builder(this);
            b.setSmallIcon(android.R.drawable.ic_menu_share).setContentTitle("Studies Hub is sharing your screen").setContentText("Tap to go back to the call")
             .setOngoing(true).setContentIntent(open)
             .addAction(new Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel, "Stop sharing", stop).build());
            if (Build.VERSION.SDK_INT >= 29) startForeground(77, b.build(), android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
            else startForeground(77, b.build());

            int code = in.getIntExtra("code", 0);
            Intent data = in.getParcelableExtra("data");
            MediaProjectionManager mpm = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
            mp = mpm.getMediaProjection(code, data);
            ht = new HandlerThread("studies-share"); ht.start();
            h = new Handler(ht.getLooper());
            mp.registerCallback(new MediaProjection.Callback() {
                @Override public void onStop() { finish(true); }
            }, h);

            DisplayMetrics m = getResources().getDisplayMetrics();
            final int w = 720;
            int hh = Math.round(m.heightPixels * (w / (float) m.widthPixels));
            final int height = hh - (hh % 2);
            ir = ImageReader.newInstance(w, height, PixelFormat.RGBA_8888, 2);
            vd = mp.createVirtualDisplay("studies-share", w, height, m.densityDpi, DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, ir.getSurface(), null, h);
            ir.setOnImageAvailableListener(rd -> {
                Image img = null;
                try {
                    img = rd.acquireLatestImage();
                    if (img == null) return;
                    long now = SystemClock.uptimeMillis();
                    if (now - lastSent < 120) return; // about 8 pictures a second
                    lastSent = now;
                    Image.Plane pl = img.getPlanes()[0];
                    ByteBuffer buf = pl.getBuffer();
                    int pad = (pl.getRowStride() - pl.getPixelStride() * w) / pl.getPixelStride();
                    Bitmap bm = Bitmap.createBitmap(w + pad, height, Bitmap.Config.ARGB_8888);
                    bm.copyPixelsFromBuffer(buf);
                    Bitmap crop = pad > 0 ? Bitmap.createBitmap(bm, 0, 0, w, height) : bm;
                    ByteArrayOutputStream bo = new ByteArrayOutputStream();
                    crop.compress(Bitmap.CompressFormat.JPEG, 55, bo);
                    MainActivity a = ui;
                    if (a != null) a.sendFrame("data:image/jpeg;base64," + Base64.encodeToString(bo.toByteArray(), Base64.NO_WRAP));
                } catch (Throwable t) { /* skip this picture */ }
                finally { if (img != null) img.close(); }
            }, h);
            running = true;
            MainActivity a = ui; if (a != null) a.shareState("started");
        } catch (Throwable t) {
            finish(true);
            MainActivity a = ui; if (a != null) a.shareState("cancelled");
        }
        return START_NOT_STICKY;
    }

    private void finish(boolean tellPage) {
        running = false;
        try { if (vd != null) vd.release(); } catch (Throwable t) { }
        try { if (ir != null) ir.close(); } catch (Throwable t) { }
        try { if (mp != null) mp.stop(); } catch (Throwable t) { }
        try { if (ht != null) ht.quitSafely(); } catch (Throwable t) { }
        vd = null; ir = null; mp = null; ht = null;
        if (tellPage) { MainActivity a = ui; if (a != null) a.shareState("stopped"); }
        stopForeground(true);
        stopSelf();
    }

    @Override public void onDestroy() { running = false; super.onDestroy(); }
}
