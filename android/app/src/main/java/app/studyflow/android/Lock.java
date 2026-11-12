package app.studyflow.android;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.provider.Settings;
import android.text.TextUtils;

import android.content.pm.ResolveInfo;

import org.json.JSONArray;

import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Shared state for the focus lock: blocked apps, lock end time, widget numbers. */
public final class Lock {
    private Lock() {}
    static final String PREFS = "studyflow";
    static final String CH_FOCUS = "focus";
    static final String CH_NUDGE = "nudges";
    static final int NOTIF_LOCK = 1;

    static SharedPreferences p(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    static Set<String> blocked(Context c) { return new HashSet<>(p(c).getStringSet("blocked", new HashSet<String>())); }
    static void setBlocked(Context c, Set<String> s) { p(c).edit().putStringSet("blocked", new HashSet<>(s)).apply(); }

    static long until(Context c) { return p(c).getLong("until", 0L); }
    static boolean active(Context c) { return until(c) > System.currentTimeMillis(); }

    static void start(Context c, int minutes) {
        int m = Math.max(1, Math.min(600, minutes));
        long end = System.currentTimeMillis() + m * 60_000L;
        p(c).edit().putLong("until", end).apply();
        showLockNotification(c, end);
        WatchService.start(c);
    }

    /** Apps blocked only for the current lock (picked by name on the website, e.g. "youtube"). */
    static Set<String> session(Context c) { return new HashSet<>(p(c).getStringSet("sess", new HashSet<String>())); }
    static boolean isBlocked(Context c, String pkg) { return blocked(c).contains(pkg) || session(c).contains(pkg); }
    static boolean strict(Context c) { return active(c) && p(c).getBoolean("strict", false); }

    /** Finds installed apps whose package name or app name contains one of the given words. */
    static Set<String> resolve(Context c, String json) {
        Set<String> out = new HashSet<>();
        try {
            JSONArray a = new JSONArray(json == null ? "[]" : json);
            Intent i = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
            List<ResolveInfo> apps = c.getPackageManager().queryIntentActivities(i, 0);
            for (int k = 0; k < a.length(); k++) {
                String w = a.optString(k, "").toLowerCase(Locale.ROOT).trim();
                if (w.length() < 2) continue;
                String bare = w.replace(".com", "");
                for (ResolveInfo r : apps) {
                    String pkg = r.activityInfo.packageName;
                    if (pkg.equals(c.getPackageName())) continue;
                    String label = String.valueOf(r.loadLabel(c.getPackageManager())).toLowerCase(Locale.ROOT);
                    String lp = pkg.toLowerCase(Locale.ROOT);
                    boolean hit = lp.contains(bare) || label.equals(bare) || label.startsWith(bare + " ") || label.contains(bare);
                    if (bare.equals("x")) hit = lp.equals("com.twitter.android") || label.equals("x");
                    if (bare.equals("tiktok")) hit = hit || lp.startsWith("com.zhiliaoapp.musically") || lp.startsWith("com.ss.android.ugc");
                    if (hit) out.add(pkg);
                }
            }
        } catch (Exception ignored) {}
        return out;
    }

    static void startNames(Context c, int minutes, String json, boolean strict) {
        Set<String> s = active(c) ? session(c) : new HashSet<String>();
        s.addAll(resolve(c, json));
        p(c).edit().putStringSet("sess", s).putBoolean("strict", strict || strict(c)).apply();
        long old = until(c);
        start(c, minutes);
        if (old > until(c)) { p(c).edit().putLong("until", old).apply(); showLockNotification(c, old); }
        WatchService.start(c);
    }

    static void stopNames(Context c, String json) {
        if (strict(c)) return;
        Set<String> s = session(c);
        s.removeAll(resolve(c, json));
        p(c).edit().putStringSet("sess", s).apply();
        if (s.isEmpty() && blocked(c).isEmpty()) stop(c);
    }

    static void stop(Context c) {
        if (strict(c)) return;
        p(c).edit().putLong("until", 0L).putStringSet("sess", new HashSet<String>()).putBoolean("strict", false).apply();
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(NOTIF_LOCK);
        WatchService.stop(c);
    }

    /** "Usage access": lets the app see which app is open (needed for blocking without Accessibility). */
    static boolean hasUsage(Context c) {
        try {
            android.app.AppOpsManager ao = (android.app.AppOpsManager) c.getSystemService(Context.APP_OPS_SERVICE);
            if (ao == null) return false;
            int mode = Build.VERSION.SDK_INT >= 29
                    ? ao.unsafeCheckOpNoThrow(android.app.AppOpsManager.OPSTR_GET_USAGE_STATS, android.os.Process.myUid(), c.getPackageName())
                    : ao.checkOpNoThrow(android.app.AppOpsManager.OPSTR_GET_USAGE_STATS, android.os.Process.myUid(), c.getPackageName());
            return mode == android.app.AppOpsManager.MODE_ALLOWED;
        } catch (Exception e) { return false; }
    }
    /** "Display over other apps": lets the Stay-focused screen appear over a blocked app. */
    static boolean hasOverlay(Context c) { return Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(c); }
    static boolean batteryOk(Context c) {
        if (Build.VERSION.SDK_INT < 23) return true;
        android.os.PowerManager pm = (android.os.PowerManager) c.getSystemService(Context.POWER_SERVICE);
        return pm == null || pm.isIgnoringBatteryOptimizations(c.getPackageName());
    }
    static boolean isXiaomi() { String m = (Build.MANUFACTURER + " " + Build.BRAND).toLowerCase(Locale.ROOT); return m.contains("xiaomi") || m.contains("redmi") || m.contains("poco"); }
    /** Blocking works if both new permissions are on, or the older Accessibility switch is on. */
    static boolean ready(Context c) { return hasUsage(c) && hasOverlay(c); }

    static boolean serviceEnabled(Context c) {
        String on = Settings.Secure.getString(c.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        if (TextUtils.isEmpty(on)) return false;
        String me = new ComponentName(c, BlockService.class).flattenToString();
        String meShort = new ComponentName(c, BlockService.class).flattenToShortString();
        for (String s : on.split(":")) if (s.equalsIgnoreCase(me) || s.equalsIgnoreCase(meShort)) return true;
        return false;
    }

    static void channels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        nm.createNotificationChannel(new NotificationChannel(CH_FOCUS, "Focus lock", NotificationManager.IMPORTANCE_LOW));
        nm.createNotificationChannel(new NotificationChannel(CH_NUDGE, "Study nudges", NotificationManager.IMPORTANCE_HIGH));
    }

    static Notification.Builder builder(Context c, String channel) {
        channels(c);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, channel) : new Notification.Builder(c);
        Intent open = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return b.setSmallIcon(android.R.drawable.ic_lock_idle_lock).setContentIntent(pi).setAutoCancel(true);
    }

    static void showLockNotification(Context c, long end) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        try { nm.notify(NOTIF_LOCK, lockNotification(c, end).build()); } catch (SecurityException ignored) {}
    }

    static Notification.Builder lockNotification(Context c, long end) {
        Set<String> all = blocked(c); all.addAll(session(c)); int n = all.size();
        Notification.Builder b = builder(c, CH_FOCUS)
                .setContentTitle("Focus lock is on")
                .setContentText(n == 0 ? "No apps chosen yet — open StudyStarx to pick apps to block." : n + (n == 1 ? " app" : " apps") + " blocked until your session ends")
                .setOngoing(true).setAutoCancel(false)
                .setWhen(end).setShowWhen(true);
        if (Build.VERSION.SDK_INT >= 24) b.setUsesChronometer(true).setChronometerCountDown(true);
        return b;
    }

    static void nudge(Context c, String title, String body) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        Notification.Builder b = builder(c, CH_NUDGE).setContentTitle(title).setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body));
        try { nm.notify((int) (System.currentTimeMillis() % 100000) + 10, b.build()); } catch (SecurityException ignored) {}
    }
}
