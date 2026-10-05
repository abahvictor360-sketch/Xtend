# Location integrity: detecting faked location and VPNs

Xtend records attendance from a GPS fix and a live selfie. This document covers
how it detects when someone tries to fake *where* they are, whether with a
VPN, a fake-GPS app, or a changed phone clock.

Nothing here blocks a clock-in. Every check writes a row to `integrity_flags`
for a supervisor to review on **Admin -> Integrity checks**. A flag is a reason
to look, not proof. Staff never see these.

## What each check catches

The checks come from two layers.

### Layer 1: the shape of the GPS fix (migration 022, in the database)

| Flag | What it means |
| --- | --- |
| `repeated_exact_location` | The same point, to ~0.1 m, as on another day. Real GPS always wobbles; a fake pin does not. |
| `perfect_accuracy` | Accuracy under 2 m, which phones do not reach indoors. |
| `impossible_journey` | Moved faster than ~150 km/h over more than 3 km between two readings. |

These are computed by a trigger from columns the database already holds, so
they need nothing from the network.

### Layer 2: VPN and manipulation (migration 030, in the attendance API route)

These need the request IP, the phone's time zone, and the GPS fix's extra
fields, none of which the database can see. They run in
`src/app/api/attendance/route.ts` after the clock-in is saved, and record what
they find through the `flag_own_integrity()` RPC.

| Flag | What it means |
| --- | --- |
| `vpn_suspected` | The clock-in arrived through a VPN, proxy, Tor, or datacentre IP. Hiding the real network is what someone does to fake location. **High.** |
| `ip_location_mismatch` | The GPS pin and the IP address are hundreds of km apart (>400 km, or >800 km on a mobile carrier IP). **High.** |
| `timezone_mismatch` | The phone's time zone is not Nigeria's (not `Africa/*`, or offset not UTC+1). **Medium.** |
| `gps_mock_fingerprint` | The GPS fix had no altitude, speed, or heading, the way a fake-location app feeds a bare coordinate. Weak on its own. **Medium.** |

A `vpn_suspected` or `ip_location_mismatch` also sends a push to the office
immediately, because those can land an on-site-looking pin from somewhere else.

## How the pieces fit

```
clock-panel.tsx ── GPS fix (lat/lng + altitude/speed/heading) + device_info (tz)
        │                    POST /api/attendance
        ▼
attendance_enforce (trigger) ── distance to outlet, on_site/off_site/flagged
attendance_integrity (trigger) ── layer-1 GPS-shape flags
        │
route handler ── clientIp() ─► lookupIp() ─► evaluateLocationIntegrity()
        │                                         │
        │                                   layer-2 signals
        ▼                                         ▼
  response to phone                     flag_own_integrity() -> integrity_flags
                                                  │
                                          Admin -> Integrity checks
```

Key files:

- `src/lib/ip-geo.ts` — reads the client IP and looks it up.
- `src/lib/integrity-signals.ts` — turns a fix + device info + IP into flags.
- `src/lib/integrity.ts` — the plain-language labels for every flag kind.
- `supabase/migrations/0030_vpn_location_integrity.sql` — the new kinds and the
  `flag_own_integrity()` RPC.

## IP geolocation provider

Default: **ip-api.com**, free and keyless. It returns a country, a lat/lng, and
the `proxy` / `hosting` / `mobile` flags that make the VPN check work. The free
endpoint is HTTP and rate-limited to 45 requests a minute, which is far above
Xtend's clock-in rate.

Configuration (all optional, set in the environment):

- `IP_GEO_URL` — point at another JSON endpoint using the same field names.
- `IP_GEO_DISABLED=1` — turn the IP lookup off entirely.

When deployed on Vercel, the platform's own `x-vercel-ip-*` headers are used as
a no-network fallback for country and coarse lat/lng (they carry no VPN flag,
so they only back up the primary lookup). To upgrade accuracy later, swap in a
keyed provider (IPinfo, ipgeolocation.io) with an explicit VPN flag by changing
`fromIpApi` in `src/lib/ip-geo.ts`.

## Deploying this

1. Run migration `0030_vpn_location_integrity.sql` against the Xtend Supabase
   project (Supabase -> SQL editor, or the CLI).
2. Deploy the app (push to `main`; Vercel auto-deploys).
3. No new environment variables are required for the default free provider.

Verify: clock in once through a VPN on a phone or desktop, then open
**Admin -> Integrity checks** and confirm a `vpn_suspected` flag appears.

## The honest limit, and the native plan

Xtend is a web app (PWA). The browser's Geolocation API does **not** expose
Android's `isMock` / "mock location" flag, so a web app cannot read the single
bit that proves a fix came from a fake-GPS app. The layer-2 checks catch that
situation *indirectly* (a VPN, an IP a long way off, a bare fix with no
altitude), which covers most real cheating, but a careful spoofer who also
spoofs their IP to a nearby Nigerian address and uses a fake-GPS app that fills
in altitude could still pass.

The Xtend apps for Android and iPhone (`mobile/`, see `mobile/README.md`)
close that gap. They load the same site and add a `LocationIntegrity` plugin
(`LocationIntegrity.java` on Android, `LocationIntegrity.swift` on iOS) that
`requireFix()` uses in place of the browser's location:

| Flag | Source |
| --- | --- |
| `mock_location_confirmed` | Android's own mock-location flag on the fix (`isMock`). Hard proof, high severity. |
| `device_integrity_failed` | Rooted (Android) or jailbroken (iPhone) phone. |

Both are raised by the attendance route and allowed by migration 032. People
still on the website are covered by the layer-2 checks above; the flags simply
do not apply to them until they install the app (`/download`). Play Integrity
and Apple App Attest can be added later as extra signals on the same plugin.
```
