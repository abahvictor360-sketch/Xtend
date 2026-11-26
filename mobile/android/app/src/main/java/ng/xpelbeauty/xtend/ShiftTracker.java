package ng.xpelbeauty.xtend;

import android.Manifest;
import android.content.ComponentName;
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
            .putBoolean("draining", false)
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

    /**
     * Clock-out. Nothing new is collected from now on; positions saved with
     * no signal are still sent (the tracker keeps running only for that),
     * then it stops by itself.
     */
    @PluginMethod
    public void stop(PluginCall call) {
        ShiftTrackerService.finish(getContext());
        call.resolve(state());
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(state());
    }

    /**
     * Follow live (0070): send quick positions now rather than at the next
     * answer from the server. The server's answers keep it going and end
     * it. ok is false when no shift is being tracked.
     */
    @PluginMethod
    public void follow(PluginCall call) {
        Context context = getContext();
        Integer ms = call.getInt("intervalMs");
        JSObject o = new JSObject();
        if (ms == null || ms < 2000 || ms > 60000 || !ShiftTrackerService.configured(context)) {
            o.put("ok", false);
            call.resolve(o);
            return;
        }
        ShiftTrackerService.setFast(context, ms);
        try {
            ShiftTrackerService.start(context);
        } catch (Exception e) {
            o.put("ok", false);
            call.resolve(o);
            return;
        }
        o.put("ok", true);
        call.resolve(o);
    }

    /**
     * A store check-in or check-out just happened (2026-11-26): the tracker
     * asks the server now which visit is open, for "Check out before you
     * leave". closed: the visit was checked out, so any alarm stops at once.
     */
    @PluginMethod
    public void visitChanged(PluginCall call) {
        Context context = getContext();
        if (Boolean.TRUE.equals(call.getBoolean("closed", false))) ShiftTrackerService.setVisit(context, null);
        JSObject o = new JSObject();
        if (ShiftTrackerService.collecting(context)) {
            try {
                ShiftTrackerService.start(context);
            } catch (Exception ignored) {}
        }
        o.put("ok", true);
        call.resolve(o);
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
        Context context = getContext();
        // Best first: the system's own pop-up for this app ("Allow ... to always
        // run in the background"), which phones that hide the settings list
        // (Tecno, Infinix, itel) still show. Then the list, then this app's page.
        Intent[] tries = new Intent[] {
            new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + context.getPackageName())),
            new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS),
            new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + context.getPackageName())),
        };
        for (Intent i : tries) {
            try {
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(i);
                break;
            } catch (Exception e) {
                // Not on this phone: try the next screen.
            }
        }
        call.resolve(state());
    }

    /**
     * TECNO, Infinix and itel (Transsion) phones stop apps their own way,
     * whatever Android's battery setting says: Xtend must be allowed to
     * Auto-start in Phone Master. Opens that screen, else Phone Master,
     * else this app's settings page.
     */
    @PluginMethod
    public void openAutoStart(PluginCall call) {
        Context context = getContext();
        String[][] screens = new String[][] {
            { "com.transsion.phonemaster", "com.cyin.himgr.autostart.AutoStartActivity" },
            { "com.transsion.phonemaster", "com.cyin.himgr.applicationmanager.view.activities.AutoStartActivity" },
            { "com.transsion.phonemaster", "com.cyin.himgr.widget.activity.MainSettingGpActivity" },
        };
        boolean opened = false;
        for (String[] s : screens) {
            try {
                Intent i = new Intent().setComponent(new ComponentName(s[0], s[1]));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(i);
                opened = true;
                break;
            } catch (Exception e) {
                // Not this phone's screen: try the next.
            }
        }
        if (!opened) {
            try {
                Intent i = context.getPackageManager().getLaunchIntentForPackage("com.transsion.phonemaster");
                if (i != null) {
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(i);
                    opened = true;
                }
            } catch (Exception ignored) {}
        }
        if (!opened) {
            try {
                Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + context.getPackageName()));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(i);
            } catch (Exception ignored) {}
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
        o.put("active", ShiftTrackerService.collecting(context));
        // This build stops collecting at clock-out and still sends what was saved.
        o.put("drains", true);
        // The phone's maker: TECNO, Infinix and itel need extra steps (Auto-start, locked in recent apps).
        o.put("maker", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase(java.util.Locale.ROOT));
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
