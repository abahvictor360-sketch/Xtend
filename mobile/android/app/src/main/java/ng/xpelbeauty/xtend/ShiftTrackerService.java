package ng.xpelbeauty.xtend;

import android.Manifest;
import android.app.AlarmManager;
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
import android.os.SystemClock;
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
 *
 * Follow live (migration 0070): while someone in the office follows this
 * person, the server's answer carries interval_ms (a few seconds). The
 * service then asks Android for positions that often and sends the latest
 * one with each request as "live" (shown to the follower, never stored as
 * a ping); the stored positions keep their usual pace. When an answer comes
 * without interval_ms, or none comes for a minute, it goes back to normal.
 * Nothing on the phone changes: the notification stays "On shift".
 *
 * Asleep (2026-11-25): a Handler timer does not run while the phone sleeps,
 * so a phone lying still on a desk could send nothing for an hour. Each
 * tick is now also an Android alarm allowed while idle, which wakes the
 * phone, restarts the service if the phone's maker stopped it, and, when
 * nothing new came in, asks for a fresh position instead of reusing an old
 * one. After clock-out the tracker only sends what it saved offline
 * ("draining"): it never collects new positions after the shift, and what it
 * saved is never thrown away.
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
    /** The alarm that wakes the tracker for its tick, even when the phone sleeps. */
    static final String ACTION_TICK = "ng.xpelbeauty.xtend.SHIFT_TICK";
    /** How long a fresh position may take before giving up until the next tick. */
    private static final long FRESH_FIX_MS = 40_000;

    private HandlerThread thread;
    private Handler handler;
    private final ExecutorService sender = Executors.newSingleThreadExecutor();
    private LocationManager locations;
    private PowerManager.WakeLock wakeLock;
    /** Held while a tick looks for a fresh position (separate from sending). */
    private PowerManager.WakeLock tickLock;
    private LocationListener freshListener = null;
    private long lastFailureAt = 0;
    private volatile boolean sending = false;
    /** Follow live: the latest position, and when one was last sent. */
    private volatile Location liveLoc = null;
    private volatile long lastLiveAt = 0;
    /** How often Android is asked for positions now (handler thread only). */
    private long appliedMinTime = -1;

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

    /** Collecting positions: a shift is on and it has not been stopped. */
    static boolean collecting(Context context) {
        return configured(context) && !prefs(context).getBoolean("draining", false);
    }

    /** Positions saved on the phone and not yet sent. */
    static int queued(Context context) {
        try {
            return new JSONArray(prefs(context).getString("queue", "[]")).length();
        } catch (Exception e) {
            return 0;
        }
    }

    /**
     * After the shift (clocked out, or the token ran out) with positions
     * still on the phone: send them, collect nothing new. The server accepts
     * them with the ended token (0096).
     */
    static boolean draining(Context context) {
        return !collecting(context) && prefs(context).getString("token", null) != null && queued(context) > 0;
    }

    /** Clock-out: stop collecting; keep running only to send what is waiting. */
    static void finish(Context context) {
        if (queued(context) > 0 && prefs(context).getString("token", null) != null) {
            prefs(context).edit().putBoolean("draining", true).remove("fast_ms").remove("fast_until").apply();
            try {
                start(context);
            } catch (Exception e) {
                // Android refused a start now: the next app start or alarm sends them.
            }
        } else {
            clear(context);
        }
    }

    /**
     * The next tick as an alarm allowed while idle: it fires with the phone
     * asleep (in deep sleep Android may hold it for up to about 10 minutes)
     * and restarts the service if it was stopped.
     */
    static void scheduleTick(Context context) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        try {
            am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + EVERY_MS, tickIntent(context));
        } catch (Exception ignored) {
            // No alarm: the service's own timer still runs while awake.
        }
    }

    static void cancelTick(Context context) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am != null) {
            try {
                am.cancel(tickIntent(context));
            } catch (Exception ignored) {}
        }
    }

    private static PendingIntent tickIntent(Context context) {
        Intent i = new Intent(context, ShiftTrackerService.class).setAction(ACTION_TICK);
        int flags = PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT;
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? PendingIntent.getForegroundService(context, 1, i, flags)
            : PendingIntent.getService(context, 1, i, flags);
    }

    static void start(Context context) {
        Intent intent = new Intent(context, ShiftTrackerService.class);
        ContextCompat.startForegroundService(context, intent);
    }

    /** Follow live: the fast interval while it holds, else 0. */
    static long fastMs(Context context) {
        SharedPreferences p = prefs(context);
        if (p.getLong("fast_until", 0) <= System.currentTimeMillis()) return 0;
        return p.getLong("fast_ms", 0);
    }

    /** Follow live: send every `ms` for the next minute (0: back to normal). */
    static void setFast(Context context, long ms) {
        if (ms >= 2_000 && ms <= 60_000) {
            prefs(context).edit().putLong("fast_ms", ms).putLong("fast_until", System.currentTimeMillis() + 60_000).apply();
        } else {
            prefs(context).edit().remove("fast_ms").remove("fast_until").apply();
        }
    }

    /** Forgets the token (positions not yet sent are kept until a new shift sends them). */
    static void clear(Context context) {
        prefs(context).edit().remove("token").remove("endpoint").remove("expires_at").remove("fast_ms").remove("fast_until").remove("draining").putBoolean("running", false).apply();
        cancelTick(context);
        context.stopService(new Intent(context, ShiftTrackerService.class));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!collecting(this) && !draining(this)) {
            prefs(this).edit().putBoolean("running", false).apply();
            cancelTick(this);
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
        boolean alarm = intent != null && ACTION_TICK.equals(intent.getAction());
        if (thread == null) {
            begin();
        } else if (handler != null) {
            // Started again while running: the follow-live instruction may
            // have changed (ShiftTracker.follow), or the alarm woke us.
            handler.post(this::applyMode);
            if (alarm) handler.post(this::tickOnce);
            else flush();
        }
        scheduleTick(this);
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

        if (pm != null) {
            tickLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "xtend:shift-tick");
            tickLock.setReferenceCounted(false);
        }

        if (collecting(this)
            && ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
            && ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            prefs(this).edit().putString("last_error", "no location permission").apply();
            stopSelf();
            return;
        }
        handler.post(this::applyMode);
        // Standing still indoors, GPS may say nothing for a long time: every
        // few minutes take the best recent reading Android has, and retry
        // sending whatever is waiting.
        handler.postDelayed(tick, EVERY_MS);
    }

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            if (tickOnce()) handler.postDelayed(this, EVERY_MS);
        }
    };

    /**
     * One tick: a position if none was saved for a while (a recent one
     * Android has, else a fresh one), then send what is waiting. False when
     * the tracker has stopped.
     */
    private boolean tickOnce() {
        if (!collecting(this)) {
            // After the shift: only send what was saved, then stop.
            if (draining(this)) {
                flush();
                return true;
            }
            cancelTick(this);
            stopSelf();
            return false;
        }
        long last = prefs(this).getLong("last_saved_at", 0);
        if (System.currentTimeMillis() - last >= EVERY_MS) {
            Location best = bestLastKnown();
            if (best != null && System.currentTimeMillis() - best.getTime() < 2 * 60_000) keep(best, true);
            else freshFix(best);
        }
        flush();
        applyMode();
        return true;
    }

    /**
     * Asks Android for a position now (network first, it answers indoors;
     * GPS too), keeping the phone awake for up to 40 seconds. If none comes,
     * a reading up to 10 minutes old is kept rather than nothing.
     */
    private void freshFix(Location fallback) {
        if (locations == null || thread == null || freshListener != null) return;
        if (tickLock != null) tickLock.acquire(FRESH_FIX_MS + 5_000);
        final LocationListener once = new LocationListener() {
            @Override
            public void onLocationChanged(@NonNull Location l) {
                endFresh(this);
                keep(l, true);
            }

            @Override
            public void onStatusChanged(String provider, int status, Bundle extras) {}

            @Override
            public void onProviderEnabled(@NonNull String provider) {}

            @Override
            public void onProviderDisabled(@NonNull String provider) {}
        };
        freshListener = once;
        try {
            for (String provider : new String[] { LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER }) {
                if (locations.isProviderEnabled(provider)) {
                    locations.requestLocationUpdates(provider, 0L, 0f, once, thread.getLooper());
                }
            }
        } catch (Exception e) {
            endFresh(once);
            return;
        }
        handler.postDelayed(() -> {
            if (freshListener == once) {
                endFresh(once);
                if (fallback != null && System.currentTimeMillis() - fallback.getTime() < 10 * 60_000) keep(fallback, true);
            }
        }, FRESH_FIX_MS);
    }

    private void endFresh(LocationListener once) {
        try {
            if (locations != null) locations.removeUpdates(once);
        } catch (Exception ignored) {}
        if (freshListener == once) freshListener = null;
        if (tickLock != null && tickLock.isHeld()) tickLock.release();
    }

    /**
     * Asks Android for positions every minute, or every few seconds while
     * someone follows live. Runs on the tracker's own thread.
     */
    private void applyMode() {
        if (locations == null || thread == null) return;
        if (!collecting(this)) {
            // After the shift: no new positions, only sending what is saved.
            try {
                locations.removeUpdates(this);
            } catch (Exception ignored) {}
            appliedMinTime = -1;
            handler.removeCallbacks(liveTick);
            return;
        }
        long fast = fastMs(this);
        long want = fast > 0 ? fast : 60_000;
        if (want != appliedMinTime) {
            try {
                locations.removeUpdates(this);
                for (String provider : new String[] { LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER }) {
                    if (locations.getAllProviders().contains(provider)) {
                        locations.requestLocationUpdates(provider, want, 0f, this, thread.getLooper());
                    }
                }
                appliedMinTime = want;
            } catch (SecurityException e) {
                stopSelf();
                return;
            }
        }
        handler.removeCallbacks(liveTick);
        if (fast > 0) handler.postDelayed(liveTick, fast);
    }

    /** While following live: send the latest position even if GPS is quiet. */
    private final Runnable liveTick = new Runnable() {
        @Override
        public void run() {
            long fast = fastMs(ShiftTrackerService.this);
            if (fast <= 0) {
                applyMode();
                return;
            }
            Location l = liveLoc;
            if (l == null || System.currentTimeMillis() - l.getTime() > 2 * fast) {
                Location best = bestLastKnown();
                if (best != null) liveLoc = best;
            }
            if (System.currentTimeMillis() - lastLiveAt >= fast - 500) flush();
            handler.postDelayed(this, fast);
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
        long fast = fastMs(this);
        if (fast > 0) liveLoc = location;
        keep(location, false);
        if (fast > 0 && System.currentTimeMillis() - lastLiveAt >= fast - 500) flush();
    }

    private static boolean isMock(Location l) {
        if (Build.VERSION.SDK_INT >= 31) return l.isMock();
        return l.isFromMockProvider();
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
        // Never after the shift (clocked out, or the token ran out).
        if (!collecting(this)) return;
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

        boolean mock = isMock(l);

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
            // Follow live: the latest position, shown to the follower only.
            Location live = liveLoc;
            long liveNow = System.currentTimeMillis();
            if (fastMs(this) > 0 && live != null && liveNow - live.getTime() < 60_000) {
                JSONObject lv = new JSONObject();
                lv.put("lat", live.getLatitude());
                lv.put("lng", live.getLongitude());
                lv.put("accuracy_m", live.hasAccuracy() ? live.getAccuracy() : 999);
                lv.put("captured_at", iso(Math.min(live.getTime(), liveNow)));
                lv.put("is_mock", isMock(live));
                if (live.hasBearing()) lv.put("heading", live.getBearing());
                if (live.hasSpeed()) lv.put("speed", live.getSpeed());
                body.put("live", lv);
                lastLiveAt = liveNow;
            }

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
                // The token is not known (a new phone, or the account was
                // deactivated). What was saved stays on the phone: the next
                // shift's token sends it. Nothing is thrown away.
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
            // Follow live: faster while the server asks, normal otherwise.
            long before = fastMs(this);
            setFast(this, answer.optLong("interval_ms", 0));
            if (fastMs(this) != before && handler != null) handler.post(this::applyMode);
            if (count == 500 && queued(this) > 0) {
                send();
            } else if (answer.optBoolean("stop", false) || (draining(this) && queued(this) == 0) || (!collecting(this) && queued(this) == 0)) {
                clear(this);
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
        if (handler != null) {
            handler.removeCallbacks(tick);
            handler.removeCallbacks(liveTick);
        }
        if (freshListener != null) endFresh(freshListener);
        if (tickLock != null && tickLock.isHeld()) tickLock.release();
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
