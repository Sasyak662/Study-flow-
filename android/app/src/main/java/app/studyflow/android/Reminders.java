package app.studyflow.android;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import org.json.JSONArray;
import org.json.JSONObject;

/** Study-session reminders from the Smart Timetable. They fire even when the app is closed, and survive a restart. */
public class Reminders extends BroadcastReceiver {
    static final String ACTION = "app.studyflow.android.REMIND";
    static SharedPreferences p(Context c) { return c.getSharedPreferences("sf_reminders", Context.MODE_PRIVATE); }

    static PendingIntent intent(Context c, int code, String title, String body) {
        Intent i = new Intent(c, Reminders.class).setAction(ACTION).putExtra("title", title).putExtra("body", body);
        return PendingIntent.getBroadcast(c, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** json: [{"id":"...","at":epochMillis,"title":"...","body":"..."}] — replaces every reminder set before. */
    static void schedule(Context c, String json) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        String old = p(c).getString("codes", "");
        for (String s : old.split(",")) {
            if (s.isEmpty()) continue;
            try { am.cancel(intent(c, Integer.parseInt(s), "", "")); } catch (Exception ignored) {}
        }
        StringBuilder codes = new StringBuilder();
        long now = System.currentTimeMillis();
        try {
            JSONArray a = new JSONArray(json == null ? "[]" : json);
            int n = 0;
            for (int k = 0; k < a.length() && n < 60; k++) {
                JSONObject o = a.getJSONObject(k);
                long at = o.optLong("at", 0);
                if (at <= now) continue;
                int code = 5000 + (o.optString("id", String.valueOf(k)).hashCode() & 0x7ffff);
                PendingIntent pi = intent(c, code, o.optString("title", "Time to study"), o.optString("body", ""));
                if (Build.VERSION.SDK_INT >= 23) am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
                else am.set(AlarmManager.RTC_WAKEUP, at, pi);
                codes.append(code).append(',');
                n++;
            }
            p(c).edit().putString("json", json).putString("codes", codes.toString()).apply();
        } catch (Exception ignored) {}
    }

    @Override public void onReceive(Context c, Intent i) {
        String a = i.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(a) || "android.intent.action.MY_PACKAGE_REPLACED".equals(a)) {
            schedule(c, p(c).getString("json", "[]"));
            if (Lock.active(c)) WatchService.start(c);
            return;
        }
        if (ACTION.equals(a)) Lock.nudge(c, i.getStringExtra("title"), i.getStringExtra("body"));
    }
}
