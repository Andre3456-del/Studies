package org.studieshub.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/** After the phone restarts, carry on showing the person as online (if they have that turned on). */
public class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent i) {
        // nothing to start any more: the always-on online helper was removed
    }
}
