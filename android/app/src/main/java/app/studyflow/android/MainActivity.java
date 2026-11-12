package app.studyflow.android;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ProgressBar;

/** StudyStarx website inside a WebView, plus a JavaScript bridge (window.SFNative) for native features. */
public class MainActivity extends Activity {
    static final String SITE = "https://study-flow-app-ecru.vercel.app";
    private static final int FILE_REQ = 41;
    private WebView web;
    private ProgressBar bar;
    private ValueCallback<Uri[]> fileCb;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Lock.channels(this);
        FrameLayout root = new FrameLayout(this);
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        root.addView(bar, new FrameLayout.LayoutParams(-1, (int) (4 * getResources().getDisplayMetrics().density)));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setGeolocationEnabled(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        if (Build.VERSION.SDK_INT >= 26) s.setSafeBrowsingEnabled(true);
        WebView.setWebContentsDebuggingEnabled(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setCacheMode(isOnline() ? WebSettings.LOAD_DEFAULT : WebSettings.LOAD_CACHE_ELSE_NETWORK);
        s.setUserAgentString(s.getUserAgentString() + " StudyFlowAndroid/1.0");
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
        web.addJavascriptInterface(new Bridge(), "SFNative");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                String host = u.getHost() == null ? "" : u.getHost();
                String scheme = u.getScheme() == null ? "" : u.getScheme();
                boolean ours = isOurHost(host);
                boolean payment = host.equals("razorpay.com") || host.endsWith(".razorpay.com") || host.equals("accounts.google.com");
                if (scheme.equals("https") && (ours || payment)) {
                    if (u.getPath() != null && u.getPath().endsWith(".apk")) { openOutside(u); return true; }
                    return false;
                }
                openOutside(u);
                return true;
            }
            @Override public void onPageStarted(WebView v, String url, Bitmap f) { bar.setVisibility(View.VISIBLE); curUrl = url; }
            @Override public void doUpdateVisitedHistory(WebView v, String url, boolean reload) { curUrl = url; }
            @Override public void onPageFinished(WebView v, String url) { bar.setVisibility(View.GONE); CookieManager.getInstance().flush(); tryAuth(); }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView v, int p) { bar.setProgress(p); }
            @Override
            public void onPermissionRequest(final PermissionRequest req) {
                runOnUiThread(() -> {
                    Uri o = req.getOrigin();
                    if (o == null || !"https".equals(o.getScheme()) || !isOurHost(o.getHost() == null ? "" : o.getHost())) { req.deny(); return; }
                    java.util.List<String> want = new java.util.ArrayList<>();
                    for (String r : req.getResources()) {
                        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r) || PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) want.add(r);
                    }
                    if (want.isEmpty()) { req.deny(); return; }
                    java.util.List<String> need = new java.util.ArrayList<>();
                    if (want.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE) && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) need.add(Manifest.permission.CAMERA);
                    if (want.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE) && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) need.add(Manifest.permission.RECORD_AUDIO);
                    if (need.isEmpty()) { req.grant(want.toArray(new String[0])); return; }
                    pendingMedia = req; pendingWant = want.toArray(new String[0]);
                    requestPermissions(need.toArray(new String[0]), 8);
                });
            }
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                try {
                    startActivityForResult(params.createIntent(), FILE_REQ);
                } catch (ActivityNotFoundException e) {
                    fileCb = null;
                    return false;
                }
                return true;
            }
        });
        web.setDownloadListener((url, ua, cd, mime, len) -> openOutside(Uri.parse(url)));

        // Notification permission is asked inside the StudyStarx setup survey, with an explanation.

        if (b != null) web.restoreState(b);
        else web.loadUrl(startUrl(getIntent()));
        takeAuth(getIntent());
    }

    // ---- Google sign-in: Google does not allow its sign-in inside app web views, so it happens in the phone's browser.
    // The website then opens studystarx://auth?code=... and we pass that one-time code to the page, which swaps it for a session.
    private String pendingAuth = null;
    private int authTries = 0;
    private boolean takeAuth(Intent i) {
        Uri d = i == null ? null : i.getData();
        if (d == null || !"studystarx".equals(d.getScheme()) || !"auth".equals(d.getHost())) return false;
        String c = d.getQueryParameter("code");
        if (c == null || !c.matches("[a-f0-9]{16,64}")) return true;
        pendingAuth = c; authTries = 0; tryAuth();
        return true;
    }
    private void tryAuth() {
        if (pendingAuth == null || web == null) return;
        final String c = pendingAuth;
        web.evaluateJavascript("(window.sfAppAuth?(sfAppAuth('" + c + "'),'ok'):'no')", v -> {
            if (v != null && v.contains("ok")) { if (c.equals(pendingAuth)) pendingAuth = null; }
            else if (authTries++ < 30) web.postDelayed(this::tryAuth, 700);
        });
    }

    private String startUrl(Intent i) {
        Uri d = i == null ? null : i.getData();
        if (d != null && d.toString().startsWith(SITE)) return d.toString();
        return SITE + "/?app=android";
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        if (takeAuth(i)) return;
        if (i != null && i.getData() != null) web.loadUrl(startUrl(i));
    }

    private boolean isOnline() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        if (cm == null) return true;
        NetworkInfo n = cm.getActiveNetworkInfo();
        return n != null && n.isConnected();
    }

    private void openOutside(Uri u) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) {}
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req == FILE_REQ && fileCb != null) {
            fileCb.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data));
            fileCb = null;
        }
    }

    @Override protected void onSaveInstanceState(Bundle o) { super.onSaveInstanceState(o); web.saveState(o); }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override protected void onResume() { super.onResume(); web.onResume(); }
    @Override protected void onPause() { web.onPause(); super.onPause(); }

    /** Methods the website can call as window.SFNative.*  */
    volatile String curUrl = "";
    PermissionRequest pendingMedia; String[] pendingWant;
    static boolean isOurHost(String h) { return h.equals("study-flow-app-ecru.vercel.app"); }
    /** The JavaScript bridge only works while our own website is open (never on payment or other pages). */
    boolean trusted() {
        try { Uri u = Uri.parse(curUrl); return "https".equals(u.getScheme()) && isOurHost(u.getHost() == null ? "" : u.getHost()); } catch (Exception e) { return false; }
    }
    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        super.onRequestPermissionsResult(code, perms, res);
        if (code == 8 && pendingMedia != null) {
            boolean ok = true; for (int r : res) if (r != PackageManager.PERMISSION_GRANTED) ok = false;
            if (ok) pendingMedia.grant(pendingWant); else pendingMedia.deny();
            pendingMedia = null; pendingWant = null;
        }
    }
    class Bridge {
        @JavascriptInterface public boolean isApp() { return true; }
        @JavascriptInterface public boolean canGoogle() { return true; }
        @JavascriptInterface public void googleSignIn() { runOnUiThread(() -> openOutside(Uri.parse(SITE + "/?appgoogle=1"))); }
        @JavascriptInterface public boolean blockerReady() { return Lock.serviceEnabled(MainActivity.this); }
        @JavascriptInterface public int blockedCount() { return Lock.blocked(MainActivity.this).size(); }
        @JavascriptInterface public void openBlocker() {
            if (!trusted()) return;
            runOnUiThread(() -> startActivity(new Intent(MainActivity.this, BlockerActivity.class)));
        }
        @JavascriptInterface public void startBlock(int minutes) {
            if (!trusted()) return;
            Lock.start(MainActivity.this, minutes);
            StudyWidget.refreshAll(MainActivity.this);
        }
        @JavascriptInterface public void stopBlock() {
            if (!trusted()) return;
            Lock.stop(MainActivity.this);
            StudyWidget.refreshAll(MainActivity.this);
        }
        @JavascriptInterface public void startBlockNames(int minutes, String json, boolean strict) {
            if (!trusted()) return;
            Lock.startNames(MainActivity.this, minutes, json, strict);
            StudyWidget.refreshAll(MainActivity.this);
        }
        @JavascriptInterface public void stopBlockNames(String json) {
            if (!trusted()) return;
            Lock.stopNames(MainActivity.this, json);
            StudyWidget.refreshAll(MainActivity.this);
        }
        @JavascriptInterface public boolean notifyOn() {
            if (!trusted()) return false;
            if (Build.VERSION.SDK_INT >= 33) return checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
            return true;
        }
        @JavascriptInterface public void askNotify() {
            if (!trusted()) return;
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    if (shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS) || !Lock.p(MainActivity.this).getBoolean("asked_notif", false)) {
                        Lock.p(MainActivity.this).edit().putBoolean("asked_notif", true).apply();
                        requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 7);
                    } else {
                        try { startActivity(new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, getPackageName())); } catch (Exception ignored) {}
                    }
                }
            });
        }
        @JavascriptInterface public void openAccessibility() {
            if (!trusted()) return;
            runOnUiThread(() -> {
                try { startActivity(new Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS)); }
                catch (Exception e) { startActivity(new Intent(MainActivity.this, BlockerActivity.class)); }
            });
        }
        @JavascriptInterface public boolean lockStrict() { return Lock.strict(MainActivity.this); }
        @JavascriptInterface public boolean guardOn() {
            if (!trusted()) return false;
            try {
                android.app.admin.DevicePolicyManager dpm = (android.app.admin.DevicePolicyManager) getSystemService(DEVICE_POLICY_SERVICE);
                return dpm != null && dpm.isAdminActive(new android.content.ComponentName(MainActivity.this, Guard.class));
            } catch (Exception e) { return false; }
        }
        @JavascriptInterface public void askGuard() {
            if (!trusted()) return;
            runOnUiThread(() -> {
                try {
                    Intent i = new Intent(android.app.admin.DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN)
                            .putExtra(android.app.admin.DevicePolicyManager.EXTRA_DEVICE_ADMIN, new android.content.ComponentName(MainActivity.this, Guard.class))
                            .putExtra(android.app.admin.DevicePolicyManager.EXTRA_ADD_EXPLANATION, "Stops StudyStarx being deleted while a focus lock is running. You can switch it off in Settings after your lock.");
                    startActivity(i);
                } catch (Exception ignored) {}
            });
        }
        @JavascriptInterface public void removeGuard() {
            if (!trusted()) return;
            if (Lock.active(MainActivity.this)) return;
            try {
                android.app.admin.DevicePolicyManager dpm = (android.app.admin.DevicePolicyManager) getSystemService(DEVICE_POLICY_SERVICE);
                if (dpm != null) dpm.removeActiveAdmin(new android.content.ComponentName(MainActivity.this, Guard.class));
            } catch (Exception ignored) {}
        }
        @JavascriptInterface public void notify(String title, String body) {
            if (!trusted()) return;
            Lock.nudge(MainActivity.this, title == null ? "StudyStarx" : title, body == null ? "" : body);
        }
        @JavascriptInterface public void scheduleReminders(String json) {
            if (!trusted()) return; Reminders.schedule(MainActivity.this, json); }
        @JavascriptInterface public void updateWidget(int mins, String status) {
            if (!trusted()) return;
            String today = new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(new java.util.Date());
            Lock.p(MainActivity.this).edit().putInt("w_mins", Math.max(0, mins)).putString("w_status", status == null ? "idle" : status).putString("w_day", today).apply();
            StudyWidget.refreshAll(MainActivity.this);
        }
        /** Saves a file the website made (e.g. an exam paper PDF) to Downloads and opens it. */
        @JavascriptInterface public String saveFile(String name, String mime, String b64) {
            if (!trusted()) return "no";
            try {
                byte[] bytes = android.util.Base64.decode(b64, android.util.Base64.DEFAULT);
                String n = String.valueOf(name).replaceAll("[^A-Za-z0-9._\\- ]", "_");
                if (n.length() > 120) n = n.substring(n.length() - 120);
                if (mime == null || !mime.matches("^(application/pdf|text/plain|text/csv)$")) mime = "application/pdf";
                // a private copy any PDF app can open
                java.io.File f = new java.io.File(FilesProvider.dir(MainActivity.this), n);
                try (java.io.FileOutputStream o = new java.io.FileOutputStream(f)) { o.write(bytes); }
                Uri view = Uri.parse("content://" + FilesProvider.AUTH + "/" + Uri.encode(n));
                boolean saved = false;
                if (Build.VERSION.SDK_INT >= 29) {
                    try {
                        android.content.ContentValues v = new android.content.ContentValues();
                        v.put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, n);
                        v.put(android.provider.MediaStore.MediaColumns.MIME_TYPE, mime);
                        v.put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, android.os.Environment.DIRECTORY_DOWNLOADS + "/StudyStarx");
                        Uri d = getContentResolver().insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                        if (d != null) { try (java.io.OutputStream o = getContentResolver().openOutputStream(d)) { o.write(bytes); saved = true; } }
                    } catch (Exception ignored) {}
                }
                final String m = mime;
                runOnUiThread(() -> {
                    Intent i = new Intent(Intent.ACTION_VIEW);
                    i.setDataAndType(view, m);
                    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                    try { startActivity(i); } catch (Exception e) {
                        Intent sh = new Intent(Intent.ACTION_SEND); sh.setType(m); sh.putExtra(Intent.EXTRA_STREAM, view); sh.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        try { startActivity(Intent.createChooser(sh, "Save or share")); } catch (Exception ignored) {}
                    }
                });
                return saved ? "ok" : "open";
            } catch (Exception e) { return "err"; }
        }
        @JavascriptInterface public void keepAwake(boolean on) {
            if (!trusted()) return;
            runOnUiThread(() -> {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }
    }
}
