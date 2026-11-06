package org.studieshub.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** The Retry button on a paused-upload notification. The file is still on the phone, so nothing is picked again. */
public class UploadRetryReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent i) {
        String id = i.getStringExtra("id");
        if (id != null) UploadService.retry(c, id);
    }
}
