package app.studyflow.android;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.provider.Settings;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Choose which apps are blocked during focus sessions and switch the blocker on. */
public class BlockerActivity extends Activity {
    static final Set<String> COMMON = new HashSet<>(Arrays.asList(
            "com.instagram.android", "com.google.android.youtube", "com.zhiliaoapp.musically", "com.ss.android.ugc.trill",
            "com.snapchat.android", "com.facebook.katana", "com.twitter.android", "com.reddit.frontpage",
            "com.netflix.mediaclient", "in.startv.hotstar", "com.amazon.avod.thirdpartyclient", "com.discord",
            "com.whatsapp", "org.telegram.messenger", "com.pinterest", "com.spotify.music", "com.mxtech.videoplayer.ad",
            "com.supercell.clashofclans", "com.pubg.imobile", "com.dts.freefireth", "com.activision.callofduty.shooter",
            "com.roblox.client", "com.mojang.minecraftpe", "com.tinder", "com.linkedin.android", "com.facebook.orca", "com.threads.android", "com.instagram.barcelona"));

    private float d;
    private TextView status;
    private Button enable;
    private LinearLayout list;
    private final List<View> rows = new ArrayList<>();
    private final List<String> labels = new ArrayList<>();
    private Set<String> chosen;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        d = getResources().getDisplayMetrics().density;
        chosen = Lock.blocked(this);

