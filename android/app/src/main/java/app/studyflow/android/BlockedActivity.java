package app.studyflow.android;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Full-screen "stay focused" page shown when a blocked app is opened. */
public class BlockedActivity extends Activity {
    private final Handler h = new Handler(Looper.getMainLooper());
    private TextView timer;
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            long left = Lock.until(BlockedActivity.this) - System.currentTimeMillis();
            if (left <= 0) { timer.setText("Session finished — well done!"); return; }
            long s = left / 1000;
            timer.setText(String.format(java.util.Locale.US, "%d:%02d left in your focus session", s / 60, s % 60));
            h.postDelayed(this, 1000);
        }
    };

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        float d = getResources().getDisplayMetrics().density;
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        int pad = (int) (28 * d);
        root.setPadding(pad, pad, pad, pad);

        TextView icon = new TextView(this);
        icon.setText("🌱");
        icon.setTextSize(64);
        icon.setGravity(Gravity.CENTER);
        root.addView(icon);

        TextView title = new TextView(this);
        title.setText("Stay focused");
        title.setTextColor(Color.WHITE);
        title.setTextSize(30);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setGravity(Gravity.CENTER);
        root.addView(title);

        String app = "This app";
        String pkg = getIntent().getStringExtra("pkg");
        if (pkg != null) {
            try {
                PackageManager pm = getPackageManager();
                app = pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString();
            } catch (Exception ignored) {}
        }
        TextView msg = new TextView(this);
        msg.setText(app + " is blocked while you study.\nYou chose this — future you will be glad.");
        msg.setTextColor(0xE6FFFFFF);
        msg.setTextSize(16);
        msg.setGravity(Gravity.CENTER);
        msg.setPadding(0, (int) (12 * d), 0, (int) (8 * d));
        root.addView(msg);

        timer = new TextView(this);
        timer.setTextColor(Color.WHITE);
        timer.setTextSize(18);
        timer.setTypeface(Typeface.DEFAULT_BOLD);
        timer.setGravity(Gravity.CENTER);
        timer.setPadding(0, (int) (8 * d), 0, (int) (24 * d));
        root.addView(timer);

        Button back = new Button(this);
        back.setText("Back to StudyStarx");
        back.setAllCaps(false);
        back.setTextColor(0xFF047857);
        back.setTextSize(16);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.WHITE);
        bg.setCornerRadius(16 * d);
        back.setBackground(bg);
        back.setPadding((int) (24 * d), (int) (14 * d), (int) (24 * d), (int) (14 * d));
        back.setOnClickListener(v -> {
            startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP));
            finish();
        });
        root.addView(back, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        setContentView(root);
    }

    @Override protected void onResume() { super.onResume(); h.post(tick); }
    @Override protected void onPause() { super.onPause(); h.removeCallbacks(tick); }

    @Override
    public void onBackPressed() {
        Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(home);
        finish();
    }
}
