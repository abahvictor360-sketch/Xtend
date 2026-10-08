package ng.xpelbeauty.xtend;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Location for the length of a shift, with or without the app.
 *
 * A foreground service, so Android lets it run with the screen off, after
 * the app is swiped away, and (with "Allow all the time") after a restart:
 * the "Xtend · On shift" notification is Android's condition for that.
 * Positions are kept on the phone first and sent straight to the server
 * with the phone's tracking token, so nothing depends on the web page.
 * The server's answer says when the shift is over; the service then stops
 * by itself.
 */
public class ShiftTrackerService extends Service implements LocationListener {

    static final String PREFS = "xtend_shift_tracker";
    private static final String CHANNEL = "xtend_on_shift";
    private static final int NOTIFICATION_ID = 7301;

    /** A position at least this often while standing still… */
    private static final long EVERY_MS = 150_000;
    /** …and sooner after a move of this many metres. */
    private static final float MOVED_M = 100f;
    /** Readings rougher than this are only used when nothing better came. */
    private static final float ROUGH_M = 250f;
    /** Do not try the network more often than this after a failure. */
    private static final long RETRY_MS = 60_000;
    private static final int MAX_QUEUE = 2000;

    private HandlerThread thread;
    private Handler handler;
    private final ExecutorService sender = Executors.newSingleThreadExecutor();
    private LocationManager locations;
    private PowerManager.WakeLock wakeLock;
    private long lastFailureAt = 0;
    private volatile boolean sending = false;

    // ------------------------------------------------------------------
    // Starting and stopping, from the plugin, the boot receiver or Android.
    // ------------------------------------------------------------------

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean configured(Context context) {
        SharedPreferences p = prefs(context);
        return p.getString("token", null) != null && p.getLong("expires_at", 0) > System.currentTimeMillis();
    }

    static void start(Context context) {
        Intent intent = new Intent(context, ShiftTrackerService.class);
        ContextCompat.startForegroundService(context, intent);
    }