        ScrollView sv = new ScrollView(this);
        sv.setBackgroundColor(0xFFF4F5F9);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(18), dp(22), dp(18), dp(28));
        sv.addView(root);

        TextView h = text("Block distracting apps", 24, 0xFF0B1220, true);
        root.addView(h);
        root.addView(text("While a StudyStarx focus session is running, these apps close and you're sent back to studying. When the session ends, everything works normally again.", 14, 0xFF64748B, false));

        LinearLayout card = card(0xFFFFFFFF);
        status = text("", 15, 0xFF0B1220, true);
        card.addView(status);
        TextView how = text("Android needs you to switch on \"StudyStarx Focus Lock\" once in Accessibility settings (Installed apps → StudyStarx Focus Lock → On). It only checks which app is open — it never reads your screen.", 13, 0xFF64748B, false);
        card.addView(how);
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            card.addView(text("Greyed out or says \"Restricted setting\"? Open App info for StudyStarx, tap ⋮ (top right) → \"Allow restricted settings\", then try again.", 13, 0xFFB45309, false));
            Button info = button("Open StudyStarx App info", 0xFFFFFFFF, 0xFF0B1220);
            info.setOnClickListener(v -> {
                try { startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:" + getPackageName()))); } catch (Exception ignored) {}
            });
            card.addView(info);
        }
        enable = button("Open Accessibility settings", 0xFF4F46E5, Color.WHITE);
        enable.setOnClickListener(v -> {
            try { startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)); } catch (Exception ignored) {}
        });
        card.addView(enable);
        Button test = button("Test: lock for 1 minute", 0xFFE0E7FF, 0xFF4338CA);
        test.setOnClickListener(v -> {
            Lock.start(this, 1);
            refresh();
            android.widget.Toast.makeText(this, "Lock on for 1 minute. Try opening a blocked app.", android.widget.Toast.LENGTH_LONG).show();
        });
        card.addView(test);
        Button stop = button("Stop the lock now", 0xFFFFFFFF, 0xFF0B1220);
        stop.setOnClickListener(v -> { Lock.stop(this); refresh(); });
        card.addView(stop);
        root.addView(card);

        root.addView(text("Your apps", 18, 0xFF0B1220, true));
        EditText search = new EditText(this);
        search.setHint("Search apps");
        search.setSingleLine(true);
        root.addView(search, new LinearLayout.LayoutParams(-1, -2));
        list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        root.addView(list);
        TextView loading = text("Loading your apps…", 14, 0xFF64748B, false);
        list.addView(loading);

        search.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int a, int b2, int c) {}
            public void onTextChanged(CharSequence s, int a, int b2, int c) {}
            public void afterTextChanged(Editable e) {
                String q = e.toString().toLowerCase(Locale.ROOT).trim();
                for (int i = 0; i < rows.size(); i++) rows.get(i).setVisibility(q.isEmpty() || labels.get(i).contains(q) ? View.VISIBLE : View.GONE);
            }
        });

        setContentView(sv);
        new Thread(this::loadApps).start();
    }

    private void loadApps() {
        PackageManager pm = getPackageManager();
        Intent main = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> apps = pm.queryIntentActivities(main, 0);
        final List<Object[]> items = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (ResolveInfo r : apps) {
            String pkg = r.activityInfo.packageName;
            if (pkg.equals(getPackageName()) || !seen.add(pkg)) continue;
            String label = String.valueOf(r.loadLabel(pm));
            Drawable icon = null;
            try { icon = r.loadIcon(pm); } catch (Exception ignored) {}
            items.add(new Object[]{pkg, label, icon});
        }
        items.sort((a, b) -> {
            int ca = COMMON.contains((String) a[0]) ? 0 : 1, cb = COMMON.contains((String) b[0]) ? 0 : 1;
            if (ca != cb) return ca - cb;
            return ((String) a[1]).compareToIgnoreCase((String) b[1]);
        });
        runOnUiThread(() -> {
            list.removeAllViews();
            boolean shownOthers = false;
            if (!items.isEmpty() && COMMON.contains((String) items.get(0)[0])) list.addView(text("Usually distracting", 13, 0xFF4F46E5, true));
            for (Object[] it : items) {
                final String pkg = (String) it[0];
                if (!shownOthers && !COMMON.contains(pkg)) {
                    shownOthers = true;
                    list.addView(text("All other apps", 13, 0xFF4F46E5, true));
                }
                LinearLayout row = new LinearLayout(this);
                row.setOrientation(LinearLayout.HORIZONTAL);
                row.setGravity(Gravity.CENTER_VERTICAL);
                row.setPadding(dp(10), dp(8), dp(10), dp(8));
                GradientDrawable bg = new GradientDrawable();
                bg.setColor(Color.WHITE);
                bg.setCornerRadius(dp(12));
                row.setBackground(bg);
                LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
                lp.topMargin = dp(6);
                ImageView iv = new ImageView(this);
                if (it[2] != null) iv.setImageDrawable((Drawable) it[2]);
                row.addView(iv, new LinearLayout.LayoutParams(dp(36), dp(36)));
                CheckBox cb = new CheckBox(this);
                cb.setText((String) it[1]);
                cb.setTextSize(15);
                cb.setTextColor(0xFF0B1220);
                cb.setChecked(chosen.contains(pkg));
                cb.setPadding(dp(8), 0, 0, 0);
                cb.setOnCheckedChangeListener((btn, on) -> {
                    if (on) chosen.add(pkg); else chosen.remove(pkg);
                    Lock.setBlocked(this, chosen);
                    refresh();
                });
                LinearLayout.LayoutParams cl = new LinearLayout.LayoutParams(0, -2, 1f);
                row.addView(cb, cl);
                row.setOnClickListener(v -> cb.toggle());
                list.addView(row, lp);
                rows.add(row);
                labels.add(((String) it[1]).toLowerCase(Locale.ROOT));
            }
        });
    }

    @Override protected void onResume() { super.onResume(); refresh(); }

    private void refresh() {
        boolean on = Lock.serviceEnabled(this);
        int n = chosen.size();
        String s = (on ? "✅ Blocker is switched on" : "⚠️ Blocker is switched off") + " · " + n + (n == 1 ? " app chosen" : " apps chosen");
        if (Lock.active(this)) {
            long left = (Lock.until(this) - System.currentTimeMillis()) / 60000 + 1;
            s += "\n🔒 Lock running — about " + left + " min left";
        }
        status.setText(s);
        enable.setText(on ? "Accessibility settings" : "Switch on the blocker");
    }

    private int dp(int v) { return (int) (v * d); }

    private TextView text(String s, int size, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(size);
        t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setPadding(0, dp(6), 0, dp(6));
        return t;
    }

    private LinearLayout card(int color) {
        LinearLayout c = new LinearLayout(this);
        c.setOrientation(LinearLayout.VERTICAL);
        c.setPadding(dp(16), dp(12), dp(16), dp(14));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(color);
        bg.setCornerRadius(dp(16));
        c.setBackground(bg);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.topMargin = dp(14);
        lp.bottomMargin = dp(14);
        c.setLayoutParams(lp);
        return c;
    }

    private Button button(String s, int bgc, int fg) {
        Button b = new Button(this);
        b.setText(s);
        b.setAllCaps(false);
        b.setTextColor(fg);
        b.setTextSize(15);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(bgc);
        bg.setCornerRadius(dp(12));
        bg.setStroke(dp(1), 0x22000000);
        b.setBackground(bg);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, dp(48));
        lp.topMargin = dp(8);
        b.setLayoutParams(lp);
        return b;
    }
}
