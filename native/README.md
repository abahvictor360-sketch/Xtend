# Xtend native apps (Android + iOS)

These are **thin Capacitor shells**. They load the live Xtend web app
(`https://xtend-brown.vercel.app`) inside a native WebView and add one thing a
browser cannot give: the `LocationIntegrity` plugin, which reports Android's
hard **mock-location flag** and whether the device is **rooted / jailbroken**.

Because the content is loaded from `server.url` and not bundled, **a Vercel
deploy updates both apps instantly** — no new store submission to change the
UI or logic. You only rebuild and resubmit the native apps when you change the
native shell itself (this folder).

The web app already knows how to use the plugin: `src/lib/native.ts` detects
the shell, `requireFix()` takes the fix (with the mock flag) from the plugin,
and the attendance route raises `mock_location_confirmed` /
`device_integrity_failed` (migration 032). In a plain mobile browser nothing
changes — those paths are simply inert.

```
Field phone ─ installs the native app
      │  loads https://xtend-brown.vercel.app in a native WebView
      ▼
  web app detects window.Capacitor ─► LocationIntegrity.getFix()
      │                                     │ lat/lng, accuracy, altitude…
      │                                     │ is_mock (Android), compromised
      ▼                                     ▼
  POST /api/attendance ── device_info.native ──► mock_location_confirmed /
                                                  device_integrity_failed
                                                  (Admin → Integrity checks)
```

---

## Prerequisites (one-time)

| For | You need |
| --- | --- |
| Android | **Android Studio** (any OS, Windows is fine), JDK 17, a Google **Play Console** account ($25 one-time) to publish. |
| iOS | **A Mac** with **Xcode**, and an **Apple Developer Program** membership ($99/year). iOS cannot be built or submitted from Windows. |
| Both | Node.js 18+ (already installed for the web app). |

The Android app can be built entirely on this Windows machine. The iOS app
must be built on a Mac; everything in this folder is cross-platform, so copy
the repo to a Mac for the iOS steps.

---

## First build

From this `native/` folder:

```bash
npm install
```

### Android

```bash
npm run add:android          # generates android/
```

Then wire in the plugin and permissions:

1. Copy `plugin-src/android/LocationIntegrity.kt` to
   `android/app/src/main/java/com/xpelbeauty/xtend/LocationIntegrity.kt`.
2. Replace `android/app/src/main/java/com/xpelbeauty/xtend/MainActivity.kt`
   with `plugin-src/android/MainActivity.kt` (it registers the plugin).
3. In `android/app/src/main/AndroidManifest.xml`, inside `<manifest>`, add:
   ```xml
   <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
   <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
   ```
   (`INTERNET` is already there.)

```bash
npm run sync
npm run open:android         # opens Android Studio
```

In Android Studio: **Run** on a device to test, or **Build → Generate Signed
Bundle / APK → Android App Bundle** to produce the `.aab` for Play.

### iOS (on a Mac)

```bash
npm run add:ios              # generates ios/
```

1. Open `ios/App/App.xcworkspace` in Xcode (`npm run open:ios`).
2. Drag `plugin-src/ios/LocationIntegrity.swift` and
   `plugin-src/ios/LocationIntegrity.m` into the **App** group (check "Copy
   items if needed", target: App). When prompted about a bridging header for
   the `.m`, accept it.
3. Select the **App** target → **Info** → add:
   - `Privacy - Location When In Use Usage Description` =
     "Xtend records where you clock in, to confirm you are at your store."
4. Set your Team under **Signing & Capabilities**.

```bash
npm run sync
```

Build and run on a device from Xcode. To ship: **Product → Archive →
Distribute App → App Store Connect**.

---

## Testing the integrity signal

1. Install the Android app on a test phone.
2. Enable Developer options → **Select mock location app**, pick any fake-GPS
   app, and set a pin away from your store.
3. Clock in through the Xtend app.
4. In **Admin → Integrity checks**, a **Fake GPS confirmed**
   (`mock_location_confirmed`) flag should appear for that person.

On iOS, the equivalent is a jailbroken test device raising **Rooted /
jailbroken phone** (`device_integrity_failed`). A normal iPhone cannot fake
GPS, so there is nothing else to trigger there.

---

## Rollout

1. Deploy the web app with the native hooks (push to `main`) and apply
   migrations 030–032 to Supabase. Without migration 032 the two native flag
   kinds are rejected by the database.
2. Build and publish the Android app to Play (internal testing track first).
3. Build and publish the iOS app from a Mac to TestFlight, then the App Store.
4. Send field staff the store links. Anyone who has not installed the native
   app keeps using the web app (PWA) as before; the native checks simply do
   not apply to them until they switch.

## Notes

- **Offline** still works: the live site's service worker and offline clock-in
  queue run inside the WebView just as in the browser.
- **Bundle id / app name** live in `capacitor.config.ts` (`appId`, `appName`).
  If you change `appId`, also change the Kotlin `package` and the folder path.
- **Stronger device checks** (Play Integrity on Android, DeviceCheck /
  App Attest on iOS) can be added later as extra methods on the plugin; the
  server already treats `device_info.native.compromised` as a high-severity
  flag, so new signals slot into the same place.
