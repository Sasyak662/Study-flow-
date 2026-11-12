package app.studyflow.android;

import android.app.Notification;
import android.app.Service;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

/**
 * Focus lock without Accessibility: while a lock runs, this checks which app is in front
 * (Usage access) about every 0.6 s and covers blocked apps with the "Stay focused" screen
 * (needs "Display over other apps"). It stops itself when the lock ends.
 */
public class WatchService extends Service {
    private final Handler h = new Handler(Looper.getMainLooper());
    private String front = "";
    private long since = 0, lastShow = 0;
    private final Runnable loop = new Runnable() {
        @Override public void run() {
            if (!Lock.active(WatchService.this)) { stopSelf(); return; }
            try { check(); } catch (Exception ignored) {}
            h.postDelayed(this, screenOn() ? 600 : 3000);
        }
    };

    static void start(Context c) {
        if (!Lock.hasUsage(c)) return;
        Intent i = new Intent(c, WatchService.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
        } catch (Exception ignored) {}
    }
    static void stop(Context c) { try { c.stopService(new Intent(c, WatchService.class)); } catch (Exception ignored) {} }

    @Override public void onCreate() {
        super.onCreate();
        since = System.currentTimeMillis() - 15_000;
        Notification n = Lock.lockNotification(this, Lock.until(this)).build();
        try {
            if (Build.VERSION.SDK_INT >= 34) startForeground(Lock.NOTIF_LOCK, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            else startForeground(Lock.NOTIF_LOCK, n);
        } catch (Exception e) { stopSelf(); }
    }

    @Override public int onStartCommand(Intent i, int f, int id) {
        h.removeCallbacks(loop);
        h.post(loop);
        return START_STICKY;
    }

    private boolean screenOn() {
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        return pm == null || pm.isInteractive();
    }

    private void check() {
        UsageStatsManager um = (UsageStatsManager) getSystemService(Context.USAGE_STATS_SERVICE);
        if (um == null) return;
        long now = System.currentTimeMillis();
        UsageEvents ev = um.queryEvents(since, now + 1000);
        UsageEvents.Event e = new UsageEvents.Event();
        long newest = since;
        while (ev != null && ev.hasNextEvent()) {
            ev.getNextEvent(e);
            if (e.getEventType() == UsageEvents.Event.MOVE_TO_FOREGROUND && e.getTimeStamp() >= newest) {
                front = e.getPackageName() == null ? "" : e.getPackageName();
                newest = e.getTimeStamp();
            }
        }
        since = Math.max(since, newest);
        if (front.isEmpty() || front.equals(getPackageName())) return;
        if (!Lock.isBlocked(this, front)) return;
        if (now - lastShow < 1500) return;
        lastShow = now;
        String blockedPkg = front;
        // Send the blocked app away, then show the focus screen on top.
        try {
            startActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (Exception ignored) {}
        try {
            startActivity(new Intent(this, BlockedActivity.class).putExtra("pkg", blockedPkg)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NO_ANIMATION));
        } catch (Exception ignored) {}
        front = "";
    }

    @Override public void onDestroy() { h.removeCallbacks(loop); super.onDestroy(); }
    @Override public IBinder onBind(Intent i) { return null; }
}
