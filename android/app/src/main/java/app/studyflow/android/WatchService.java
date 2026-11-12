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
    private long since = 0, lastShow = 0, graceUntil = 0, lastT = 0;
    private android.view.View shield;
    private android.widget.TextView shieldTimer, shieldMsg;
    /** For the app's own "is blocking really running?" check. */
    static volatile boolean running = false;
    static volatile long lastPoll = 0;
    static volatile int events = 0, blocks = 0;
    private final Runnable loop = new Runnable() {
        @Override public void run() {
            if (!Lock.active(WatchService.this)) { hideShield(); stopSelf(); return; }
            lastPoll = System.currentTimeMillis();
            try { check(); } catch (Exception ignored) {}
            try { tickShield(); } catch (Exception ignored) {}
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
        running = true;
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
                events++;
                front = e.getPackageName() == null ? "" : e.getPackageName();
                newest = e.getTimeStamp();
            }
        }
        if (newest > since) android.util.Log.i("SXWatch", "front=" + front + " t=" + newest + " lag=" + (now - newest));
        since = Math.max(since, newest);
        // Android can hold back the newest "app opened" event until something else happens, so also read
        // each app's "last used" time, which is updated at once. The most recently used app is the one in front.
        try {
            java.util.List<android.app.usage.UsageStats> st = um.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, now - 6 * 3600_000L, now + 1000);
            String best = null; long bt = 0;
            if (st != null) for (android.app.usage.UsageStats u : st) { long t = u.getLastTimeUsed(); if (t > bt) { bt = t; best = u.getPackageName(); } }
            if (best != null && bt > lastT && bt > since) {
                if (!best.equals(front)) android.util.Log.i("SXWatch", "stats front=" + best + " t=" + bt + " lag=" + (now - bt));
                front = best;
            }
            lastT = Math.max(lastT, Math.max(bt, since));
        } catch (Exception ignored) {}
        if (front.isEmpty() || front.equals(getPackageName())) return;
        if (!Lock.isBlocked(this, front)) return;
        if (now < graceUntil || shield != null) return;
        if (now - lastShow < 1200) return;
        lastShow = now; blocks++;
        android.util.Log.i("SXWatch", "BLOCK " + front);
        String blockedPkg = front;
        // 1) cover the blocked app at once (works even when Android refuses to switch screens)
        showShield(blockedPkg);
        // 2) send the blocked app to the background so it stops playing
        goHome();
    }

    private void goHome() {
        try { startActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); } catch (Exception ignored) {}
    }

    private int dp(int v) { return (int) (v * getResources().getDisplayMetrics().density); }

    private void showShield(String pkg) {
        if (shield != null || !Lock.hasOverlay(this)) return;
        android.view.WindowManager wm = (android.view.WindowManager) getSystemService(WINDOW_SERVICE);
        if (wm == null) return;
        String app = "This app";
        try { android.content.pm.PackageManager pm = getPackageManager(); app = pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString(); } catch (Exception ignored) {}
        android.widget.LinearLayout root = new android.widget.LinearLayout(this);
        root.setOrientation(android.widget.LinearLayout.VERTICAL);
        root.setGravity(android.view.Gravity.CENTER);
        root.setPadding(dp(28), dp(28), dp(28), dp(28));
        root.setBackground(new android.graphics.drawable.GradientDrawable(android.graphics.drawable.GradientDrawable.Orientation.TOP_BOTTOM, new int[]{0xFF1E1B4B, 0xFF4C1D95}));
        root.setClickable(true);
        android.widget.TextView icon = new android.widget.TextView(this); icon.setText("🔒"); icon.setTextSize(60); icon.setGravity(android.view.Gravity.CENTER); root.addView(icon);
        android.widget.TextView title = new android.widget.TextView(this); title.setText("Stay focused"); title.setTextColor(0xFFFFFFFF); title.setTextSize(30);
        title.setTypeface(android.graphics.Typeface.DEFAULT_BOLD); title.setGravity(android.view.Gravity.CENTER); root.addView(title);
        shieldMsg = new android.widget.TextView(this); shieldMsg.setText(app + " is blocked while you study.\nYou chose this — future you will be glad.");
        shieldMsg.setTextColor(0xE6FFFFFF); shieldMsg.setTextSize(16); shieldMsg.setGravity(android.view.Gravity.CENTER); shieldMsg.setPadding(0, dp(12), 0, dp(8)); root.addView(shieldMsg);
        shieldTimer = new android.widget.TextView(this); shieldTimer.setTextColor(0xFFFFFFFF); shieldTimer.setTextSize(20); shieldTimer.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        shieldTimer.setGravity(android.view.Gravity.CENTER); shieldTimer.setPadding(0, dp(8), 0, dp(24)); root.addView(shieldTimer);
        android.widget.Button back = new android.widget.Button(this); back.setText("Back to studying"); back.setAllCaps(false); back.setTextColor(0xFF4C1D95); back.setTextSize(16);
        android.graphics.drawable.GradientDrawable bg = new android.graphics.drawable.GradientDrawable(); bg.setColor(0xFFFFFFFF); bg.setCornerRadius(dp(16)); back.setBackground(bg);
        back.setPadding(dp(26), dp(14), dp(26), dp(14));
        back.setOnClickListener(v -> {
            graceUntil = System.currentTimeMillis() + 1500;
            goHome();
            try { startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)); } catch (Exception ignored) {}
            hideShield();
        });
        root.addView(back, new android.widget.LinearLayout.LayoutParams(-2, -2));
        android.view.WindowManager.LayoutParams lp = new android.view.WindowManager.LayoutParams(-1, -1,
                Build.VERSION.SDK_INT >= 26 ? android.view.WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : android.view.WindowManager.LayoutParams.TYPE_PHONE,
                android.view.WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN | android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
                android.graphics.PixelFormat.OPAQUE);
        try { wm.addView(root, lp); shield = root; tickShield(); } catch (Exception e) { shield = null; }
    }

    private void tickShield() {
        if (shield == null || shieldTimer == null) return;
        long s = Math.max(0, (Lock.until(this) - System.currentTimeMillis()) / 1000);
        shieldTimer.setText(String.format(java.util.Locale.US, "%d:%02d left in your focus session", s / 60, s % 60));
    }

    private void hideShield() {
        if (shield == null) return;
        try { ((android.view.WindowManager) getSystemService(WINDOW_SERVICE)).removeView(shield); } catch (Exception ignored) {}
        shield = null; shieldTimer = null; shieldMsg = null;
    }

    @Override public void onDestroy() { running = false; h.removeCallbacks(loop); hideShield(); super.onDestroy(); }
    @Override public IBinder onBind(Intent i) { return null; }
}