    /** Forgets the token (positions not yet sent are kept until a new shift sends them). */
    static void clear(Context context) {
        prefs(context).edit().remove("token").remove("endpoint").remove("expires_at").putBoolean("running", false).apply();
        context.stopService(new Intent(context, ShiftTrackerService.class));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!configured(this)) {
            prefs(this).edit().putBoolean("running", false).apply();
            stopSelf();
            return START_NOT_STICKY;
        }
        try {
            Notification n = notification();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            } else {
                startForeground(NOTIFICATION_ID, n);
            }
        } catch (Exception e) {
            // No location permission, or Android refused a start from the
            // background: nothing can be tracked, so do not pretend.
            prefs(this).edit().putBoolean("running", false).putString("last_error", "start: " + e.getMessage()).apply();
            stopSelf();
            return START_NOT_STICKY;
        }
        prefs(this).edit().putBoolean("running", true).apply();
        if (thread == null) begin();
        return START_STICKY;
    }

    private void begin() {
        thread = new HandlerThread("xtend-shift-tracker");
        thread.start();
        handler = new Handler(thread.getLooper());
        locations = (LocationManager) getSystemService(Context.LOCATION_SERVICE);

        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "xtend:shift");
            wakeLock.setReferenceCounted(false);
        }

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
            && ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            prefs(this).edit().putString("last_error", "no location permission").apply();
            stopSelf();
            return;
        }
        try {
            for (String provider : new String[] { LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER }) {
                if (locations.getAllProviders().contains(provider)) {
                    locations.requestLocationUpdates(provider, 60_000, 0f, this, thread.getLooper());
                }
            }
        } catch (SecurityException e) {
            stopSelf();
            return;
        }
        // Standing still indoors, GPS may say nothing for a long time: every
        // few minutes take the best recent reading Android has, and retry
        // sending whatever is waiting.
        handler.postDelayed(tick, EVERY_MS);
    }

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            if (!configured(ShiftTrackerService.this)) {
                stopSelf();
                return;
            }
            long last = prefs(ShiftTrackerService.this).getLong("last_saved_at", 0);
            if (System.currentTimeMillis() - last >= EVERY_MS) {
                Location best = bestLastKnown();
                if (best != null && System.currentTimeMillis() - best.getTime() < 10 * 60_000) keep(best, true);
            }
            flush();
            handler.postDelayed(this, EVERY_MS);
        }
    };

    private Location bestLastKnown() {
        Location best = null;
        try {
            for (String provider : locations.getProviders(true)) {
                Location l = locations.getLastKnownLocation(provider);
                if (l != null && (best == null || l.getTime() > best.getTime())) best = l;
            }
        } catch (SecurityException ignored) {}
        return best;
    }

    @Override
    public void onLocationChanged(@NonNull Location location) {
        keep(location, false);
    }

    // Older Android versions call these; nothing to do.
    @Override
    public void onStatusChanged(String provider, int status, Bundle extras) {}

    @Override
    public void onProviderEnabled(@NonNull String provider) {}

    @Override
    public void onProviderDisabled(@NonNull String provider) {}

    /** Keeps a position on the phone if it is due, then tries to send. */
    private synchronized void keep(Location l, boolean forced) {
        SharedPreferences p = prefs(this);
        long now = System.currentTimeMillis();
        long lastAt = p.getLong("last_saved_at", 0);
        double lastLat = Double.longBitsToDouble(p.getLong("last_lat", 0));
        double lastLng = Double.longBitsToDouble(p.getLong("last_lng", 0));
        float[] moved = new float[1];
        if (lastAt > 0) Location.distanceBetween(lastLat, lastLng, l.getLatitude(), l.getLongitude(), moved);
        boolean due = forced || lastAt == 0 || now - lastAt >= EVERY_MS || moved[0] >= MOVED_M;
        if (!due) return;
        if (l.getAccuracy() > ROUGH_M && now - lastAt < 2 * EVERY_MS && !forced) return;

        boolean mock;
        if (Build.VERSION.SDK_INT >= 31) mock = l.isMock();
        else mock = l.isFromMockProvider();

        try {
            JSONObject point = new JSONObject();
            point.put("lat", l.getLatitude());
            point.put("lng", l.getLongitude());
            point.put("accuracy_m", l.hasAccuracy() ? l.getAccuracy() : 999);
            point.put("captured_at", iso(Math.min(l.getTime(), now)));
            point.put("is_mock", mock);
            JSONArray queue = new JSONArray(p.getString("queue", "[]"));
            queue.put(point);
            while (queue.length() > MAX_QUEUE) queue.remove(0);
            p.edit()
                .putString("queue", queue.toString())
                .putLong("last_saved_at", now)
                .putLong("last_lat", Double.doubleToRawLongBits(l.getLatitude()))
                .putLong("last_lng", Double.doubleToRawLongBits(l.getLongitude()))
                .apply();
        } catch (Exception e) {
            return;
        }
        flush();
    }

    /** Sends what is waiting, on its own thread. */
    private void flush() {
        if (sending) return;
        if (System.currentTimeMillis() - lastFailureAt < RETRY_MS) return;
        sending = true;
        sender.execute(() -> {
            if (wakeLock != null) wakeLock.acquire(60_000);
            try {
                send();
            } finally {
                sending = false;
                if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
            }
        });
    }

    private void send() {
        SharedPreferences p = prefs(this);
        String token = p.getString("token", null);
        String endpoint = p.getString("endpoint", null);
        if (token == null || endpoint == null) return;
        JSONArray queue;
        try {
            queue = new JSONArray(p.getString("queue", "[]"));
        } catch (Exception e) {
            queue = new JSONArray();
        }
        int count = Math.min(queue.length(), 500);
        HttpURLConnection c = null;
        try {
            JSONArray batch = new JSONArray();
            for (int i = 0; i < count; i++) batch.put(queue.get(i));
            JSONObject body = new JSONObject();
            body.put("sent_at", iso(System.currentTimeMillis()));
            body.put("points", batch);

            c = (HttpURLConnection) new URL(endpoint).openConnection();
            c.setRequestMethod("POST");
            c.setConnectTimeout(20_000);
            c.setReadTimeout(30_000);
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            c.setRequestProperty("Authorization", "Bearer " + token);
            try (OutputStream out = c.getOutputStream()) {
                out.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
            int status = c.getResponseCode();
            if (status == 401) {
                // The token has ended (clocked out, a new phone, expired).
                p.edit().putString("queue", "[]").apply();
                clear(this);
                return;
            }
            if (status < 200 || status >= 300) {
                lastFailureAt = System.currentTimeMillis();
                p.edit().putString("last_error", "server " + status).apply();
                return;
            }
            StringBuilder text = new StringBuilder();
            try (BufferedReader in = new BufferedReader(new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = in.readLine()) != null) text.append(line);
            }
            JSONObject answer = new JSONObject(text.length() > 0 ? text.toString() : "{}");

            // Drop what was sent; anything kept meanwhile stays.
            synchronized (this) {
                JSONArray now = new JSONArray(p.getString("queue", "[]"));
                JSONArray rest = new JSONArray();
                for (int i = count; i < now.length(); i++) rest.put(now.get(i));
                p.edit()
                    .putString("queue", rest.toString())
                    .putLong("last_sent_at", System.currentTimeMillis())
                    .remove("last_error")
                    .apply();
            }
            lastFailureAt = 0;
            if (answer.optBoolean("stop", false)) {
                clear(this);
            } else if (count == 500) {
                send();
            }
        } catch (Exception e) {
            // No network: everything stays on the phone for the next try.
            lastFailureAt = System.currentTimeMillis();
            p.edit().putString("last_error", "network").apply();
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static String iso(long ms) {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(new Date(ms));
    }

    private Notification notification() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm != null && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "On shift", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Shown while Xtend records your location during a shift");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        SharedPreferences p = prefs(this);
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_xtend)
            .setColor(ContextCompat.getColor(this, R.color.xtend_orange))
            .setContentTitle(p.getString("title", "Xtend"))
            .setContentText(p.getString("text", "On shift"))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setContentIntent(tap)
            .build();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Swiped away from recent apps: the shift is not over. The service
        // keeps running (stopWithTask is false in the manifest); send what
        // is waiting now in case the phone maker's software ends it anyway.
        flush();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        if (handler != null) handler.removeCallbacks(tick);
        if (locations != null) {
            try {
                locations.removeUpdates(this);
            } catch (Exception ignored) {}
        }
        if (thread != null) thread.quitSafely();
        sender.shutdown();
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        prefs(this).edit().putBoolean("running", false).apply();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
