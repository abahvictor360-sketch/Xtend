# Xtend for Android and iOS

The apps are the live Xtend site (`https://xtend-brown.vercel.app`) inside a
native shell built with [Capacitor](https://capacitorjs.com). Every web
release reaches the apps at once; a new store build is needed only when
something in this folder changes.

What the apps add over the website:

| | Website | App |
|---|---|---|
| Location during a shift | Only while Xtend is open on screen | **Also with the screen off or another app open** (Android shows a small "Xtend · On shift" notification while this runs, which Android requires) |
| Notifications | Web push (not on iPhone unless added to the home screen) | **Native** push: Firebase on Android, Apple on iPhone |
| Camera, location, sign-in | Same | Same (the site's own screens) |

The site detects the app itself (`src/lib/native.ts`): nothing changes for
people using a browser.

## Building

GitHub builds both apps on every push that touches `mobile/`
(`.github/workflows/mobile.yml`, or run it by hand from the Actions tab):

- **Android**: a debug APK, downloadable from the run's *Artifacts*. It can
  be installed straight on a phone ("install unknown apps" must be allowed).
  With the signing secrets below it also builds a signed release APK and a
  Play Store bundle (`.aab`).
- **iOS**: compiled for the simulator, which proves it builds. An app on
  real iPhones needs the Apple steps below.

To work on it locally: `cd mobile && npm install && npx cap sync`, then
`npx cap open android` (Android Studio) or `npx cap open ios` (Xcode, on a
Mac).

## What the owner sets up once

### 1. Database

Run migrations `0030` to `0039` in the Supabase SQL editor, in order.
`0032` lets the apps' mock-GPS and rooted-phone flags be recorded; `0033`
lets a phone's app notifications count as "notifications on" for the
clock-in rule.

### 2. Android notifications: Firebase (free)

1. Go to <https://console.firebase.google.com>, create a project (e.g.
   "Xtend").
2. **Add app → Android**, package name `ng.xpelbeauty.xtend`. Download
   `google-services.json`.
3. In GitHub: repository **Settings → Secrets and variables → Actions → New
   repository secret**, name `GOOGLE_SERVICES_JSON`, value: the whole
   contents of that file.
4. In Firebase: **Project settings → Service accounts → Generate new private
   key**. In Vercel: project **Settings → Environment Variables**, name
   `FIREBASE_SERVICE_ACCOUNT`, value: the whole contents of that JSON file.
   Redeploy.

### 3. Android release signing

Make a signing key once and keep it safe: every update to the app must be
signed with the same key.

```bash
keytool -genkeypair -v -keystore xtend.keystore -alias xtend \
  -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 xtend.keystore   # copy the output
```

GitHub secrets: `ANDROID_KEYSTORE_BASE64` (that output),
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`xtend`),
`ANDROID_KEY_PASSWORD`.

Then share the signed APK with staff directly, or publish the `.aab` on
Google Play (a developer account costs US$25 once; an *internal testing*
or *closed testing* track keeps the app to your own staff). Google asks why
the app uses location in the background: it is shown to the person as a
notification for the length of their shift, to confirm they are at their
store.

### 4. iPhone

1. An **Apple Developer Program** membership (US$99 a year) is required to
   put any app on iPhones.
2. In <https://developer.apple.com/account>: **Certificates, IDs &
   Profiles → Keys → +**, tick **Apple Push Notifications service (APNs)**,
   download the `.p8` file, note its **Key ID** and your **Team ID**.
3. In Vercel, add `APNS_KEY` (the `.p8` file's contents), `APNS_KEY_ID`,
   `APNS_TEAM_ID`. (`APNS_BUNDLE_ID` defaults to `ng.xpelbeauty.xtend`; set
   `APNS_SANDBOX=true` only for builds run straight from Xcode.) Redeploy.
4. On a Mac with Xcode: `cd mobile && npm install && npx cap sync ios &&
   npx cap open ios`, choose your team under *Signing & Capabilities*, then
   **Product → Archive** and upload to **TestFlight**. Staff install
   TestFlight and the app from an invite; or publish it unlisted on the App
   Store. (This can be automated on GitHub's Macs once the account exists.)

Apple reviews background location closely; the permission text explains
it is used during a shift to confirm the person is at their store.

### 5. The download page

Staff install the apps from `https://xtend-brown.vercel.app/download`.

**Android works by itself.** Each time the production branch is built
(after a merge that touches `mobile/`, or **Actions → Mobile apps → Run
workflow**), the workflow publishes the APK as `xtend.apk` on this repo's
**android** release, and the download page links to it automatically. That
needs the repo to be public, which it is.

- Until the signing secrets (step 3) are set, the published APK is a
  *debug* build. Each debug build is signed with a different key, so a
  phone must uninstall the old app before installing a newer one. Set the
  signing secrets before handing the app to staff; from then on updates
  install over each other.

**iPhone** needs a link: in Vercel set `IOS_APP_URL` to the TestFlight
public invite link or the App Store link, and redeploy. Until then the
iPhone card shows "Coming soon" and points to the website.

Optional overrides in Vercel: `ANDROID_APK_URL` (e.g. a Google Play link
once the app is published there) and `APP_VERSION` (shown under the
buttons; otherwise the release's version is used).

## How it fits together

- `capacitor.config.ts`: app id `ng.xpelbeauty.xtend`, name, the site URL
  (override with `XTEND_URL` for a staging build).
- `www/index.html`: shown only when the site cannot be reached at all.
- `android/`, `ios/`: the native projects (permissions, notification icon,
  push hand-off in `AppDelegate.swift`, `App.entitlements`).
- Background location: `@capacitor-community/background-geolocation`,
  started by the site's heartbeat (`useHeartbeat`) while a shift is open
  and stopped at clock-out. A position is sent at most every 2.5 minutes,
  sooner after a 150 m move; without network it joins the offline queue
  with the time it was taken (migration 029). On Android the request goes
  through the native HTTP client so it is not throttled in the background.
- Location integrity: `LocationIntegrity` (`android/.../LocationIntegrity.java`,
  `ios/App/App/LocationIntegrity.swift`, registered in `MainActivity.java`
  and `XtendViewController.swift`). At clock-in `requireFix()` takes the
  fix from it, with Android's mock-location flag and a root / jailbreak
  check; the attendance route turns those into `mock_location_confirmed` /
  `device_integrity_failed` flags (032).
- Push: `@capacitor/push-notifications`. The site registers the phone's
  token at `/api/push/native`; `src/lib/push-native.ts` sends through
  Firebase (Android) or Apple (iOS). Phone checks are answered by
  `src/components/native-bridge.tsx`.
- Icons and splash: generated from `assets/` with
  `npx @capacitor/assets generate`.

## Limits

- If the person force-closes the app (swipes it away), location stops until
  they open it again; the Movement page shows that as a silence.
- A supervisor's phone check is answered when the notification arrives
  while the app is running, and always when it is opened.
