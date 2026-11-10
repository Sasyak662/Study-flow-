StudyFlow Android app
=====================
This folder is the Android app. You don't need Android Studio: GitHub builds it for you.

1. Upload this whole "android" folder to your GitHub repo (same place as index.html).
2. Make sure the file .github/workflows/android.yml is in the repo too.
3. Open your repo on GitHub → "Actions" tab. "Build Android app" runs by itself (about 5 minutes).
4. When it shows a green tick, it adds StudyFlow.apk to your repo, Vercel redeploys,
   and the "Download Android app" button on the Focus Lock page starts working:
   https://study-flow-app-ecru.vercel.app/StudyFlow.apk

On the phone:
- Open that link, download, tap the file and allow "Install unknown apps" for your browser.
- In the app: Focus Lock → "Choose apps to block" → tick apps → "Switch on the blocker"
  → Accessibility → StudyFlow Focus Lock → On.
- Android 13+: if it says "Restricted setting", open App info for StudyFlow,
  tap ⋮ → "Allow restricted settings", then switch it on again.
- Long-press the home screen → Widgets → StudyFlow to add the "Today" widget.

The file app/studyflow.keystore signs the app so updates install over the old version.
Keep it — if it changes, people must uninstall the old app before installing a new one.
