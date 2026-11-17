package app.studyflow.android;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;
import java.util.List;

/** Watches which app comes to the front. During a focus lock, blocked apps are covered and sent away at once,
 *  and a blocked app's floating picture-in-picture video is paused and closed. */
public class BlockService extends AccessibilityService {
    private long lastBlock = 0, lastPip = 0;
    private final Handler ui = new Handler(Looper.getMainLooper());

    @Override
    public void onAccessibilityEvent(AccessibilityEvent e) {
        if (e == null) return;
        if (!Lock.active(this)) return;
        if (e.getEventType() == AccessibilityEvent.TYPE_WINDOWS_CHANGED) { closePip(); return; }
        if (e.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return;
        CharSequence pkgCs = e.getPackageName();
        if (pkgCs == null) return;
        String pkg = pkgCs.toString();
        if (pkg.equals(getPackageName())) return;
        if (!Lock.isBlocked(this, pkg)) return;
        long now = System.currentTimeMillis();
        if (now - lastBlock < 300) return;
        lastBlock = now;
        // cover it at once with the focus screen, then send it away WITHOUT a "Home press"
        // (a Home press makes video apps pop into a floating window that keeps playing)
        boolean shown = WatchService.blockNow(pkg);
        if (!shown) {
            Intent i = new Intent(this, BlockedActivity.class)
                    .putExtra("pkg", pkg)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NO_ANIMATION | Intent.FLAG_ACTIVITY_NO_USER_ACTION);
            try { startActivity(i); } catch (Exception ignored) {}
        }
        ui.postDelayed(this::closePip, 600);
        ui.postDelayed(this::closePip, 1500);
    }

    /** Find a floating video from a blocked app: pause it, then tap it and press the system "Close" button. */
    private void closePip() {
        if (Build.VERSION.SDK_INT < 26) return;
        long now = System.currentTimeMillis();
        if (now - lastPip < 400) return;
        try {
            List<AccessibilityWindowInfo> ws = getWindows();
            if (ws == null) return;
            for (AccessibilityWindowInfo w : ws) {
                if (!w.isInPictureInPictureMode()) continue;
                AccessibilityNodeInfo r = w.getRoot();
                String pkg = r != null && r.getPackageName() != null ? r.getPackageName().toString() : "";
                if (!pkg.isEmpty() && !Lock.isBlocked(this, pkg)) continue;
                lastPip = now;
                WatchService.pauseMedia(this);
                if (r != null) r.performAction(AccessibilityNodeInfo.ACTION_CLICK);
                ui.postDelayed(this::pressClose, 350);
                ui.postDelayed(this::pressClose, 800);
                return;
            }
        } catch (Exception ignored) {}
    }

    private void pressClose() {
        try {
            for (AccessibilityWindowInfo w : getWindows()) {
                AccessibilityNodeInfo r = w.getRoot();
                if (r == null) continue;
                AccessibilityNodeInfo b = find(r, 0);
                if (b != null) { b.performAction(AccessibilityNodeInfo.ACTION_CLICK); return; }
            }
        } catch (Exception ignored) {}
    }

    private AccessibilityNodeInfo find(AccessibilityNodeInfo n, int depth) {
        if (n == null || depth > 12) return null;
        CharSequence d = n.getContentDescription(), t = n.getText();
        String s = ((d == null ? "" : d) + " " + (t == null ? "" : t)).trim().toLowerCase();
        CharSequence pk = n.getPackageName();
        boolean sys = pk != null && pk.toString().contains("systemui");
        if (sys && n.isClickable() && (s.equals("close") || s.startsWith("close ") || s.contains("dismiss") || s.equals("close pip"))) return n;
        for (int i = 0; i < n.getChildCount(); i++) { AccessibilityNodeInfo c = find(n.getChild(i), depth + 1); if (c != null) return c; }
        return null;
    }

    @Override
    public void onInterrupt() {}
}
