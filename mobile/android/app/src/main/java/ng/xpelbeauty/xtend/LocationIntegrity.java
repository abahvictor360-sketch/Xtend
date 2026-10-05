package ng.xpelbeauty.xtend;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONObject;

/**
 * One location fix together with the two signals a browser cannot see:
 * Android's own mock-location flag, and whether the phone is rooted. Used
 * by the clock-in screen (src/lib/native.ts getNativeFix).
 */
@CapacitorPlugin(
    name = "LocationIntegrity",
    permissions = { @Permission(strings = { Manifest.permission.ACCESS_FINE_LOCATION }, alias = "location") }
)
public class LocationIntegrity extends Plugin {

    private static final long FRESH_MS = 30_000;
    private static final long TIMEOUT_MS = 25_000;

    @PluginMethod
    public void getFix(PluginCall call) {
        if (!hasFine()) {
            requestPermissionForAlias("location", call, "permsCallback");
            return;
        }
        requestSingleFix(call);
    }

    @PermissionCallback
    private void permsCallback(PluginCall call) {
        if (hasFine()) requestSingleFix(call);
        else call.reject("Location permission denied");
    }

    private boolean hasFine() {
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION)
            == PackageManager.PERMISSION_GRANTED;
    }

    @SuppressWarnings({ "MissingPermission", "deprecation" })
    private void requestSingleFix(PluginCall call) {
        LocationManager lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        String provider;
        if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) provider = LocationManager.GPS_PROVIDER;
        else if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) provider = LocationManager.NETWORK_PROVIDER;
        else {
            call.reject("Location is turned off");
            return;
        }

        try {
            Location last = lm.getLastKnownLocation(provider);
            if (last != null && System.currentTimeMillis() - last.getTime() < FRESH_MS) {
                resolve(call, last);
                return;
            }

            AtomicBoolean done = new AtomicBoolean(false);
            Handler main = new Handler(Looper.getMainLooper());
            LocationListener listener = new LocationListener() {
                @Override
                public void onLocationChanged(@NonNull Location location) {
                    lm.removeUpdates(this);
                    if (done.compareAndSet(false, true)) resolve(call, location);
                }

                @Override
                public void onStatusChanged(String p, int s, Bundle e) {}

                @Override
                public void onProviderEnabled(@NonNull String p) {}

                @Override
                public void onProviderDisabled(@NonNull String p) {}
            };
            lm.requestSingleUpdate(provider, listener, Looper.getMainLooper());
            main.postDelayed(
                () -> {
                    lm.removeUpdates(listener);
                    if (done.compareAndSet(false, true)) call.reject("No location fix in time");
                },
                TIMEOUT_MS
            );
        } catch (SecurityException e) {
            call.reject("Location permission denied");
        } catch (Exception e) {
            call.reject("Could not read location: " + e.getMessage());
        }
    }

    @SuppressWarnings("deprecation")
    private void resolve(PluginCall call, Location loc) {
        boolean isMock = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? loc.isMock() : loc.isFromMockProvider();

        SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        iso.setTimeZone(TimeZone.getTimeZone("UTC"));

        // Through JSONObject.put, which declares JSONException for doubles.
        try {
            JSObject ret = new JSObject();
            ret.put("lat", loc.getLatitude());
            ret.put("lng", loc.getLongitude());
            ret.put("accuracy_m", (double) loc.getAccuracy());
            ret.put("altitude", loc.hasAltitude() ? (Object) loc.getAltitude() : JSONObject.NULL);
            ret.put("speed", loc.hasSpeed() ? (Object) (double) loc.getSpeed() : JSONObject.NULL);
            ret.put("heading", loc.hasBearing() ? (Object) (double) loc.getBearing() : JSONObject.NULL);
            ret.put("is_mock", isMock);
            ret.put("compromised", isRooted());
            ret.put("platform", "android");
            ret.put("captured_at", iso.format(new Date(loc.getTime())));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not read location: " + e.getMessage());
        }
    }

    private static boolean isRooted() {
        String[] paths = {
            "/system/app/Superuser.apk", "/sbin/su", "/system/bin/su", "/system/xbin/su",
            "/data/local/xbin/su", "/data/local/bin/su", "/system/sd/xbin/su",
            "/system/bin/failsafe/su", "/data/local/su", "/su/bin/su",
        };
        for (String p : paths) if (new File(p).exists()) return true;
        try {
            Process proc = Runtime.getRuntime().exec(new String[] { "which", "su" });
            return new java.io.BufferedReader(new java.io.InputStreamReader(proc.getInputStream())).readLine() != null;
        } catch (Exception e) {
            return false;
        }
    }
}
