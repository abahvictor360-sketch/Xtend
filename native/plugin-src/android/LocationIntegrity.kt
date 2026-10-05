// Copy this file into the generated Android project at:
//   android/app/src/main/java/com/xpelbeauty/xtend/LocationIntegrity.kt
// and register it in MainActivity (see MainActivity.kt in this folder).
//
// It returns a single location fix together with the two signals a browser
// cannot see: Android's hard mock-location flag, and whether the device is
// rooted. The web app calls it through window.Capacitor.Plugins.LocationIntegrity.

package com.xpelbeauty.xtend

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.io.File
import java.time.Instant

@CapacitorPlugin(
    name = "LocationIntegrity",
    permissions = [
        Permission(
            strings = [Manifest.permission.ACCESS_FINE_LOCATION],
            alias = "location",
        ),
    ],
)
class LocationIntegrity : Plugin() {

    @PluginMethod
    fun getFix(call: PluginCall) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissionForAlias("location", call, "permsCallback")
            return
        }
        requestSingleFix(call)
    }

    @PermissionCallback
    private fun permsCallback(call: PluginCall) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION)
            == PackageManager.PERMISSION_GRANTED
        ) {
            requestSingleFix(call)
        } else {
            call.reject("Location permission denied")
        }
    }

    private fun requestSingleFix(call: PluginCall) {
        val lm = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val provider = when {
            lm.isProviderEnabled(LocationManager.GPS_PROVIDER) -> LocationManager.GPS_PROVIDER
            lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER) -> LocationManager.NETWORK_PROVIDER
            else -> {
                call.reject("Location is turned off")
                return
            }
        }

        try {
            val listener = object : LocationListener {
                override fun onLocationChanged(location: Location) {
                    lm.removeUpdates(this)
                    resolve(call, location)
                }

                @Deprecated("Required on older APIs")
                override fun onStatusChanged(p: String?, s: Int, e: Bundle?) {}
                override fun onProviderEnabled(p: String) {}
                override fun onProviderDisabled(p: String) {}
            }
            // Ask for one fresh fix; fall back to last known after a short wait.
            lm.requestSingleUpdate(provider, listener, null)

            val last = lm.getLastKnownLocation(provider)
            if (last != null && System.currentTimeMillis() - last.time < 30_000) {
                lm.removeUpdates(listener)
                resolve(call, last)
            }
        } catch (e: SecurityException) {
            call.reject("Location permission denied")
        } catch (e: Exception) {
            call.reject("Could not read location: ${e.message}")
        }
    }

    private fun resolve(call: PluginCall, loc: Location) {
        val isMock =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) loc.isMock
            else @Suppress("DEPRECATION") loc.isFromMockProvider

        val ret = JSObject()
        ret.put("lat", loc.latitude)
        ret.put("lng", loc.longitude)
        ret.put("accuracy_m", loc.accuracy.toDouble())
        ret.put("altitude", if (loc.hasAltitude()) loc.altitude else null)
        ret.put("speed", if (loc.hasSpeed()) loc.speed.toDouble() else null)
        ret.put("heading", if (loc.hasBearing()) loc.bearing.toDouble() else null)
        ret.put("is_mock", isMock)
        ret.put("compromised", isRooted())
        ret.put("platform", "android")
        ret.put("captured_at", Instant.ofEpochMilli(loc.time).toString())
        call.resolve(ret)
    }

    private fun isRooted(): Boolean {
        val paths = arrayOf(
            "/system/app/Superuser.apk", "/sbin/su", "/system/bin/su", "/system/xbin/su",
            "/data/local/xbin/su", "/data/local/bin/su", "/system/sd/xbin/su",
            "/system/bin/failsafe/su", "/data/local/su", "/su/bin/su",
        )
        if (paths.any { File(it).exists() }) return true
        return try {
            val proc = Runtime.getRuntime().exec(arrayOf("which", "su"))
            proc.inputStream.bufferedReader().readLine() != null
        } catch (e: Exception) {
            false
        }
    }
}
