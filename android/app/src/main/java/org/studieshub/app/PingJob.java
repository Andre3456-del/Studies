package org.studieshub.app;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.webkit.CookieManager;

/**
 * Lets the phone check in with Studies Hub by itself whenever it has an internet connection, without the app being opened.
 * The server then knows the phone is reachable, so messages waiting for it get their second tick.
 * Android decides the exact moment (about every 15 minutes while connected), and it survives a restart of the phone.
 */
public class PingJob extends JobService {
    static final int ID = 4242;

    static void schedule(Context c) {
        try {
            JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            if (js == null) return;
            for (JobInfo j : js.getAllPendingJobs()) if (j.getId() == ID) return;
            js.schedule(new JobInfo.Builder(ID, new ComponentName(c, PingJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPeriodic(15 * 60 * 1000L)
                .setPersisted(true)
                .build());
        } catch (Throwable t) { /* the phone refused: notifications still work */ }
    }

    @Override public boolean onStartJob(final JobParameters p) {
        new Thread(() -> {
            try {
                String cookie = CookieManager.getInstance().getCookie("https://studieshub.org");
                if (cookie != null && cookie.contains("sid=")) {
                    java.net.HttpURLConnection h = (java.net.HttpURLConnection) new java.net.URL("https://studieshub.org/api/ping").openConnection();
                    h.setConnectTimeout(8000); h.setReadTimeout(8000);
                    h.setRequestProperty("Cookie", cookie);
                    h.getResponseCode();
                    h.disconnect();
                }
            } catch (Throwable t) { }
            try { if (Backup.due(PingJob.this)) { Backup.run(PingJob.this); if (Gdrive.on(PingJob.this)) Gdrive.backupNow(PingJob.this); } } catch (Throwable t) { }
            jobFinished(p, false);
        }).start();
        return true;
    }

    @Override public boolean onStopJob(JobParameters p) { return false; }
}
