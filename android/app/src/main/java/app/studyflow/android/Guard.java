package app.studyflow.android;

import android.app.admin.DeviceAdminReceiver;
import android.content.Context;
import android.content.Intent;

/** Optional "stop me deleting StudyFlow" protection (StudyFlow Plus). While it is on, Android asks
 *  the user to switch it off in Settings before the app can be uninstalled. */
public class Guard extends DeviceAdminReceiver {
    @Override
    public CharSequence onDisableRequested(Context c, Intent i) {
        return Lock.active(c)
                ? "Your focus lock is still running. Finish it first - you set this up to stay focused."
                : "Turning this off lets StudyFlow be deleted.";
    }
}
