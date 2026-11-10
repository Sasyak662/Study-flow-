package app.studyflow.android;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;

/** Home-screen widget: today's study minutes + one-tap "Start focus". */
public class StudyWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) { push(c, m, ids); }

    static void refreshAll(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        int[] ids = m.getAppWidgetIds(new ComponentName(c, StudyWidget.class));
        if (ids != null && ids.length > 0) push(c, m, ids);
    }

    private static void push(Context c, AppWidgetManager m, int[] ids) {
        int mins = Lock.p(c).getInt("w_mins", 0);
        String day = Lock.p(c).getString("w_day", "");
        String today = new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(new java.util.Date());
        if (!today.equals(day)) mins = 0;
        String st = Lock.p(c).getString("w_status", "idle");
        String label = "focusing".equals(st) ? "Focusing now 🔥" : "break".equals(st) ? "On a break" : "paused".equals(st) ? "Paused" : mins == 0 ? "No study yet today" : "Nice work today";
        if (Lock.active(c)) label += " · 🔒";
        for (int id : ids) {
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget);
            v.setTextViewText(R.id.w_mins, (mins >= 60 ? (mins / 60) + "h " + (mins % 60) + "m" : mins + "m"));
            v.setTextViewText(R.id.w_status, label);
            Intent start = new Intent(c, MainActivity.class).setAction(Intent.ACTION_VIEW)
                    .setData(Uri.parse(MainActivity.SITE + "/?go=focus&start=1&app=android"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            Intent open = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            v.setOnClickPendingIntent(R.id.w_start, PendingIntent.getActivity(c, 1, start, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
            v.setOnClickPendingIntent(R.id.w_root, PendingIntent.getActivity(c, 2, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
            m.updateAppWidget(id, v);
        }
    }
}
