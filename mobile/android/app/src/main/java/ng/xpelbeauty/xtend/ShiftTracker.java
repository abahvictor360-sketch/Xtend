package ng.xpelbeauty.xtend;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;

/**
 * The web page's handle on ShiftTrackerService (src/lib/native.ts):
 * start it at clock-in with the phone's tracking token, stop it at
 * clock-out, and see how it is doing.
 */
@CapacitorPlugin(name = "ShiftTracker")
public class ShiftTracker extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        String token = call.getString("token");
        String endpoint = call.getString("endpoint");
        Double expires = call.getDouble("expiresAt");
        if (token == null || endpoint == null || expires == null || !endpoint.startsWith("https://")) {
            call.reject("token, an https endpoint and expiresAt are needed");
            return;
        }
        if (!hasLocation()) {
            call.reject("Location permission is needed");
            return;
        }
        Context context = getContext();
        ShiftTrackerService.prefs(context)
            .edit()
            .putString("token", token)
            .putString("endpoint", endpoint)
            .putLong("expires_at", expires.longValue())
            .putString("title", call.getString("title", "Xtend"))
            .putString("text", call.getString("text", "On shift"))
            .apply();
        try {
            ShiftTrackerService.start(context);
        } catch (Exception e) {
            call.reject("Could not start: " + e.getMessage());
            return;
        }
        call.resolve(state());
    }

    @PluginMethod
    public void stop(PluginCall call) {
        ShiftTrackerService.clear(getContext());
        call.resolve(state());
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(state());
    }

    /** "Allow all the time", so tracking also comes back after a restart. */
    @PluginMethod
    public void requestBackground(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && !hasBackground() && getActivity() != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                // Android 11+ only offers it on the app's settings page.
                Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
            } else {
                ActivityCompat.requestPermissions(getActivity(), new String[] { Manifest.permission.ACCESS_BACKGROUND_LOCATION }, 7302);
            }
        }
        call.resolve(state());
    }

    /** The phone's battery saver is the usual reason a shift goes quiet. */
    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        } catch (Exception e) {
            Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        }
        call.resolve(state());
    }

    private boolean hasLocation() {
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasBackground() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return hasLocation();
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private JSObject state() {
        Context context = getContext();
        SharedPreferences p = ShiftTrackerService.prefs(context);
        JSObject o = new JSObject();
        o.put("platform", "android");
        o.put("active", ShiftTrackerService.configured(context));
        o.put("running", p.getBoolean("running", false));
        o.put("location", hasLocation());
        o.put("always", hasBackground());
        PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        o.put("batteryUnrestricted", pm != null && pm.isIgnoringBatteryOptimizations(context.getPackageName()));
        int queued = 0;
        try {
            queued = new JSONArray(p.getString("queue", "[]")).length();
        } catch (Exception ignored) {}
        o.put("queued", queued);
        long sent = p.getLong("last_sent_at", 0);
        if (sent > 0) o.put("lastSentAt", sent);
        o.put("lastError", p.getString("last_error", null));
        return o;
    }
}
