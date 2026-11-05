package org.studieshub.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/** After the phone restarts, carry on showing the person as online (if they have that turned on). */
public class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent i) {
        try {
            if (!c.getSharedPreferences("studieshub", Context.MODE_PRIVATE).getBoolean("presence", true)) return;
            Intent s = new Intent(c, PresenceService.class);
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(s); else c.startService(s);
        } catch (Throwable t) { /* ignore */ }
    }
}
