#!/bin/bash
# Runs on a GitHub emulator: starts a focus lock that blocks the Settings app, opens Settings, records what happens.
set -x
PKG=app.studyflow.android
mkdir -p shots
adb install -r test.apk
adb shell appops set $PKG GET_USAGE_STATS allow
adb shell appops set $PKG SYSTEM_ALERT_WINDOW allow
adb shell pm grant $PKG android.permission.POST_NOTIFICATIONS || true
adb shell settings put global hidden_api_policy 1 || true
adb shell am start -n $PKG/.MainActivity; sleep 6
adb shell am force-stop $PKG
adb root; sleep 3
U=$(adb shell stat -c %u /data/data/$PKG | tr -d '\r')
UNTIL=$(( ($(adb shell date +%s | tr -d '\r') + 900) * 1000 ))
cat > prefs.xml <<XML
<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<map>
    <long name="until" value="$UNTIL" />
    <set name="blocked">
        <string>com.android.settings</string>
    </set>
</map>
XML
adb shell mkdir -p /data/data/$PKG/shared_prefs
adb push prefs.xml /data/data/$PKG/shared_prefs/studyflow.xml
adb shell chown -R $U:$U /data/data/$PKG/shared_prefs
adb shell restorecon -R /data/data/$PKG/shared_prefs
adb shell am start -n $PKG/.MainActivity; sleep 8
adb exec-out screencap -p > shots/1-app-open.png
echo "=== service ===" ; adb shell dumpsys activity services $PKG | grep -E "ServiceRecord|isForeground|foregroundServiceType" | tee shots/service.txt
adb shell input keyevent KEYCODE_HOME; sleep 2
adb logcat -c
adb shell log -t SXTest OPEN_SETTINGS
adb shell am start -n com.android.settings/.Settings; sleep 3
adb exec-out screencap -p > shots/2-blocked-app-opened.png
sleep 9
adb exec-out screencap -p > shots/2b-after-12s.png
# tap the shield button (centre, a bit below middle) to dismiss, then stay on home 6 s: must NOT block again
adb shell input tap 540 1500; sleep 6
adb exec-out screencap -p > shots/2c-after-dismiss.png
adb shell log -t SXTest REOPEN_SETTINGS
adb shell am start -n com.android.settings/.Settings; sleep 4
adb exec-out screencap -p > shots/2d-reopened.png
adb shell log -t SXTest PRESS_HOME
echo "=== after opening blocked app ===" | tee shots/result.txt
adb shell dumpsys window | grep -E "mCurrentFocus|mFocusedApp" | tee -a shots/result.txt
adb shell dumpsys window windows | grep -E "Window #|mOwnerUid|ty=APPLICATION_OVERLAY" | grep -B1 -A1 "$PKG" | head -20 | tee -a shots/result.txt
# tap "Back to studying" area is not needed; try opening the blocked app a second time
adb shell input keyevent KEYCODE_HOME; sleep 2
adb exec-out screencap -p > shots/3-after-home.png
# control: an app that is NOT blocked must open normally
adb shell log -t SXTest OPEN_DIALER
adb shell am start -a android.intent.action.DIAL; sleep 4
adb exec-out screencap -p > shots/4-unblocked-app.png
echo "=== unblocked app ===" | tee -a shots/result.txt
adb shell dumpsys window | grep -E "mCurrentFocus" | tee -a shots/result.txt
adb logcat -d | grep -E "SXWatch|SXTest|START u0|BAL_" | cut -c1-220 | tail -80 > shots/log.txt || true
exit 0
