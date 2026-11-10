package app.studyflow.android;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.view.accessibility.AccessibilityEvent;

/** Watches which app comes to the front. During a focus lock, blocked apps are sent home. */
public class BlockService extends AccessibilityService {
    private long lastBlock = 0;

    @Override
    public void onAccessibilityEvent(AccessibilityEvent e) {
        if (e == null || e.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return;
        CharSequence pkgCs = e.getPackageName();
        if (pkgCs == null) return;
        String pkg = pkgCs.toString();
        if (pkg.equals(getPackageName())) return;
        if (!Lock.active(this)) return;
        if (!Lock.isBlocked(this, pkg)) return;
        long now = System.currentTimeMillis();
        if (now - lastBlock < 800) return;
        lastBlock = now;
        performGlobalAction(GLOBAL_ACTION_HOME);
        Intent i = new Intent(this, BlockedActivity.class)
                .putExtra("pkg", pkg)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        try { startActivity(i); } catch (Exception ignored) {}
    }

    @Override
    public void onInterrupt() {}
}
