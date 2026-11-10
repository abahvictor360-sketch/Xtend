package ng.xpelbeauty.xtend;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.WebView;
import android.widget.Toast;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * Files the site hands the phone: exports, the login sheet, the stock count
 * template, report documents, message attachments. A WebView ignores
 * downloads unless told what to do with them, so tapping one did nothing in
 * the app. Links are handed to Android's download manager with the
 * person's session cookie; files the page makes itself (a blob) come through
 * window.XtendFiles.save. Both land in Downloads, with a notification.
 */
final class XtendDownloads {
    /** Largest file the page may hand over in one piece. */
    private static final int MAX_BYTES = 25 * 1024 * 1024;

    private XtendDownloads() {}

    static void attach(Activity activity, WebView web) {
        web.addJavascriptInterface(new Bridge(activity), "XtendFiles");
        web.setDownloadListener((url, userAgent, contentDisposition, mimeType, length) -> {
            // Blobs are saved by the page through XtendFiles; nothing to fetch.
            if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) return;
            try {
                String name = safeName(URLUtil.guessFileName(url, contentDisposition, mimeType));
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                String cookie = CookieManager.getInstance().getCookie(url);
                if (cookie != null) request.addRequestHeader("Cookie", cookie);
                if (userAgent != null) request.addRequestHeader("User-Agent", userAgent);
                request.setTitle(name);
                if (mimeType != null && !mimeType.isEmpty()) request.setMimeType(mimeType);
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
                } else {
                    // Before Android 10 the public folder needs a storage
                    // permission; the app's own Downloads folder does not.
                    request.setDestinationInExternalFilesDir(activity, Environment.DIRECTORY_DOWNLOADS, name);
                }
                DownloadManager manager = (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
                manager.enqueue(request);
                toast(activity, "Downloading " + name + "…");
            } catch (Exception e) {
                toast(activity, "That file could not be downloaded. Try again.");
            }
        });
    }

    /** A file name with no folders in it, never empty. */
    static String safeName(String name) {
        String clean = name == null ? "" : name.replaceAll("[\\\\/:*?\"<>|\\x00-\\x1f]", "_").trim();
        if (clean.isEmpty() || clean.startsWith(".")) clean = "xtend-file" + clean;
        return clean.length() > 120 ? clean.substring(clean.length() - 120) : clean;
    }

    private static void toast(Activity activity, String text) {
        activity.runOnUiThread(() -> Toast.makeText(activity, text, Toast.LENGTH_SHORT).show());
    }

    /** window.XtendFiles: saves a file the page built itself. */
    static final class Bridge {
        private final Activity activity;

        Bridge(Activity activity) {
            this.activity = activity;
        }

        @JavascriptInterface
        public boolean save(String base64, String name, String mimeType) {
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                if (bytes.length == 0 || bytes.length > MAX_BYTES) return false;
                String file = safeName(name);
                String type = mimeType == null || mimeType.isEmpty() ? "application/octet-stream" : mimeType;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, file);
                    values.put(MediaStore.Downloads.MIME_TYPE, type);
                    ContentResolver resolver = activity.getContentResolver();
                    Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri == null) return false;
                    try (OutputStream out = resolver.openOutputStream(uri)) {
                        if (out == null) return false;
                        out.write(bytes);
                    }
                } else {
                    File dir = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                    if (dir == null) return false;
                    try (FileOutputStream out = new FileOutputStream(new File(dir, file))) {
                        out.write(bytes);
                    }
                }
                toast(activity, "Saved " + file + " in Downloads");
                return true;
            } catch (Exception e) {
                toast(activity, "That file could not be saved. Try again.");
                return false;
            }
        }
    }
}
