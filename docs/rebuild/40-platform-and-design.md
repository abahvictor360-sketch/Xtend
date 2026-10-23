# 40 — Platform, integrations, offline, native apps, design system, exports

This file covers everything outside the database and the individual pages: the
project skeleton and its configuration, the Supabase clients and auth helpers,
every outside service Xtend calls, the offline outbox and service worker, the
Android and iOS shells, the design system, and the export renderer.

Every value below was read from the source file named beside it. Where a value
is already listed in another rebuild document, this file points there instead
of repeating it:

| Topic | Where it lives |
|---|---|
| Every API route, method, body and response | `docs/rebuild/generated/routes.md` |
| Every page and what it renders | `docs/rebuild/generated/pages.md` |
| Every module and its exports | `docs/rebuild/generated/modules.md` |
| Constants (limits, intervals, thresholds) | `docs/rebuild/generated/constants.md` |
| Tables, functions, policies | `docs/rebuild/generated/database.md`, `schema.sql`, `platform.sql` |
| Environment variable list, cron jobs, setup from zero | `docs/BUILD_GUIDE.md` sections 4, 7, 8, 9 |

---

## 1. Project skeleton

### 1.1 Root layout

```
.env.example            .eslintrc.json        .vercelignore (contains: mobile/)
next.config.ts          postcss.config.mjs    tailwind.config.ts
tsconfig.json           tsconfig.scripts.json vercel.json
package.json            package-lock.json     next-env.d.ts
src/app/                App Router pages and route handlers
src/components/         ui/, field/, admin/, admin/xm/, metrics/, brand/, plus shared top-level components
src/lib/                server and client modules (supabase/, offline/, export/, metrics/ subfolders)
src/middleware.ts       must sit in src/, beside app/ (Next ignores a root middleware when app is under src)
public/                 manifest.webmanifest, sw.js, icons/, brand/, guide/ (screenshots)
scripts/                tsx scripts, scripts/shims/server-only.ts
supabase/               migrations and SQL tests
mobile/                 Capacitor 8 project (excluded from tsconfig and from Vercel uploads)
.github/workflows/mobile.yml
```

### 1.2 `package.json` (exact)

Name `xtend`, version `1.0.0`, `private: true`, description "Field attendance and reporting for Xpel Beauty".

Scripts:

| Script | Command |
|---|---|
| `dev` | `next dev` |
| `build` | `next build` |
| `start` | `next start` |
| `lint` | `next lint` |
| `typecheck` | `tsc --noEmit` |
| `bootstrap:admin` | `tsx scripts/create-admin.ts` |

Dependencies (caret ranges exactly as written):

| Package | Version | Used for |
|---|---|---|
| `@anthropic-ai/sdk` | ^0.128.0 | Ask Xtend, support helper, photo checks, invoice reading |
| `@supabase/ssr` | ^0.5.2 | Cookie-based server/browser clients, middleware |
| `@supabase/supabase-js` | ^2.47.10 | Admin (service-role) client, types |
| `@types/qrcode` | ^1.5.6 | (types, listed under dependencies) |
| `class-variance-authority` | ^0.7.1 | UI kit variants |
| `clsx` | ^2.1.1 | `cn()` |
| `docx` | ^9.0.3 | Word exports |
| `exceljs` | ^4.4.0 | Excel exports and reading uploaded .xlsx |
| `idb` | ^8.0.0 | IndexedDB outbox |
| `jszip` | ^3.10.2 | Reading `.docx` text for supply import |
| `lucide-react` | ^0.462.0 | Every icon |
| `next` | ^15.5.25 | Framework |
| `papaparse` | ^5.4.1 | CSV parsing (imports) |
| `pdf-lib` | ^1.17.1 | PDF exports |
| `qrcode` | ^1.5.4 | QR on `/download` |
| `react`, `react-dom` | ^19.0.0 | |
| `tailwind-merge` | ^2.5.5 | `cn()` |
| `tailwindcss-animate` | ^1.0.7 | Tailwind plugin |
| `web-push` | ^3.6.7 | Web Push with VAPID |
| `zod` | ^3.24.1 | Every request body |

Dev dependencies: `@types/node` ^22.10.2, `@types/papaparse` ^5.3.15,
`@types/react` ^19.0.2, `@types/react-dom` ^19.0.2, `@types/web-push` ^3.6.4,
`autoprefixer` ^10.4.20, `eslint` ^8.57.1, `eslint-config-next` ^15.5.25,
`postcss` ^8.4.49, `tailwindcss` ^3.4.17, `tsx` ^4.19.2, `typescript` ^5.7.2.

No test framework, no UI component library (shadcn-style components are hand
written in `src/components/ui`), no chart library (charts are hand-drawn SVG/CSS),
no fonts package.

### 1.3 `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022", "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true, "skipLibCheck": true, "strict": true, "noEmit": true,
    "esModuleInterop": true, "module": "esnext", "moduleResolution": "bundler",
    "resolveJsonModule": true, "isolatedModules": true, "jsx": "preserve",
    "incremental": true, "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", "mobile"]
}
```

All imports inside `src` use `@/…` (for example `@/lib/auth`, `@/components/ui/button`).

### 1.4 `tsconfig.scripts.json` and the `server-only` shim

Used to run the check scripts in `scripts/` under plain Node with `tsx`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "commonjs", "moduleResolution": "node",
    "paths": { "@/*": ["./src/*"], "server-only": ["./scripts/shims/server-only.ts"] }
  },
  "include": ["scripts/**/*.ts", "src/**/*.ts"]
}
```

`scripts/shims/server-only.ts` is just `export {}` with a comment: Next.js
resolves `server-only` itself, the stub lets the same modules load in Node.
Every server module begins with `import 'server-only'` (auth helpers excepted:
`src/lib/auth.ts` imports `next/navigation` and is server-only by usage).

### 1.5 `next.config.ts`

```ts
const BUILD_ID =
  process.env.VERCEL_DEPLOYMENT_ID ||
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ||
  process.env.XTEND_BUILD_ID ||
  `local-${Date.now().toString(36)}`

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  generateBuildId: async () => BUILD_ID.replace(/[^a-zA-Z0-9_-]/g, '-'),
  serverExternalPackages: ['exceljs'],
  experimental: { staleTimes: { dynamic: 15, static: 180 } },
  async headers() {
    return [{
      source: '/sw.js',
      headers: [
        { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        { key: 'Service-Worker-Allowed', value: '/' },
      ],
    }]
  },
}
```

- The build id is baked into both server and client. `/api/version` returns it;
  `UpdateManager` compares it with its own (section 4.6).
- `staleTimes.dynamic = 15` seconds keeps a visited dynamic route in the client
  router cache so switching the phone's tabs does not refetch; realtime refresh
  and `router.refresh()` still bust it. `static = 180` seconds.
- `exceljs` is kept out of the server bundle (loaded with `await import('exceljs')`).

### 1.6 `postcss.config.mjs` and `.eslintrc.json`

```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } }
```

```json
{ "extends": ["next/core-web-vitals"], "rules": { "@next/next/no-img-element": "off" } }
```

Plain `<img>` is used everywhere (signed Supabase URLs, avatars); `next/image` is not used.

### 1.7 `tailwind.config.ts` (exact)

```ts
export default {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    container: { center: true, padding: '1rem', screens: { '2xl': '1400px' } },
    extend: {
      colors: {
        border: 'hsl(var(--border))', input: 'hsl(var(--input))', ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))', canvas: 'hsl(var(--canvas))',
        foreground: 'hsl(var(--foreground))',
        brand: { DEFAULT: 'hsl(var(--brand))', deep: 'hsl(var(--brand-deep))', ink: 'hsl(var(--brand-ink))' },
        gold: 'hsl(var(--gold))',
        tint: { DEFAULT: 'hsl(var(--tint))', foreground: 'hsl(var(--tint-foreground))' },
        primary:     { DEFAULT: 'hsl(var(--primary))',     foreground: 'hsl(var(--primary-foreground))' },
        secondary:   { DEFAULT: 'hsl(var(--secondary))',   foreground: 'hsl(var(--secondary-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        muted:       { DEFAULT: 'hsl(var(--muted))',       foreground: 'hsl(var(--muted-foreground))' },
        accent:      { DEFAULT: 'hsl(var(--accent))',      foreground: 'hsl(var(--accent-foreground))' },
        card:        { DEFAULT: 'hsl(var(--card))',        foreground: 'hsl(var(--card-foreground))' },
        success:     { DEFAULT: 'hsl(var(--success))',     foreground: 'hsl(var(--success-foreground))' },
        warning:     { DEFAULT: 'hsl(var(--warning))',     foreground: 'hsl(var(--warning-foreground))' },
      },
      borderRadius: {
        lg: 'var(--radius)',               // 1.25rem = 20px
        md: 'calc(var(--radius) - 6px)',   // 14px
        sm: 'calc(var(--radius) - 10px)',  // 10px
        '4xl': '2rem',
      },
      boxShadow: {
        soft: '0 10px 30px -18px rgb(24 18 14 / 0.35)',
        lift: '0 18px 40px -20px rgb(193 87 42 / 0.5)',
      },
      keyframes: { 'fade-up': { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'translateY(0)' } } },
      animation: { 'fade-up': 'fade-up 0.25s ease-out both' },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config
```

Tailwind's default `rounded-xl` (0.75rem), `rounded-2xl` (1rem), `rounded-3xl`
(1.5rem) and `rounded-full` are used heavily alongside these.

### 1.8 Middleware (`src/middleware.ts`)

- `PUBLIC_PATHS = ['/login', '/deactivated', '/offline', '/download', '/guide']`
  (a path is public if it equals one or starts with `<p>/`).
- Builds a `createServerClient` from `@supabase/ssr` with the anon key, whose
  `setAll` writes cookies onto both the request and a fresh `NextResponse.next({ request })`.
- Calls `supabase.auth.getUser()` (this refreshes the session cookie on every navigation).
- `/api/*` paths: return the response untouched. Route handlers answer 401 in
  JSON themselves (the outbox and login form depend on JSON, not a redirect).
- No user and not public: redirect to `/login?next=<path>`.
- Signed in and on `/login`: redirect to `/` with the query cleared.
- Role enforcement is not here; it is in Postgres (RLS) and in `requireSession`.

Matcher:

```ts
matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/|brand/|api/cron).*)']
```

### 1.9 `vercel.json` (and the VPS)

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["dub1"],
  "crons": [
    { "path": "/api/cron/purge-selfies", "schedule": "20 2 * * *" },
    { "path": "/api/cron/absence-sweep", "schedule": "30 8 * * *" }
  ]
}
```

Production runs on a Hostinger VPS instead (`deploy/`, verbatim in the
repository; steps in `deploy/README.md`):

- **PM2:** cluster, `instances: 'max'`, `next start -p 3000 -H 127.0.0.1`,
  restart at 1500 MB.
- **Nginx:** proxies to it with `X-Forwarded-For` (so `TRUSTED_PROXY_HOPS=1`),
  allows 25 MB uploads, and serves `/_next/static` with a one-year
  immutable cache. It has no per-address rate limit, because mobile
  networks share addresses.
- **Crontab:** runs the three jobs through `deploy/cron.sh` against
  `127.0.0.1:3000`.
- **Deploys:** `deploy/deploy.sh` builds each commit in `releases/<sha12>`
  with `XTEND_BUILD_ID=<sha12>`, links `shared/.env.production`, switches
  `current` atomically, `pm2 startOrReload`s, and rolls back unless
  `/api/version` returns `"build":"<sha12>"` within a minute. It keeps 5
  releases.
- **GitHub workflow:** `.github/workflows/deploy-vps.yml` runs it over SSH on
  each push to the main branch, skipping when `VPS_HOST` is unset.
- **Repository variables:** `APP_URL` sets `XTEND_URL` for the phone builds
  and the release notes. `JOBS_ON_VPS=true` turns the GitHub alerts workflow
  off.

The every-5-minute `alerts` cron is **not** in `vercel.json`: the Vercel Hobby plan rejects
sub-daily crons (deploys fail with `cron_jobs_limits_reached`), so it runs from
`.github/workflows/alerts-cron.yml` instead (a GitHub Actions schedule that
curls `/api/cron/alerts` with `CRON_SECRET`). On Vercel Pro, or a VPS crontab,
schedule it the normal way and drop the workflow. That job also sends the
clock-out reminders (migration 0061), so it must run every 5 minutes for
them to arrive on time.

The absence sweep runs **every day**, Sundays included (it was `1-6` before
migration 0059): `staff_no_show()` now skips anyone on a day off or on
approved leave, so each person's schedule, not the weekday, decides who is
chased.

`regions` pins the serverless functions to Dublin (`dub1`), the same AWS
region as the Supabase project (`eu-west-1`); each page makes several serial
DB round-trips, so co-locating functions with the database is what keeps
pages fast. Match this to wherever the Supabase project lives.

Schedules are UTC (Lagos is UTC+1 all year: 03:20, 09:30 daily, every 5 min).
What each job does is in BUILD_GUIDE section 8.

### 1.10 `.env.example`

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
CRON_SECRET=generate-a-long-random-string
GOOGLE_MAPS_API_KEY=
GEOCODER_USER_AGENT=Xtend/1.0 (ops@xpelbeauty.example)
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:ops@xpelbeauty.ng
ANTHROPIC_API_KEY=
TRUSTED_PROXY_HOPS=1
IP_API_KEY=
```

Each variable has a comment block in the file (copy them: they explain the
Google APIs to enable, the `web-push` key generator command
`node -e "console.log(require('web-push').generateVAPIDKeys())"`, and the proxy hop count).

Variables read by code but not in `.env.example` (all optional): `IP_GEO_URL`,
`IP_GEO_DISABLED`, `FIREBASE_SERVICE_ACCOUNT`, `APNS_KEY`, `APNS_KEY_ID`,
`APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_SANDBOX`, `CREDENTIALS_WEBHOOK_URL`,
`CREDENTIALS_WEBHOOK_TOKEN`, `APP_RELEASE_REPO`, `ANDROID_APK_URL`,
`ANDROID_LATEST_BUILD`, `IOS_APP_URL`, `IOS_LATEST_BUILD`, `APP_VERSION`,
`XTEND_BUILD_ID`, and Vercel's own `VERCEL_DEPLOYMENT_ID` / `VERCEL_GIT_COMMIT_SHA`.
`XTEND_URL` is read only by `mobile/capacitor.config.ts`. The full table with
meanings is BUILD_GUIDE section 7.

### 1.11 Root layout (`src/app/layout.tsx`)

- `metadata`: title `Xtend — Xpel Beauty field attendance`, applicationName `Xtend`,
  description `Clock in, clock out and report from the field.`, manifest
  `/manifest.webmanifest`, `appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Xtend' }`,
  extra meta `apple-mobile-web-app-capable: yes`, icons 64 and 192 PNG, apple icon `/icons/apple-touch-icon.png`.
- `viewport`: `width: 'device-width'`, `initialScale: 1`, `viewportFit: 'cover'`,
  `themeColor: '#d1531b'`. Deliberately no `maximumScale` (pinch zoom stays; WCAG 1.4.4).
- `<html lang="en"><body className="min-h-dvh">{children}<ServiceWorker /><UpdateManager /></body>`.
- No web fonts are loaded (system font stack, section 6.2).

---

## 2. Supabase clients, sessions and request plumbing

### 2.1 Server client (`src/lib/supabase/server.ts`)

`createServerSupabase` is wrapped in React `cache()` (one per request render).
It uses the anon key and the request cookies, so RLS applies to every query.

- Before creating the client it calls `auditContextHeader()` (`src/lib/audit-context.ts`).
  If that returns a value, the client is created with
  `global: { headers: { 'x-xt-audit': <base64 JSON> } }`. The database trigger
  `audit_fill_context` reads it from `request.headers` so audit rows written
  inside SQL functions carry where/what device (migration 0049).
- The header JSON is `AuditContext`: `{ ip, user_agent (≤500 chars), device: { type: 'phone'|'tablet'|'computer', os, browser, app }, lat?, lng?, accuracy_m?, location_source?: 'browser'|'ip', country?, vpn? }`.
  Location comes from the `xt_loc` cookie (`"lat,lng,accuracy,epochMs"`, accepted
  only if |lat|≤90, |lng|≤180, 0≤accuracy≤5000, not older than 2 h and not more
  than 5 min in the future), else from a cached IP lookup with `accuracy_m: 25000`.
  The header variant never performs a new IP lookup; `auditContext()` (used by
  `audit()`) does, with a 6 h cache of up to 500 IPs.
- `setAll` swallows the error thrown when called from a Server Component (the
  middleware refreshes cookies instead).

### 2.2 Browser client (`src/lib/supabase/client.ts`)

`createBrowserClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } })`.
`supabase()` returns a singleton per tab (repeated clients leak realtime sockets).
Used for Storage uploads from the outbox and for realtime channels: the
member's private broadcast topic `field:<uid>` in `use-dashboard-refresh.ts`
and `support-chat.tsx`, and `postgres_changes` in the admin `live-alert-feed.tsx`
(see §3.8).

### 2.3 Admin client (`src/lib/supabase/admin.ts`)

`createClient(url, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })`.
Throws `SUPABASE_SERVICE_ROLE_KEY is not configured` if unset. Bypasses RLS: only
constructed after the caller has been verified (admin routes, photo checks,
support helper, cron jobs, sign-in lookup).

### 2.4 Auth helpers (`src/lib/auth.ts`)

| Export | Behaviour |
|---|---|
| `Session` | `{ userId, email, profile: Profile, relogin: 'new-day' \| 'clocked-out' \| null }` |
| `getSession` | `cache()`d. `auth.getUser()`, then `profiles.select('*').eq('id', user.id)`. Null if either missing. Computes `relogin`. |
| relogin rule | Only for roles `merchandiser`, `marketer` (`DAILY_LOGIN_ROLES`). `'new-day'` if `last_sign_in_at` is before today's Lagos midnight (`${today}T00:00:00+01:00`). `'clocked-out'` if a `closing` attendance row for today has `created_at` after the sign-in. |
| `requireSession(roles?)` | Page guard; redirects in this order: no session → `/login`; `!is_active` → `/deactivated`; relogin → `/api/auth/expired?reason=<reason>`; `must_change_password` → `/change-password`; wrong role → `/`. |
| `ApiError(message, status, code?)` | Error class thrown by route helpers. |
| `requireApiSession(roles?)` | Route guard; throws `ApiError`: 401 `Not authenticated`; 403 `Account deactivated`; 401 code `relogin` with `You have clocked out for today. Log in again to continue.` or `Please log in again for today.`; 403 `Not permitted`. |
| `apiError(e)` | `ApiError` → JSON `{ error, code? }` with its status. Anything else → logged, 500 `{ error: 'Something went wrong. Try again.' }`. |
| `dbErrorMessage(error, fallback='That could not be saved. Try again.')` | Passes the message through only for SQLSTATE `P0001` (raised on purpose in SQL); otherwise logs and returns the fallback. |
| `dbErrorResponse(error, fallback?)` | If `error.hint === 'place_naming_due'` → 423 `{ error, code: 'name_place' }`; else 400 `{ error: dbErrorMessage(...) }`. |
| `FIELD_ROLES` | `['merchandiser', 'marketer', 'admin']` (use the phone app, clock in, are tracked) |
| `REPORTING_ROLES` | `['marketer', 'admin']` (file the daily report) |
| `landingPathFor(role)` | merchandiser/marketer → `/field`; everyone else → `/admin` |

Every route handler follows: `try { const session = await requireApiSession([...]); zod parse; …; } catch (e) { return apiError(e) }`.

### 2.5 Rate limiting (`src/lib/rate-limit.ts`)

In-process fixed-window counter (`Map<key, { count, resetAt }>`). `allowAttempt(key, limit, windowMs)`
returns false once `count > limit`. When the map exceeds 10 000 keys, expired
entries are swept. `clientAddress(request)` = `requestIp(headers) ?? 'unknown'`.

Only caller: `POST /api/auth/sign-in`, window `15 * 60 * 1000` ms:

| Key | Limit |
|---|---|
| `sign-in:ip:<address>` | 30 |
| `sign-in:id:<identifier lowercased>` | 10 |

Over the limit → 429 `{ error: 'Too many attempts. Wait 15 minutes, then try again.' }`.
Every wrong credential answers 400 `Those details are not correct.` (the phone→email
lookup happens on the server so emails never leak).

### 2.6 Client IP (`src/lib/client-ip.ts`, `src/lib/ip-geo.ts`)

`requestIp(headers)`: `hops = max(1, floor(Number(TRUSTED_PROXY_HOPS ?? 1)) || 1)`.
Split `x-forwarded-for` on commas, trim, drop empties; return `chain[max(0, chain.length - hops)]`
(read from the end, so a client-written prefix is ignored). Without the header,
`x-real-ip` trimmed, else null.

`clientIp(headers)` (ip-geo) returns null for private ranges:
`10.`, `127.`, `192.168.`, `172.16–31.`, `169.254.`, `::1`, `fc../fd..`, `fe80:`.

### 2.7 Cron authorisation (`src/lib/cron.ts`)

`cronAuthorized(request)`: false if `CRON_SECRET` unset. Otherwise SHA-256 of the
`authorization` header and of `` `Bearer ${secret}` `` compared with
`timingSafeEqual` (hashing equalises lengths). Cron routes are excluded from the
middleware matcher.

---

## 3. Outside services

### 3.1 Anthropic (Claude)

All calls use `@anthropic-ai/sdk` with `ANTHROPIC_API_KEY` from the environment
(`new Anthropic()` reads it). Each feature has a `…Configured()` function that is
simply `Boolean(process.env.ANTHROPIC_API_KEY)`; without a key each feature has
the fallback listed.

| Feature | File | Model | Endpoint | Client options | Params |
|---|---|---|---|---|---|
| Ask Xtend (admin/supervisor chat) | `src/lib/assistant.ts` | `claude-opus-5` | `client.beta.messages.create` | defaults | `max_tokens: 16000`, `betas: ['server-side-fallback-2026-07-01']`, `fallbacks: 'default'`, `output_config: { effort: 'medium' }`, `tools` (all `strict: true`), system prompt cached |
| Support helper (staff support threads) | `src/lib/support-assistant.ts` | `claude-opus-5` | `client.messages.create` (non-beta) | defaults | `max_tokens: 1024`, forced tool `tool_choice: { type: 'tool', name: 'respond' }`, no caching |
| Photo check | `src/lib/photo-check.ts` | `claude-opus-5` | `client.beta.messages.create` | `{ timeout: 45_000, maxRetries: 1 }` | `max_tokens: 2000`, same beta + `fallbacks: 'default'`, `output_config: { effort: 'low', format: { type: 'json_schema', schema } }`, system prompt cached |
| Supply invoice reading (X Metrics) | `src/lib/metrics/supply-import.ts` | `claude-opus-5-5` | `client.beta.messages.create` | `{ timeout: 120_000, maxRetries: 1 }` | `max_tokens: 16000`, same beta + `fallbacks: 'default'`, `output_config: { effort: 'medium', format: { type: 'json_schema', schema } }`, `system: INSTRUCTIONS` (plain string, not cached) |

Route time limits (`export const maxDuration`): `/api/admin/ask` 300 s;
`/api/photo-check` 60 s; `/api/admin/metrics/supplies/import` 120 s; every
export route and `ask/act`, `ask/apply`, `ask/report` 60 s.

#### Ask Xtend (`askAssistant`)

- System = two text blocks: `SYSTEM` (long fixed prompt, `cache_control: { type: 'ephemeral' }`)
  then `Today is <longDate> (<YYYY-MM-DD>). You are talking to <name> (<role>).` (not cached,
  so the cached prefix stays stable).
- History: the route accepts up to 30 turns, each `content` 1–20 000 chars, plus an
  optional `attachment` (`{ name ≤200, type ≤200, data base64 ≤ 4 200 000 chars }`).
  The attachment's blocks ride on the last user turn:
  images (png/jpeg/gif/webp) → `image` base64 block; PDF → `document` base64 block with
  `title`; `.xlsx` → text block "Attached spreadsheet <name>, as CSV" (ExcelJS → CSV);
  `.xls/.doc/.docx` → 400 "Save the file as .xlsx, .csv or PDF and attach it again.";
  anything else must be text without NUL bytes; text clipped at 150 000 chars with `…(file cut short)`.
- Tool loop: up to `MAX_TOOL_ROUNDS = 10`. Each round: if `stop_reason === 'refusal'` →
  answer "I can't help with that one. Try asking about who clocked in or out."; if no
  `tool_use` blocks → join text blocks as the answer; otherwise push the assistant
  content, run every tool in parallel, push one user message of `tool_result`s.
  Tool errors return `is_error: true` with the message.
- After 10 rounds: "That took too many lookups. Try a narrower question, such as one day or one person."
  (or "Your report is ready." if a report was made).
- Tools (28, all `strict: true`, every one runs with the caller's own RLS-bound client):
  read tools `attendance_on_day`, `staff_history`, `attendance_summary`, `field_reports`,
  `store_visits`, `store_counts`, `integrity_flags`, `integrity_risk`, `location_alerts`,
  `support_threads`, `notifications_sent`, `x_metrics`, `store_coverage`, `check_excuse`,
  `count_requests`, `match_names`; output tools `create_report`, `open_page`; proposal tools
  (nothing happens until the user presses the card's button) `propose_changes`,
  `propose_notification`, `propose_count_request`, `propose_close_count_request`,
  `propose_phone_check`, `propose_flag_review`, `propose_sales_target`,
  `propose_xmetrics_store`, `propose_outlet_hours`, `propose_deactivate`.
  Strict schemas express optional values as `type: ['string','null']` with "Null for …" descriptions.
- Reply shape: `{ answer, reports: ReportSpec[], plans: ChangePlan[], actions: ProposedAction[], links: PageLink[] }`.
- No key: the admin page shows a setup notice; the sidebar card shows "Your account / Change password" instead of "Ask Xtend".

#### Support helper (`respondToSupportThread`)

- Uses the admin client. Maps the thread: `ai` messages → `assistant`; others → `user`
  with `[<sender_role>] ` prefix. If the first turn is not `user`, the thread subject is unshifted.
- Tool `respond` input: `{ reply: string, escalate: boolean, reason?: string }` (required reply, escalate).
- Writes the reply (sliced to 4000 chars) as a `support_messages` row with `sender_role: 'ai'`,
  sets thread `status` to `escalated` or `ai_answered`, `escalated_at`, `last_message_at`.
  On escalation calls `notifyWatchers` with title `<name>: issue needs the office`, body
  `<subject>[ — <reason>]. Open Support to reply.`, url `/admin/support`.
- No key, no tool block, or any thrown error → escalates with
  "Thanks for your message. I've passed this to the office and someone will follow up with you."
- The prompt forbids mentioning location checks, integrity checks, alerts, VPN detection or
  anything recorded (staff are never told how they are monitored).

#### Photo check (`judgePhoto`) and `/api/photo-check`

- Kinds: `selfie`, `shelf`, `storefront`, `product_selfie`. One system prompt per kind
  (`COMMON` + kind text), cached. User content: one `image` block (`media_type: 'image/jpeg'`)
  then the ask text (e.g. "Check this clock-in selfie.").
- JSON schema (strict, `additionalProperties: false`), all required:
  `verdict: 'pass'|'reject'`; `problem: 'none'|'screen'|'printed_photo'|'no_face'|'face_unclear'|'not_a_shelf'|'not_a_business'|'no_product'|'blurry'|'too_dark'|'other'`;
  `message: string` (to the worker, "OK" on pass); `setting: 'shop'|'market'|'street'|'office'|'home'|'unclear'`.
- `refusal` throws; a verdict other than pass/reject throws.
- Route: body `{ bucket: 'selfies'|'reports', path, thumb_path?, kind?: 'shelf'|'storefront'|'product_selfie' }`;
  paths must start with `<userId>/`. Re-check of a known path returns the stored verdict.
  If the key is missing or the call fails, verdict `unchecked` (allowed). Rows upserted into
  `photo_checks` on `path` (selfie and thumbnail get the same verdict). Integrity flags:
  `photo_rejected` (severity `high` for screen/printed_photo, else `low`),
  `photo_unchecked` (low, only when a key is configured), `selfie_at_home` (medium, pass + setting home).
  Then `flushFlagAlerts()`. Reject → 422 `{ verdict, error: message }`; otherwise 200 `{ verdict }`.

#### Supply invoice reading

- Accepts CSV, `.xlsx`, PDF, `.docx` up to `MAX_IMPORT_BYTES = 10 * 1024 * 1024`.
- CSV/XLSX with recognised headings are parsed without Claude (`read_by: 'table'`).
  Otherwise the first 400 rows as tab-separated text go to Claude.
- PDF → `document` base64 block + "List the products delivered in this document."
- DOCX → text extracted from `word/document.xml` with JSZip (tabs between cells, newlines between paragraphs/rows).
- Output schema fields: `supplier, invoice_number, invoice_date, deliver_to, lines[] { description, sku, quantity_units, cartons, units_per_carton, batch, expiry_date, store }`.
- Errors: RateLimit/InternalServer/Connection → 503 "The invoice reader is busy. Try again in a minute.";
  other APIError → 400 "That file could not be read. Try a clearer copy, or a CSV or Excel file.";
  `refusal` → 400; `max_tokens` → 400 "That document has too many lines to read at once. Split it and import each part.";
  no key → 400 explaining to use CSV/Excel or log by hand.

### 3.2 Place naming: Google, OpenStreetMap (`src/lib/geocode.ts`)

All HTTP goes through `getJson(url, init)`: `AbortController` timeout `TIMEOUT_MS = 6000`,
`cache: 'no-store'`, returns null on non-2xx or any error.

`resolvePlace(lat, lng, outlet?, { google = true, supabase?, learn? })` resolution order:

1. **Assigned outlet** if the haversine distance (R = 6 371 000 m) ≤ `outlet.radius_m` → source `outlet`.
2. With a `supabase` client: `rpc('outlet_containing', { p_lat, p_lng })` → outlet name/address (source `outlet`);
   then `rpc('known_place_at', …)` → learned place (source `known`); with `learn`, `rpc('note_place_visit', { p_id })`.
3. **Google** (only if `google !== false` and `GOOGLE_MAPS_API_KEY` set), cached.
4. **OpenStreetMap**.
5. Fallback label `"<lat.toFixed(5)>, <lng.toFixed(5)>"`, source `coordinates`.

When a map source finds a name and `learn` is set: `rpc('learn_place', { p_lat, p_lng, p_name, p_address, p_source })`.
RPC errors are swallowed. `google: false` is used for the home screen's "you are at…" line (free OSM only);
clock-ins, visits and alerts use Google.

Google reverse lookup (`askGoogle`):

```http
POST https://places.googleapis.com/v1/places:searchNearby
Content-Type: application/json
X-Goog-Api-Key: <key>
X-Goog-FieldMask: places.displayName,places.formattedAddress,places.primaryType

{"maxResultCount":1,"rankPreference":"DISTANCE",
 "locationRestriction":{"circle":{"center":{"latitude":LAT,"longitude":LNG},"radius":80}}}
```

Only if Places returned no address: `GET https://maps.googleapis.com/maps/api/geocode/json?latlng=LAT,LNG&key=KEY`.
Label join rule: if the address already starts with the name (case-insensitive) show the address alone, else `"<name>, <address>"`.

Caching: `unstable_cache(fn, ['google-place-v1'], { revalidate: 60 * 60 * 24 * 30 })` (30 days),
keyed on lat/lng rounded to 4 decimals (~11 m). A miss throws `NothingFound` so it is not cached.

OSM reverse lookup:

- `GET https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=..&lon=..&zoom=18&addressdetails=1`
  with headers `User-Agent: GEOCODER_USER_AGENT ?? 'Xtend/1.0'`, `Accept-Language: en`.
  Address = `[house_number road] , neighbourhood|suburb|city_district , city|town|state`, else `display_name`.
- If Nominatim has no `name`, Overpass:
  `GET https://overpass-api.de/api/interpreter?data=<urlencoded>` with
  ```
  [out:json][timeout:5];(
    node(around:80,LAT,LNG)[name][~"^(shop|amenity|office|building)$"~"."];
    way(around:80,LAT,LNG)[name][~"^(shop|amenity|office|building)$"~"."];
  );out tags 5;
  ```
  First element with a `name` tag.

Forward geocoding `locateAddress(name, address?)` (store import): query = `name, address`.

1. `POST https://places.googleapis.com/v1/places:searchText`, field mask
   `places.displayName,places.formattedAddress,places.location`, body
   `{ textQuery, maxResultCount: 1, regionCode: 'NG' }` → source `google_places`.
2. `GET https://maps.googleapis.com/maps/api/geocode/json?address=<q>&region=ng&key=KEY` → `google_geocode`.
3. `GET https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ng&q=<q>`
   with `User-Agent: Xtend/1.0 (field attendance)` → `osm`.

### 3.3 IP geolocation (`src/lib/ip-geo.ts`)

`lookupIp(ip, headers)`: null if `IP_GEO_DISABLED === '1'` or the IP is missing/private.
Timeout 2500 ms (AbortController).

- URL base: `IP_GEO_URL` (must start with `https://`, else the provider is skipped) or
  `https://pro.ip-api.com/json` when `IP_API_KEY` is set, else `http://ip-api.com/json`
  (free tier is HTTP only, 45 requests/minute).
- `GET <base>/<ip>?fields=status,message,countryCode,lat,lon,proxy,hosting,mobile[&key=KEY]`
  (key only appended for ip-api's own pro endpoint), header `accept: application/json`.
- Success requires `status === 'success'`. Result `IpGeo { ip, lat, lng, country, proxy, hosting, mobile, source: 'ip-api' }`.
- On failure/timeout: Vercel headers `x-vercel-ip-country`, `x-vercel-ip-latitude`,
  `x-vercel-ip-longitude` → `source: 'vercel-headers'`, proxy/hosting/mobile all false.
- Never blocks a clock-in; null simply skips the IP checks.

### 3.4 Web Push (`src/lib/push.ts`, `src/lib/push-endpoint.ts`)

- `configure()` once: `webpush.setVapidDetails(VAPID_SUBJECT ?? 'mailto:ops@xpelbeauty.ng', NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)`.
- Payload (`PushPayload`), sent as JSON:
  ```ts
  { title: string; body: string; url?: string | null; notificationId?: string;
    check?: { id: string; token: string } }   // a supervisor's phone check
  ```
- `sendPush(target, payload)`: target `{ id, user_id, endpoint, p256dh, auth }`.
  Native endpoints (`native-fcm:` / `native-apns:`) go to `sendNative` after checking the
  token against `NATIVE_TOKEN = /^[A-Za-z0-9_:-]{20,4096}$/` (bad token → `gone: true`).
  Web endpoints must pass `isWebPushEndpoint` (https, default port, no credentials, host in
  `fcm.googleapis.com`, `android.googleapis.com`, `updates.push.services.mozilla.com`,
  `web.push.apple.com`, `*.notify.windows.com`), else `gone: true`.
- `webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 12 * 60 * 60, urgency: 'high' })`.
  404/410 → `gone: true` (retire the subscription). Outcome `{ subscriptionId, userId, ok, gone, error? }`.
- `vapidStatus()` checks presence, well-formedness (via `setVapidDetails`), that the public key
  equals the one derived from the private key (`createECDH('prime256v1')`, base64url), and
  that the subject matches `/^(mailto:.+@.+|https:\/\/.+)$/`.
- `LIVE_PUSH_ENDPOINT` regex (same as SQL `has_live_push()`):
  `^(https://(fcm.googleapis.com|android.googleapis.com|updates.push.services.mozilla.com|web.push.apple.com|[a-z0-9.-]+.notify.windows.com)/|native-(fcm|apns):[A-Za-z0-9_:-]{20,})`.
- Browser subscription: `use-push.ts` subscribes via `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` and posts `subscription.toJSON()` to `/api/push/subscribe`.

### 3.5 Native push (`src/lib/push-native.ts`)

Endpoint storage in `push_subscriptions.endpoint`: `native-fcm:<token>` (Android) or
`native-apns:<token>` (iOS) (migration 033). Registered by the app via `POST /api/push/native { platform, token }`.

Data block (all strings) for both: `{ url: payload.url ?? '/field', notification_id?, check_id?, check_token? }`.

**FCM HTTP v1** (`FIREBASE_SERVICE_ACCOUNT` = service-account JSON; `\n` in the key un-escaped):

1. OAuth token: JWT RS256 `{ iss: client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 }`,
   POST `https://oauth2.googleapis.com/token` form `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=…`.
   Cached until 60 s before `expires_in`.
2. `POST https://fcm.googleapis.com/v1/projects/<project_id>/messages:send`:
   ```json
   { "message": { "token": "...", "notification": { "title": "...", "body": "..." },
     "data": { ... },
     "android": { "priority": "HIGH", "ttl": "43200s", "notification": { "tag": "<notificationId>" } } } }
   ```
   `gone` when status 404 or error code `UNREGISTERED` / `INVALID_ARGUMENT`.

**APNs** (`APNS_KEY` .p8 contents, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID` default
`ng.xpelbeauty.xtend`, `APNS_SANDBOX=true` → sandbox host):

- JWT ES256 header `{ alg: 'ES256', kid }`, claims `{ iss: teamId, iat }`, signed with
  `dsaEncoding: 'ieee-p1363'`; reused for 40 minutes.
- HTTP/2 to `https://api.push.apple.com` (or `https://api.sandbox.push.apple.com`),
  `POST /3/device/<token>`, headers `authorization: bearer <jwt>`, `apns-topic`,
  `apns-push-type: alert`, `apns-priority: 10`, `apns-expiration: now + 12 h`.
- Body `{ aps: { alert: { title, body }, sound: 'default', 'thread-id': notificationId }, ...data }`.
- `gone` on 410 or reason `BadDeviceToken` / `Unregistered`.

`nativePushConfigured()` → `{ android: Boolean(serviceAccount()), ios: Boolean(apnsToken()) }`.

### 3.6 Credentials webhook (`src/lib/credentials.ts`)

- `generateTempPassword()`: `AAA-9999-AAA` from alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ` (no I/O)
  and digits `23456789` (no 0/1), using `crypto.getRandomValues`.
- `deliverCredentials({ full_name, email, phone, temp_password })`: without
  `CREDENTIALS_WEBHOOK_URL` returns `'manual'` (the admin is shown the password to hand over).
  Otherwise `POST` JSON to the URL with `Authorization: Bearer CREDENTIALS_WEBHOOK_TOKEN` if set;
  `'sent'` on 2xx, `'manual'` on anything else or an exception. Called from `POST /api/admin/users`.

### 3.7 Android APK release lookup (`src/lib/app-release.ts`)

- `REPO = APP_RELEASE_REPO || 'abahvictor360-sketch/Xtend'`, tag `android`, asset `xtend.apk`.
- `GET https://api.github.com/repos/<REPO>/releases/tags/android`, `Accept: application/vnd.github+json`,
  `next: { revalidate: 600 }` (10 minutes), `AbortSignal.timeout(4000)`.
- Version = first `\d+\.\d+\.\d+` in the release name; build = its third part.
  Returns `{ url: browser_download_url, version, build }` or null.
- `/api/version` prefers `ANDROID_APK_URL` (+ `ANDROID_LATEST_BUILD`) when set; otherwise this lookup.

### 3.8 Supabase Realtime

**Field app (migration 0058): per-member Broadcast.** Database triggers on
`attendance`, `store_visits`, `support_threads`, `notification_deliveries`
(owner = `user_id`) and `support_messages` (owner = the thread's `user_id`)
call `realtime.send({table, op}, 'change', 'field:<owner uid>', private = true)`.
The event carries only the table name and the kind of change, never the row.
Receipt is limited by the policy "Field members read their own topic" on
`realtime.messages`: `realtime.topic() = field_topic(auth.uid())`.

- `use-dashboard-refresh.ts` subscribes to
  `supabase().channel('field:' + userId, { config: { private: true } }).on('broadcast', { event: 'change' }, …)`
  only while the member has an active shift, and answers each event with a
  debounced `router.refresh()` (the re-fetch goes through RLS as usual). A
  jittered safety poll keeps the screen current if the socket is off or fails.
- `support-chat.tsx` listens on the same topic for `support_messages` /
  `support_threads` changes and re-reads the thread.
- `NEXT_PUBLIC_REALTIME_DISABLED=1` turns the client sockets off fleet-wide;
  the safety poll then carries the updates (the release valve when the
  concurrent-connection cap is the bottleneck).

**Dashboard:** `live-alert-feed.tsx` still subscribes to `postgres_changes`
INSERTs on `location_alerts` (channel `alerts-feed`); office users are few, so
the per-subscriber RLS cost is small. Migration 0056 adds the field tables to
the `supabase_realtime` publication; 0002 added `attendance` and
`location_alerts`.

---

## 4. Offline, PWA and capture

### 4.1 Manifest (`public/manifest.webmanifest`)

| Key | Value |
|---|---|
| `id`, `start_url`, `scope` | `/` |
| `name` / `short_name` | `Xtend — Xpel Beauty` / `Xtend` |
| `description` | `Field attendance and daily reporting for Xpel Beauty.` |
| `lang`, `dir` | `en-NG`, `ltr` |
| `categories` | `business`, `productivity` |
| `display`, `orientation` | `standalone`, `portrait` |
| `background_color`, `theme_color` | `#ffffff`, `#d1531b` |
| icons | `/icons/icon-64.png` 64, `/icons/icon-192.png` 192, `/icons/icon-512.png` 512 (purpose any), `/icons/icon-maskable-512.png` 512 (maskable) |
| shortcuts | "Clock in or out" (Clock) → `/field`; "Daily report" (Report) → `/field/report`; "My attendance" (History) → `/field/history`; each with the 192 icon |

Other static files: `public/icons/apple-touch-icon.png`, `public/brand/xpel-logo.png`,
`public/brand/xpel-mark.png`, `public/guide/*.png` (screenshots for the guides).

### 4.2 Service worker (`public/sw.js`)

Registered by `<ServiceWorker />` only when `NODE_ENV === 'production'`:
`navigator.serviceWorker.register('/sw.js')`, errors ignored. Served with
`Cache-Control: no-cache, no-store, must-revalidate` and `Service-Worker-Allowed: /`.

- `VERSION = 'xtend-v3'`; `SHELL = ['/offline', '/manifest.webmanifest', '/icons/icon-192.png']`.
- `install`: cache the shell, `skipWaiting()`. `activate`: delete every other cache, `clients.claim()`.
- `fetch`: ignore non-GET, cross-origin and `/api/*`.
  Navigations → network, falling back to cached `/offline`.
  `/_next/static/*` and `/icons/*` → cache-first, storing on first fetch.
  Everything else is untouched. Writes are never replayed by the worker.
- `push`: parse JSON (or `{ title: 'Xtend', body: text }`). Show notification with
  `title || 'Xtend'`, `body`, `icon: '/icons/icon-192.png'`, `badge: '/icons/icon-64.png'`,
  `tag: notificationId`, `renotify: Boolean(notificationId)`, `data: { url: url || '/field', check }`,
  `vibrate: [80, 40, 80]`. If `check` has id and token, also
  `POST /api/phone-check/ack { id, token, stage: 'delivered' }`.
- `notificationclick`: close; same-origin URL only (else `/field`); ack `stage: 'opened'`
  if a check; focus an existing window and `navigate()` it, else `openWindow`.
- `pushsubscriptionchange`: resubscribe with the old `applicationServerKey` and POST to `/api/push/subscribe`.

### 4.3 IndexedDB outbox (`src/lib/offline/db.ts`)

`openDB('xtend', 1)`, one object store `outbox` (`keyPath: 'id'`, `autoIncrement`),
index `by_queued_at` on `queued_at`.

Record: `{ id?: number, kind, job, attempts: number, last_error: string | null, queued_at: ISO }`.

| `kind` | Job fields |
|---|---|
| `clock` | `type` (AttendanceType), `lat`, `lng`, `accuracy_m`, `address`, `place_name`, `place_source`, `device_info`, `client_captured_at`, `selfie: Blob`, `thumb: Blob` |
| `ping` | `lat`, `lng`, `accuracy_m`, `client_captured_at` |
| `report` | `body`, `sales_summary`, `stock_status`, `competitor_activity`, `issues`, `photos: Blob[]`, `files?: { blob: Blob, name, mime, client_id?, uploaded_path? }[]` (0064; absent on older jobs; `client_id` given when picked and `uploaded_path` set once sent, 0065), `client_captured_at` |
| `report_file_remove` | `file_id`, `name`, `client_captured_at` (0065) |
| `xm_count` | `outlet_id`, `outlet_name`, `lat`, `lng`, `accuracy_m`, `lines[] { product_id, batch, expiry_date, on_shelf, in_backroom }`, `photo: Blob`, `client_captured_at` |
| `xm_sales` | `outlet_id`, `outlet_name`, `sale_date`, `lines[] { product_id, units }`, `photo: Blob \| null`, `client_captured_at` |

Helpers: `enqueue(job)`, `listOutbox()` (by `queued_at`), `countOutbox()`, `dropOutbox(id)`,
`saveOutboxRecord(record)` (put, for progress on a queued job; no-op without an `id`),
`markAttempt(record, error)` (attempts + 1, `last_error`).

### 4.4 Outbox sync (`src/lib/offline/sync.ts`)

Constants: `MAX_AGE_MS = 24 h` (clock, ping, report), `XM_MAX_AGE_MS = 72 h`
(xm_count, xm_sales), `MAX_ATTEMPTS = 8`, ping batch up to 400 per request.

What each job does when run:

| Kind | Steps |
|---|---|
| `clock` | Upload `selfies/<uid>/<uuid>.jpg` and `<uuid>_thumb.jpg` (`contentType: image/jpeg`, `upsert: true`) → `checkPhoto('selfies', path, thumb)` → `POST /api/attendance` with all fields plus `device_info.sent_at = now` |
| `ping` | `POST /api/pings/offline { sent_at, points: [{ lat, lng, accuracy_m, captured_at }] }` |
| `report` | Upload each photo not yet sent to `reports/<uid>/report-photo-<client_id>.jpg` (0067: `image/jpeg`, `upsert: false`; the job keeps photos as `{ blob, client_id, uploaded_path }`, a job from before 0067 holds bare pictures and gets ids on its first try, saved on the record at once; "already exists" counts as sent; `uploaded_path` saved after each; `queuedPhotos` / `uploadQueuedPhotos` in `src/lib/report-photo-queue.ts`), then each document not yet sent to `report-files/<uid>/report-<client_id>.<ext>` (`contentType` = its type, `upsert: false`; a job from before 0065 gets its `client_id` on the first try; storage's "already exists" counts as sent; `uploaded_path` is saved on the queued record after each; `uploadQueuedFiles` in `src/lib/report-file-queue.ts`) → `POST /api/reports { body, sales_summary, stock_status, competitor_activity, issues, photo_paths, files: [{ path, name }] }` |
| `report_file_remove` | `DELETE /api/report-files/<file_id>`; `removalOutcome`: 2xx or 404 `gone` → done; 409 `locked` (or the old 400 text) → done, and when sent from the queue a notice is kept for the report page (`localStorage` `xtend.report-file-notices`, at most 10); 0/401/408/429/5xx → transient; other 4xx → done with a "could not be removed" notice. Run while the person watches, a refusal is thrown to the UI instead |
| `xm_count` | Upload `reports/<uid>/xm-count-<uuid>.jpg` → `checkPhoto('reports', path)` → `POST /api/metrics/counts { outlet_id, lat, lng, accuracy_m, photo_path, captured_at, lines }` |
| `xm_sales` | Optional photo `xm-sales-…` as above → `POST /api/metrics/sales { outlet_id, sale_date, photo_path, captured_at, lines }` |

Storage buckets (all private, files reach the browser only as short-lived signed
links): `selfies` (clock and visit selfies), `reports` (report photos at
`<uid>/report-photo-<client_id>.jpg` since 0067, shelf and place photos, count
sheets and the admin's blank sheet) and, since 0064,
`report-files` (documents attached to the daily report, `<uid>/report-<client_id>.<ext>`;
10 MB and the document allowlist set on the bucket as well; rules in
`30-rules.md` §2.6). Uploads go straight from the phone to Supabase Storage, so
the VPS's Nginx `client_max_body_size 25m` never sees them; the 10 MB limit is the
app's, the bucket's and the database's.

Error classification in `postJson` and `checkPhoto`:

| Response | Treatment |
|---|---|
| 2xx | done, record dropped |
| 401 | transient (kept). If `code === 'relogin'`, navigate to `/api/auth/expired?reason=new-day` |
| 423 | `NamePlaceFirstError`: kept; sent after the place is named |
| other 4xx | `PermanentJobError`: record dropped (photo-check 4xx too: "retake") |
| 5xx / network | transient: `markAttempt`, stop |

`flushOutbox()`: guarded by a module flag (concurrent call returns counts only).
Walks records oldest first. A run of consecutive pings is batched (≤400), dropping
pings older than 24 h or with ≥8 attempts. Other records older than their max age or
with ≥8 attempts are dropped (a dropped `report_file_remove` leaves a notice: "locked"
when queued over 24 h ago, else "could not be removed"). The first transient failure **stops the flush**
(preserves ordering). Returns `{ sent, failed, dropped, remaining }`.

`submitOrQueue(job)`: offline (`navigator.onLine === false`) → enqueue; else run now;
permanent errors are thrown to the UI; any other error enqueues and returns
`{ queued: true, waitingForPlace }`.

Flush triggers: `OutboxBanner` (on mount if online, on `online`, button; refreshes the
count every 15 000 ms and counts everything except pings), `PhoneBeacon` on `online`,
`heartbeat.ts` after a successful ping when the outbox is non-empty, `NamePlace` after a place is named.

### 4.5 Phone beacon and heartbeat

- `PhoneBeacon` (field layout): `reportPhone` on open, visibility change, `online`, and
  every `5 * 60_000` ms while visible. `hidden` uses `navigator.sendBeacon('/api/beacon', blob)`.
  Payload: `{ reason, connection, battery_pct, charging, outbox_count, oldest_queued_at, device_time, offline_since, lat, lng, accuracy_m }`.
  The location is taken only if permission is already granted (`enableHighAccuracy: false`, `timeout: 8000`, `maximumAge: 300000`).
  localStorage keys `xtend.anchor` (last acknowledged report id, attached to clock-ins) and `xtend.offline_since`.
- Heartbeat (`src/components/field/heartbeat.ts`): `HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000`
  (`src/lib/geo.ts`) while on shift; holds a screen wake lock when allowed; pings immediately on
  becoming visible. Inside the app without the native tracker it uses the background-geolocation
  watcher and `nativePostJson('/api/pings', …)`; failures are enqueued as `ping` jobs (except 400).

### 4.6 Update manager (`src/components/update-manager.tsx`)

Checks `GET /api/version` (no-store) on open, every `10 * 60_000` ms, and on return to
the screen (not more than once a minute). Snoozes: site 30 min, app 24 h (localStorage).
`decideUpdate` (`src/lib/app-update.ts`): site `available` if build ids differ, `required`
if the latest release note has `required`; app build read with `callNative('App', 'getInfo')`
and compared with `latest_build` / admin `minimum`. "Update now" calls `registration.update()`
then `location.reload()`. Release notes shown once if under `NOTES_FRESH_DAYS = 14` days old.
`/api/version` response is `VersionInfo` (`Cache-Control: no-store, max-age=0`).

### 4.7 Images (`src/lib/image.ts`)

| Function | Output |
|---|---|
| `processSelfie(file)` | Full: width `min(640, source)`, aspect kept, JPEG starting quality 0.82, minus 0.12 per pass while size > `150 * 1024` bytes and quality > 0.35. Thumb: 200×200 centre-cropped ("cover"), JPEG 0.7. |
| `processReportPhoto(file)` | Width `min(900, source)`, JPEG starting 0.78, minus 0.12 while > `220 * 1024` bytes and quality > 0.35. |

Decoding uses `createImageBitmap`, falling back to an `<img>` from an object URL (older Android WebViews).
Exports: `SELFIE_WIDTH = 640`, `SELFIE_MAX_BYTES = 150 * 1024`, `THUMB_SIZE = 200`.

### 4.8 Camera (`src/components/field/camera-capture.tsx`)

- Full-screen black dialog (`fixed inset-0 z-50`, `role="dialog"`, `aria-modal`), Escape closes,
  focus starts on Cancel. There is **no file input** anywhere in capture flows.
- `getUserMedia({ video: { facingMode, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false })`.
  Props: `open`, `title`, `subtitle` (place line with a MapPin), `facing` (`'user'` default,
  `'environment'` for shelves), `locate` (follow GPS while open and stamp the shot), `onCapture(blob, fix|null)`, `onClose`.
- Preview mirrored for the front camera (`scale-x-[-1]`); the saved frame is not.
- On shutter: draw to canvas, run `assessFrame` (`src/lib/photo-quality.ts`, 160 px sample):
  brightness < 35 → "The photo is too dark. Move to better light, or face the light, and try again.";
  > 235 → "The photo is washed out…"; contrast < 10 → "The camera sees almost nothing. Make sure nothing is covering it.";
  Laplacian variance < 12 → "The photo is blurry. Hold the phone still and try again." The camera stays open with the hint.
- Passed frames: `canvas.toBlob(…, 'image/jpeg', 0.92)`, then processed by `image.ts`.
- Errors: `NotAllowedError` → "Camera permission is off. Allow the camera for this site, then try again.";
  `NotFoundError` → "No camera found on this device."; else "The camera could not start. Close other apps using it and try again."
- Shutter: 80 px circle (`h-20 w-20 border-4 border-white/70`) with a 56 px white inner disc.
  Footer note: "Taken live in the app. Photos from your gallery, or of a screen or a printed photo, are rejected."

---

## 5. Native apps (`mobile/`)

The apps are a Capacitor shell that loads the live site; a web deploy reaches phones at once.
A new app build is only needed when `mobile/` changes. `mobile/` is excluded from
`tsconfig.json` and from Vercel uploads (`.vercelignore`).

### 5.1 `mobile/capacitor.config.ts`

```ts
const url = process.env.XTEND_URL ?? 'https://xtend-brown.vercel.app'
const config: CapacitorConfig = {
  appId: 'ng.xpelbeauty.xtend',
  appName: 'Xtend',
  webDir: 'www',                       // offline fallback page only
  appendUserAgent: 'XtendApp',         // lets the site detect the app (src/lib/app-agent.ts)
  server: { url, cleartext: false, allowNavigation: [new URL(url).host, '*.supabase.co'], errorPath: 'index.html' },
  android: { allowMixedContent: false, useLegacyBridge: true },
  ios: { contentInset: 'never', limitsNavigationsToAppBoundDomains: false },
  plugins: { PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] } },
}
```

`useLegacyBridge: true` keeps background-geolocation updates flowing after 5 minutes in the
background. `mobile/www/index.html` is a small branded "cannot reach Xtend" page
(background `#f9f6f3`, text `#2b211c`, system font).

### 5.2 `mobile/package.json` (exact pins)

| Package | Version |
|---|---|
| `@capacitor-community/background-geolocation` | 1.2.26 |
| `@capacitor/android` | 8.5.2 |
| `@capacitor/app` | 8.1.2 |
| `@capacitor/core` | 8.5.2 |
| `@capacitor/ios` | 8.5.2 |
| `@capacitor/push-notifications` | 8.1.3 |
| `@capacitor/cli` (dev) | 8.5.2 |
| `typescript` (dev) | ^5.6.0 |

Scripts: `sync` = `cap sync`; `android` = `cap sync android && cap open android`; `ios` = `cap sync ios && cap open ios`.

iOS uses Swift Package Manager (`mobile/ios/App/CapApp-SPM/Package.swift`, swift-tools 5.9,
platform iOS 15, `capacitor-swift-pm` exact 8.5.2 plus the three plugins from `node_modules`).

### 5.3 Android project

- `android/variables.gradle`: `minSdkVersion = 24`, `compileSdkVersion = 36`, `targetSdkVersion = 36`,
  androidx appcompat 1.7.1, coordinatorlayout 1.3.0, core 1.17.0, activity 1.11.0, fragment 1.8.9,
  core-splashscreen 1.2.0, webkit 1.14.0, cordovaAndroidVersion 14.0.1.
- `app/build.gradle`: namespace/applicationId `ng.xpelbeauty.xtend`;
  `versionCode = XTEND_VERSION_CODE ?: 1`, `versionName = XTEND_VERSION_NAME ?: "1.0"`;
  release signing only when `XTEND_KEYSTORE_PATH` is set (`XTEND_KEYSTORE_PASSWORD`,
  `XTEND_KEY_ALIAS`, `XTEND_KEY_PASSWORD`); `minifyEnabled false`; the Google Services plugin is
  applied only if `google-services.json` exists.
- `res/values/colors.xml`: `xtend_orange = #D1511A`. Notification small icon `@drawable/ic_stat_xtend`.

`AndroidManifest.xml`:

| Element | Detail |
|---|---|
| `MainActivity` | `launchMode="singleTask"`, `exported="true"`, MAIN/LAUNCHER, theme `AppTheme.NoActionBarLaunch` |
| meta-data | `com.google.firebase.messaging.default_notification_icon` = `@drawable/ic_stat_xtend`; `…default_notification_color` = `@color/xtend_orange` |
| service `.ShiftTrackerService` | `exported="false"`, `stopWithTask="false"`, `foregroundServiceType="location"` |
| receiver `.ShiftTrackerBoot` | `exported="true"`; actions `BOOT_COMPLETED`, `MY_PACKAGE_REPLACED`, `android.intent.action.QUICKBOOT_POWERON` |
| provider | `androidx.core.content.FileProvider`, authority `${applicationId}.fileprovider`, `@xml/file_paths` |
| permissions | `INTERNET`, `CAMERA` (feature camera `required=false`), `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `POST_NOTIFICATIONS`, `WAKE_LOCK`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`, `RECEIVE_BOOT_COMPLETED` |

Native classes (`android/app/src/main/java/ng/xpelbeauty/xtend/`):

- **`MainActivity`** extends `BridgeActivity`; registers `LocationIntegrity` and `ShiftTracker` before `super.onCreate`.
- **`LocationIntegrity`** plugin, method `getFix`. Requests `ACCESS_FINE_LOCATION` (alias `location`) if needed.
  Provider GPS, else network, else reject "Location is turned off". Reuses last known if < `FRESH_MS = 30_000`;
  otherwise `requestSingleUpdate` with a `TIMEOUT_MS = 25_000` reject "No location fix in time".
  Resolves `{ lat, lng, accuracy_m, altitude|null, speed|null, heading|null, is_mock, compromised, platform: 'android', captured_at (ISO UTC) }`.
  `is_mock` = `loc.isMock()` on API ≥ 31 else `isFromMockProvider()`. `compromised` = any of ten `su`
  paths exists (`/system/app/Superuser.apk`, `/sbin/su`, `/system/bin/su`, `/system/xbin/su`,
  `/data/local/xbin/su`, `/data/local/bin/su`, `/system/sd/xbin/su`, `/system/bin/failsafe/su`,
  `/data/local/su`, `/su/bin/su`) or `which su` prints a line.
- **`ShiftTracker`** plugin: `start({ token, endpoint (must be https://), expiresAt, title='Xtend', text='On shift' })`
  stores them in SharedPreferences `xtend_shift_tracker` and starts the service; `stop` clears;
  `status`; `requestBackground` (Android 11+: opens app settings; Android 10: requests
  `ACCESS_BACKGROUND_LOCATION` with request code 7302); `openBatterySettings`
  (`ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS`, falling back to app details).
  State: `{ platform: 'android', active, running, location, always, batteryUnrestricted, queued, lastSentAt?, lastError }`.
- **`ShiftTrackerService`** (foreground, notification channel `xtend_on_shift` "On shift", importance LOW,
  notification id 7301, ongoing, title/text from prefs, tap opens `MainActivity`).
  Constants: `EVERY_MS = 150_000` (a point at least every 2.5 min), `MOVED_M = 100` (or sooner after
  100 m), `ROUGH_M = 250` (rougher readings skipped unless nothing better for 2×EVERY_MS),
  `RETRY_MS = 60_000` after a failure, `MAX_QUEUE = 2000` (oldest dropped).
  Location updates from GPS and network providers every 60 000 ms, distance 0; a tick every
  `EVERY_MS` takes the best last-known fix (< 10 min old) if nothing was saved, and flushes.
  Points `{ lat, lng, accuracy_m (999 if none), captured_at (min of fix time and now), is_mock }`
  are kept in prefs key `queue` (JSON). Send: up to 500 points,
  `POST <endpoint>` `Authorization: Bearer <token>`, body `{ sent_at, points }`, connect timeout 20 000,
  read 30 000; wake lock held up to 60 000 ms. 401 → clear queue and stop; non-2xx → `last_error = "server <status>"`;
  2xx → drop the sent points; answer `{ stop: true }` → clear; exactly 500 sent → send again.
  `START_STICKY`; `onTaskRemoved` flushes. Returns `START_NOT_STICKY` and stops when not configured
  (no token or `expires_at` past).
- **`ShiftTrackerBoot`** receiver: on the three actions, if configured, starts the service (ignores refusals).

### 5.4 iOS project

- Bundle id `ng.xpelbeauty.xtend`, deployment target iOS 15.0, `MARKETING_VERSION = 1.0`,
  `CURRENT_PROJECT_VERSION = 1`. `App.entitlements`: `aps-environment = production`.
- `Main.storyboard` uses `customClass="XtendViewController"`.
- **`XtendViewController`** (`CAPBridgeViewController`): `capacitorDidLoad` registers
  `LocationIntegrity()` and `ShiftTracker()` instances. Any new Swift file must also be added to `project.pbxproj`.
- **`AppDelegate`**: on launch, `if ShiftTrackerCore.shared.configured { resume() }` (iOS relaunches
  the app in the background on significant location change); forwards the APNs device token / failure
  to Capacitor via `NotificationCenter` (`.capacitorDidRegisterForRemoteNotifications`,
  `.capacitorDidFailToRegisterForRemoteNotifications`); scene config uses `SceneDelegate`.
- **`LocationIntegrity.swift`**: `getFix` with `kCLLocationAccuracyBest`, `requestWhenInUseAuthorization`
  if undetermined, `requestLocation()`. `is_mock` always false. `compromised` = jailbreak check
  (not on simulator): paths `/Applications/Cydia.app`, `/Library/MobileSubstrate/MobileSubstrate.dylib`,
  `/bin/bash`, `/usr/sbin/sshd`, `/etc/apt`, `/private/var/lib/apt/`; `cydia://` openable; or writing
  `/private/jailbreak_probe.txt` succeeds. Same result shape as Android with `platform: 'ios'`.
- **`ShiftTracker.swift`**: `ShiftTrackerCore` singleton. UserDefaults keys `xtend.tracker.token`,
  `.endpoint`, `.expires` (ms), `.queue`, `.lastAt`, `.lastLat`, `.lastLng`, `.sent`, `.error`.
  `every = 150` s, `movedMetres = 100`, `desiredAccuracy = kCLLocationAccuracyNearestTenMeters`,
  `distanceFilter = 50`, `pausesLocationUpdatesAutomatically = false`, `activityType = .otherNavigation`,
  background updates and indicator on when `UIBackgroundModes` has `location`; also
  `startMonitoringSignificantLocationChanges()`. Asks for Always after When-In-Use. Queue capped at 2000.
  Flush: up to 500 points, `URLRequest` timeout 25 s, inside a background task `xtend-positions`;
  retry gap 60 s; same 401 / non-2xx / `stop` handling as Android. Plugin methods identical to Android;
  `openBatterySettings` is a no-op and `batteryUnrestricted` always true; `running` = `configured`.

`Info.plist` keys of note:

| Key | Value |
|---|---|
| `CFBundleDisplayName` | `Xtend` |
| `NSCameraUsageDescription` | `Xtend uses the camera for your clock-in selfie and photos of the shelves you count.` |
| `NSLocationWhenInUseUsageDescription` | `Xtend uses your location to confirm you are at your store when you clock in.` |
| `NSLocationAlwaysAndWhenInUseUsageDescription` | `Xtend uses your location while you are on shift to confirm you are at your store.` |
| `UIBackgroundModes` | `location`, `remote-notification` |
| `UIApplicationSupportsMultipleScenes` | false; scene delegate `$(PRODUCT_MODULE_NAME).SceneDelegate`, storyboard `Main` |
| `UILaunchStoryboardName` / `UIMainStoryboardFile` | `LaunchScreen` / `Main` |
| `UIViewControllerBasedStatusBarAppearance` | true |

### 5.5 JS bridge (`src/lib/native.ts`)

Talks to `window.Capacitor` directly (no `@capacitor/*` import in the web app):
`nativePromise`, `nativeCallback`, `addListener`, `isPluginAvailable`.

| Function | Behaviour |
|---|---|
| `nativePlatform()` | `'android'` if `window.androidBridge`, `'ios'` if `window.webkit.messageHandlers.bridge`, else null |
| `isNativeApp()`, `hasPlugin(name)`, `callNative(plugin, method, opts)`, `listenNative(plugin, event, cb)` | Thin wrappers; no-ops / throw "Not running in the Xtend app" in a browser |
| `watchBackgroundLocation(onLocation, onError)` | `BackgroundGeolocation.addWatcher({ backgroundTitle: 'Xtend', backgroundMessage: 'On shift', requestPermissions: true, stale: false, distanceFilter: 25 })`; returns a stop function calling `removeWatcher` |
| `hasShiftTracker()` | in app and plugin `ShiftTracker` present |
| `startShiftTracker()` | `POST /api/track/token { platform }` → `{ token, endpoint, expires_at }` → `ShiftTracker.start({ token, endpoint, expiresAt: Date.parse(expires_at), title: 'Xtend', text: 'On shift' })` |
| `stopShiftTracker()` | `ShiftTracker.stop` then `POST /api/track/stop` |
| `shiftTrackerState()`, `askAlwaysLocation()`, `openBatterySettings()` | wrap `status`, `requestBackground`, `openBatterySettings` |
| `nativePostJson(path, body)` | Android with `CapacitorHttp`: native POST (WebView fetches are throttled in background); else `fetch` with `keepalive: true` |
| `nativePushPermission(request)` | `PushNotifications.checkPermissions` / `requestPermissions` → `'granted' \| 'denied' \| 'prompt'` |
| `registerNativePush()` | listens for `registration` / `registrationError` (20 000 ms timeout "This phone did not answer. Try again."), calls `register`, posts `{ platform, token }` to `/api/push/native` |
| `getNativeFix()` | `LocationIntegrity.getFix`, null on failure or non-finite coordinates |
| `nativeDeviceSignals(fix)` | `{ native: { platform, is_mock, compromised } }` folded into `device_info` (server raises `mock_location_confirmed`, `device_integrity_failed`, migration 032) |

`NativeBridge` component (field and admin frames): listens to `pushNotificationReceived`
(ack `delivered`) and `pushNotificationActionPerformed` (ack `opened`, then `router.push(url)` only
if the url matches `/^\/(?![/\\])/`). `APP_AGENT_MARK = 'XtendApp'` (`src/lib/app-agent.ts`) lets
server pages hide "Get the app" inside the app.

### 5.6 GitHub Actions (`.github/workflows/mobile.yml`)

Triggers: every `push` (all branches, no path filter); `workflow_dispatch`.
Concurrency `mobile-${{ github.ref }}`, cancel in progress.

**Job `android`** (ubuntu-latest, `permissions: contents: write`, working dir `mobile`,
version set by a "Version" step: `XTEND_VERSION_CODE = 100 + git rev-list --count HEAD -- mobile .github/workflows/mobile.yml`,
`XTEND_VERSION_NAME = 1.0.<code>`, written to `$GITHUB_ENV`):

1. `actions/checkout@v4` with `fetch-depth: 0`, then the Version step
2. `actions/setup-node@v4` node 22, npm cache on `mobile/package-lock.json`
3. `actions/setup-java@v4` temurin 21
4. `npm ci`
5. Write `android/app/google-services.json` from secret `GOOGLE_SERVICES_JSON` (warning if missing: no push)
6. `npx cap sync android`
7. `./gradlew assembleDebug --no-daemon --console=plain` (log tee'd to `$RUNNER_TEMP/gradle.log`)
8. On failure: extract "What went wrong/Where" lines as `::error::` annotations (max 40)
9. Decode `ANDROID_KEYSTORE_BASE64` to `$RUNNER_TEMP/xtend.keystore` if set
10. If a key: `./gradlew assembleRelease bundleRelease --no-daemon` with `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`
11. `actions/upload-artifact@v4` name `xtend-android-<run>`, APKs and AABs, `if-no-files-found: error`
12. On the default branch: copy the signed release APK (or the debug APK) to `xtend.apk`; create or edit release
    tag `android` titled `Xtend for Android 1.0.<code>` with notes `Built from <sha7>, run <run> (<kind>). Install from ${XTEND_URL}/download` (`XTEND_URL` = repository variable `APP_URL`, default `https://xtend-brown.vercel.app`);
    `gh release upload android xtend.apk --clobber`.

**Job `ios`** (macos-latest): checkout, node 22, select newest `/Applications/Xcode_*.app`,
`npm ci`, `npx cap sync ios`, `xcodebuild -project App.xcodeproj -scheme App -configuration Debug -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO -derivedDataPath $RUNNER_TEMP/ios-build build`,
then zip `App.app` and upload it as artifact `xtend-ios-simulator-<run>` (kept 30 days).
Checkout uses `fetch-depth: 0` and a **Version** step sets `XTEND_VERSION_CODE`/`XTEND_VERSION_NAME` as in the Android job. On the default branch, when the secrets `APPSTORE_API_KEY_P8`, `APPSTORE_KEY_ID`, `APPSTORE_ISSUER_ID` and `APPLE_TEAM_ID` are all set (else a notice and nothing more), it writes the key to `$RUNNER_TEMP/AuthKey_<id>.p8`, runs `xcodebuild … -configuration Release -destination 'generic/platform=iOS' -archivePath $RUNNER_TEMP/Xtend.xcarchive DEVELOPMENT_TEAM=<team> CODE_SIGN_STYLE=Automatic CURRENT_PROJECT_VERSION=<code> MARKETING_VERSION=1.0.<code> -allowProvisioningUpdates -authenticationKeyPath/-ID/-IssuerID archive`, then `xcodebuild -exportArchive` with ExportOptions `method=app-store-connect`, `destination=upload`, `signingStyle=automatic`, `uploadSymbols=true`, `manageAppVersionAndBuildNumber=false`, which uploads to TestFlight. `Info.plist` has `ITSAppUsesNonExemptEncryption` = false.

Versioning: Android `versionCode` = 100 + commits that changed `mobile/` or the workflow, `versionName` = `1.0.<code>`
(website-only changes keep the same version, so the update prompt does not fire); the `/download` page
and `UpdateManager` read the build from the release name's third number. iOS builds are set by hand
in Xcode and announced with `IOS_LATEST_BUILD` / `IOS_APP_URL`. Admins can set minimum builds
(`app_minimum_builds`) to force an install.

---

## 6. Design system

### 6.1 Colour tokens (`src/app/globals.css`, `:root`, HSL triplets)

| Token | Value | Role |
|---|---|---|
| `--background` | `30 20% 97%` | page background (warm off-white) |
| `--canvas` | `30 12% 91%` | dashboard backdrop behind panels |
| `--foreground` | `24 18% 14%` | text |
| `--card` | `0 0% 100%` | card surface |
| `--card-foreground` | `24 18% 14%` | |
| `--brand` | `18 78% 40%` | brand orange (filled surfaces, primary buttons) |
| `--brand-deep` | `14 74% 35%` | gradient end, hover |
| `--brand-ink` | `16 60% 20%` | darkest brand |
| `--gold` | `45 72% 44%` | accent (logo gradient end) |
| `--primary` | `18 78% 46%` | |
| `--primary-foreground` | `0 0% 100%` | text on brand |
| `--tint` | `24 90% 94%` | chips, icon tiles, inactive pills |
| `--tint-foreground` | `18 55% 34%` | |
| `--secondary` | `24 90% 94%` | |
| `--secondary-foreground` | `18 55% 34%` | |
| `--accent` | `26 100% 96%` | |
| `--accent-foreground` | `18 55% 34%` | |
| `--muted` | `28 16% 95%` | skeletons, subtle fills |
| `--muted-foreground` | `25 8% 46%` | secondary text |
| `--success` | `152 58% 34%` | |
| `--success-foreground` | `0 0% 100%` | |
| `--warning` | `36 94% 42%` | |
| `--warning-foreground` | `0 0% 100%` | |
| `--destructive` | `4 74% 48%` | |
| `--destructive-foreground` | `0 0% 100%` | |
| `--border` | `28 18% 91%` | |
| `--input` | `28 18% 88%` | |
| `--ring` | `18 78% 46%` | focus ring |
| `--radius` | `1.25rem` | base radius |

Shell overrides:

| Scope | Override |
|---|---|
| `.admin-shell` | `--canvas: 30 6% 95.5%`; `.admin-shell .surface` → `rounded-[1.25rem] border border-border/80 shadow-none` |
| `.field-shell` | `--background: 30 8% 94%`; `.field-shell .surface` → `rounded-[1.75rem] shadow-none` |

Hex values used directly: theme colour `#d1531b` (manifest, viewport); Android `#D1511A`;
logo gradient `#C1572A` → `#C49420`; field nav bar `hsl(24 14% 11%)`; Select chevron stroke `#997b6b`.

Base layer: `* { @apply border-border }`, `html { -webkit-text-size-adjust: 100% }`,
`body { @apply bg-background text-foreground antialiased }`.

### 6.2 Typography

- Font stack (body): `ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`. No web fonts.
- Sizes in use: page titles admin `text-xl font-semibold`; card titles `text-base font-bold leading-tight tracking-tight`;
  section headers `text-base font-bold tracking-tight`; body `text-sm`; form inputs `text-base` (16 px, stops iOS zoom);
  labels `text-sm font-semibold`; meta `text-xs text-muted-foreground`; badges `text-[11px] font-semibold`;
  figures `text-xl font-extrabold tabular-nums`; `.stat-value` `text-2xl font-semibold tabular-nums`;
  `.stat-label` and `.field-label` `text-xs font-semibold|medium uppercase tracking-wide text-muted-foreground`;
  brand wordmark `text-xl font-extrabold tracking-tight`.
- All numbers and times use `tabular-nums`.

### 6.3 Component classes (`@layer components`)

| Class | Definition |
|---|---|
| `.surface` | `rounded-3xl bg-card shadow-[0_10px_30px_-18px_rgb(24_18_14/0.35)]` |
| `.brand-surface` | `rounded-3xl text-white`, `linear-gradient(150deg, hsl(var(--brand)) 0%, hsl(var(--brand-deep)) 100%)` |
| `.icon-tile` | `flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-tint text-brand` |
| `.stat` | `surface p-4` |
| `.stat-value` | `text-2xl font-semibold tabular-nums` |
| `.stat-label` | `text-xs font-medium uppercase tracking-wide text-muted-foreground` |
| `.hatch` | `repeating-linear-gradient(135deg, rgb(255 255 255 / 0.28) 0 2px, transparent 2px 7px)` over filled bars |
| `.field-label` | `text-xs font-semibold uppercase tracking-wide text-muted-foreground` |
| `.safe-top` | `padding-top: max(env(safe-area-inset-top, 0px), 0.5rem)` |
| `.safe-bottom` | `padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 0.5rem)` |
| `.no-scrollbar` | hides scrollbars (day strip, card rails) |

Radii summary: base `--radius` 20 px; Tailwind `lg` 20 px, `md` 14 px, `sm` 10 px, `4xl` 32 px.
Shadows: `shadow-soft`, `shadow-lift` (brand-tinted, on primary buttons and active chips).
Animation: `animate-fade-up` (0.25 s ease-out, 6 px rise) for pop-overs; `animate-pulse` for skeletons.

### 6.4 Chart palette

`src/lib/chart-colours.ts` (Attendance, Analytics, Overview):

| Name | Hex |
|---|---|
| `ON_TIME` | `#d1511a` |
| `LATE` | `#c98500` |
| `NOT_IN` | `#8a3a12` |
| `ORANGE.main` | `#d1511a` |
| `ORANGE.deep` | `#9b3517` |
| `ORANGE.light` | `#e8833a` |
| `ORANGE.dark` | `#52281a` |
| `ORANGE.pale` | `#f2b48a` |
| `ORANGE.track` | `#f6e4d8` |
| `DAY_COLOUR` | on_time = main, late = pale, off_site = deep, absent = dark, off = `#e7e3df` (day off, neutral), leave = track (approved leave) |

Attendance calendar squares: off is `#e7e3df` with text `#6f6862` and the mark "–"; leave is track with text
deep, an inset 1 px pale ring and the mark "Lv" (`attendance-grid.tsx`).

**Staff calendar marks** (`src/components/field/calendar-marks.tsx`, used by the home week row, the History day
strip and the month calendar): worked = bordered card (brand "•"); missed = `bg-destructive/12`, red text, inset red
ring at 50 %, word "Missed"; off = `bg-muted`, muted text, word "Off"; leave = `#fbe4d3` fill, brand-deep text, inset
`#f2b48a` ring, word "Leave"; plain = bordered, muted. Every mark carries its word and an aria label; a legend
(Clocked in, Missed, Day off, Leave) sits under each calendar.

`src/lib/metrics/colours.ts` (X Metrics): `BRAND #d1511a`, `SOLD #9b3517`, `SUPPLIED #e8833a`,
`DEEP #9b3517`, `TRACK #f6e4d8`.

Rule: only shades of the brand orange. Colour is never the only signal: every chart prints its
figures (gold-ish shades fail 3:1 contrast on white), calendars mark each day with a letter, metrics
charts also show numbers on hover and as a table. Charts are hand-built (SVG/CSS), not a library.

### 6.5 UI kit (`src/components/ui`)

All use `cn()` = `twMerge(clsx(...))` from `src/lib/utils.ts`.

**Button** (`button.tsx`, cva). Base: `inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]`.

| Variant | Classes |
|---|---|
| `default` | `bg-brand text-primary-foreground shadow-lift hover:bg-brand-deep` |
| `deep` | `bg-brand-deep text-primary-foreground hover:bg-brand` |
| `destructive` | `bg-destructive text-destructive-foreground hover:brightness-95` |
| `outline` | `border border-input bg-card text-foreground hover:bg-tint hover:text-tint-foreground` |
| `secondary` | `bg-tint text-tint-foreground hover:brightness-95` |
| `ghost` | `text-muted-foreground hover:bg-tint hover:text-tint-foreground` |
| `onBrand` | `bg-white/15 text-white backdrop-blur hover:bg-white/25` |
| `link` | `text-brand underline-offset-4 hover:underline` |

| Size | Classes |
|---|---|
| `default` | `h-11 rounded-2xl px-4 text-sm` |
| `sm` | `h-9 rounded-xl px-3 text-xs` |
| `lg` | `h-12 rounded-2xl px-6 text-sm` |
| `xl` | `h-14 rounded-2xl px-6 text-base` |
| `pill` | `h-9 rounded-full px-4 text-xs` |
| `icon` | `h-10 w-10 rounded-2xl` |
| `iconSm` | `h-9 w-9 rounded-xl` |

`buttonVariants` is exported for links styled as buttons. `forwardRef`, `displayName = 'Button'`.

**Badge** (`badge.tsx`). Base `inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold leading-none`.
Variants: `default` `bg-tint text-tint-foreground`; `brand` `bg-brand text-primary-foreground`;
`success` `bg-success/12 text-success`; `warning` `bg-warning/15 text-warning`;
`destructive` `bg-destructive/12 text-destructive`; `outline` `border border-border text-muted-foreground`;
`onBrand` `bg-white/20 text-white`.

**Alert** (`alert.tsx`). Base `rounded-2xl border p-4 text-sm`. Variants: `default` `border-border bg-card text-foreground`;
`info` `border-brand/20 bg-tint text-tint-foreground`; `success` `border-success/25 bg-success/10 text-foreground`;
`warning` `border-warning/30 bg-warning/12 text-foreground`; `destructive` `border-destructive/25 bg-destructive/10 text-foreground`.
`role="alert"` + `aria-live="assertive"` for destructive, else `role="status"` + `polite`.

**Card** (`card.tsx`): `Card` = `surface text-card-foreground`; `CardHeader` `flex flex-col space-y-1 p-5 pb-3`;
`CardTitle` (h3) `text-base font-bold leading-tight tracking-tight`; `CardDescription` `text-sm text-muted-foreground`;
`CardContent` `p-5 pt-0`; `CardFooter` `flex items-center p-5 pt-0`.

**Chip / ChipLink** (`chip.tsx`): `h-9 shrink-0 rounded-full px-4 text-xs font-semibold transition-all` (+ `active:scale-95` on the button);
active `bg-brand text-primary-foreground shadow-lift`; inactive `bg-tint text-tint-foreground hover:brightness-95`.
Button has `type="button"` and `aria-pressed`.

**Input**: `flex h-12 w-full rounded-2xl border border-input bg-card px-4 text-base text-foreground placeholder:text-muted-foreground focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25 disabled:cursor-not-allowed disabled:opacity-50`.

**Textarea**: same family, `min-h-[92px] py-3`.

**Select**: a **native** `<select>` (no JS combobox: low-end phones). `h-12 rounded-2xl … px-4 pr-9 text-base appearance-none`,
inline SVG chevron background (stroke `#997b6b`, width 2.5) at `right 0.9rem center`, size 1rem.

**Label**: `text-sm font-semibold leading-none text-foreground`.

**Skeleton**: `animate-pulse rounded-2xl bg-muted`; `SkeletonRows({ rows = 5 })` → `h-16 w-full` blocks, `space-y-2`. No blank loading screens.

**Table**: wrapper `w-full overflow-x-auto` (the only place horizontal scroll is allowed, and only inside the wrapper);
`table` `w-full caption-bottom text-sm`; `TableRow` `border-b border-border transition-colors hover:bg-muted/40`;
`TableHead` `h-10 whitespace-nowrap px-3 text-left align-middle text-xs font-semibold uppercase tracking-wide text-muted-foreground`;
`TableCell` `px-3 py-2.5 align-middle`. (Note: `TableHeader/Body/Row/Head/Cell` spread props after `className`, so a caller's
`className` replaces the default classes rather than merging. Reproduce this exactly or merge deliberately.)

### 6.6 Layout patterns

**Field shell** (`src/app/field/layout.tsx`): `field-shell min-h-dvh bg-background` →
`mx-auto flex min-h-dvh w-full max-w-md flex-col overflow-x-hidden` → `main.flex-1 px-4 pb-28 pt-4`
(bottom padding clears the floating nav). Includes `NamePlace` banner when a place must be named,
`PhoneBeacon`, `NativeBridge`, `FieldNav`.

**Field nav** (`field-nav.tsx`): `fixed inset-x-0 bottom-0 z-30 px-4 pb-2 safe-bottom`; inner bar
`max-w-md rounded-full bg-[hsl(24_14%_11%)] p-1.5 shadow-[0_18px_40px_-16px_rgb(24_18_14/0.6)]`. Tabs: Home `/field`,
History `/field/history`, Report `/field/report` (marketer/admin), Count `/field/count` (only while a count is due),
Metrics `/field/metrics` (store in X Metrics), You `/field/account`. Each `h-12 rounded-full`; active
`flex-[2] bg-white px-4 text-foreground` with label and brand-coloured icon (stroke 2.3); inactive
`w-12 flex-1 bg-white/10 text-white/75`, icon only (stroke 1.9).

**Field home header** (`greeting-header.tsx`): `safe-top`; 56 px avatar circle (`h-14 w-14 rounded-full bg-brand ring-4 ring-card`,
initials or photo, opens a `surface animate-fade-up` menu `w-56`), "Hi {firstName}" (`text-[15px] text-muted-foreground`)
over a bold subtitle, 48 px round bell button to `/field/account`.

**Field "screen" header** (`SheetScreen` in `screen.tsx`): bleeds to the edges (`-mx-4 -mt-4`); brand block
`bg-brand px-4 pb-14 pt-4 text-white safe-top` with optional 36 px back button (`rounded-xl bg-white/15`, ArrowLeft),
centred `h1 text-base font-bold`, a 36 px action slot, optional header content (`mt-5 space-y-4`, e.g. `HeaderField`
label `text-xs uppercase text-white/70` + value `text-sm text-white/95`). Below, a white sheet lifted over it:
`-mt-8 min-h-[40vh] rounded-t-[2rem] bg-background px-4 pb-4 pt-6`. `SectionHeader` = `text-base font-bold tracking-tight` + action.

**Admin frame** (`admin-frame.tsx`): `admin-shell min-h-dvh bg-canvas`. Desktop (`lg`): sticky left sidebar `w-64 h-dvh border-r bg-card`
with brand (36 px `brand-surface rounded-xl` mark + "Xtend"), nav, an "Ask Xtend" promo card (hidden when viewport height ≤ 1150 px), sign out.
Top bar: staff search GET form to `/admin/users?q=` (`h-11 max-w-sm rounded-xl`), 44 px square bell
(`h-11 w-11 rounded-xl border border-border/80 bg-card`) with a brand count bubble (`99+` cap), name/role pill with initials,
"Add staff" → `/admin/users?new=1`. Phone/tablet: sticky top header `bg-background/95 backdrop-blur` with brand, bell,
sign out and the menu as a drop-down. Content `main.w-full px-4 py-6 pb-24 lg:px-6 lg:pt-4`.

**Admin page head**: `<div><h1 className="text-xl font-semibold">Title</h1><p className="text-sm text-muted-foreground">One or two sentences on what the page shows, its rules, and that times are Lagos time.</p></div>` inside `space-y-5`.

**Figure cards** (repeated per page, e.g. `Figure` in `admin/attendance/page.tsx`, `visit-views.tsx`):
`surface p-4`; label `text-xs font-medium text-muted-foreground`; value `mt-1 text-xl font-extrabold tabular-nums`
(`text-destructive` when `warn`); optional note `text-[11px]|text-xs text-muted-foreground`; linked variant adds
`hover:ring-1 hover:ring-brand/40` and "Show them →" in `text-xs font-semibold text-brand`.

**Filter forms** (`attendance-filters.tsx`, `visit-filters.tsx`): a plain `<form method="get">` so the URL holds the whole
view and downloads match the screen. Fields in `flex flex-wrap items-end gap-3`: date inputs `h-10 w-40`, native selects
`h-10 text-sm` widths `sm:w-52/48/44/40`, `'all'` as the "any" option, inactive staff in an `<optgroup label="Switched off">`,
a checkbox with `accent-[hsl(var(--brand))]`, submit `buttonVariants({ size: 'sm' })` "Show".
Preset chips under it: "Quick:" then links (`rounded-full border border-border bg-card px-3 py-1 font-semibold hover:border-brand hover:bg-tint`,
active `border-brand bg-brand text-primary-foreground`), and "Clear filters" when narrowed. Presets from `presets(today, keys)`
in `src/lib/attendance-report.ts`: `today`, `yesterday`, `week` (Monday→today), `last_week`, `7d`, `30d`, `90d`, `month`, `last_month`.
Attendance uses today, yesterday, week, 7d, 30d, month; Analytics uses week, last_week, 7d, 30d, month, last_month, 90d.
Export menu: a `<details>` "Export" pill with a 256 px pop-over listing Excel / PDF / Word / CSV links to `<base>/<format>?<query>`.

**Expandable rows** (`attendance-table.tsx`): one `expanded` key in state. Phones (`md:hidden`): a `surface p-3` card per row, whole card a
button, ChevronDown rotating 180° when open, detail below a `border-t pt-3`. Desktop (`md:block`): a `Table`; clicking the row toggles
an extra `TableRow` (`bg-muted/30`, `colSpan` all columns) with the detail. Photos are fetched as short-lived signed links only on open.
Paging: `PAGE = 100` rows, "Show more" `outline sm` button. Smaller "more" sections use native `<details>` with a
`cursor-pointer font-semibold text-muted-foreground` summary.

**Status badges** (attendance): `Clock-out only`/`Absent`/`Flagged`/`Off site` destructive; `Late <n>`/`No clock-out` warning;
`On time` success; `On shift` and `Sent <n> later` outline.

### 6.7 Icons and brand marks

`lucide-react` only, sized `h-4 w-4` inline, `h-5 w-5` in nav/headers, `h-[18px] w-[18px]` in the admin bell, `h-3.5 w-3.5` in pills.
Brand: `XpelMark` (`src/components/brand/logo.tsx`) SVG with gradient `#C1572A`→`#C49420` (`tone="brand"`) or white (`tone="light"`);
PNGs in `public/brand/`.

### 6.8 Mobile rules

- Design width 390 px; field screens are `max-w-md` (448 px) centred, `overflow-x-hidden`; nothing may scroll sideways
  except inside a `Table` wrapper or a `.no-scrollbar` rail (day strip, chip rails with `shrink-0` children).
- Respect safe areas with `.safe-top` / `.safe-bottom` (viewport `viewport-fit=cover`, iOS status bar translucent).
- Tap targets ≥ 36 px (buttons 44 px default, nav 48 px, shutter 80 px). Inputs 16 px text.
- Use `min-h-dvh`, never `100vh`.
- Pinch zoom stays enabled.

### 6.9 Dark mode

None. `darkMode: ['class']` is configured but no `.dark` class is ever set and there are no dark token values; two stray
`dark:` utilities exist (`journey-strip.tsx`, `phone-check.tsx`) and have no effect. Build light only.

### 6.10 Writing style

General: plain, short English for Nigerian staff; Lagos time everywhere (`Africa/Lagos`, `formatLagos` uses `en-NG`, 24-hour);
`—` for an empty value; distances `"<n> m"` under 1000 else `"<n.n> km"`. Sentences end with a full stop and tell the
person what to do next. Never blame; never expose database or service wording (that is why `dbErrorMessage` exists).

| Audience | Voice | Must not | Examples (from the code) |
|---|---|---|---|
| Staff (merchandisers, marketers) | Second person, warm, one instruction at a time, everyday words ("phone", "store", "photo") | Mention monitoring: location checks during the shift, integrity flags, alerts, VPN/fake-GPS detection, supervisors being told, anything "recorded" or "reviewed" | "The photo is too dark. Move to better light, or face the light, and try again." · "Camera permission is off. Allow the camera for this site, then try again." · "Taken live in the app. Photos from your gallery, or of a screen or a printed photo, are rejected." · "Urgent and on shift? Call your supervisor as well." · "Please log in again for today." |
| Supervisors | Practical, team-scoped ("your team"), how-to, short examples of questions to ask | Admin-only powers; claims about other teams | "Short on time? Ask Xtend: “who on my team has not clocked in?”, “who was late this week?”." · "Overview shows your team today: clocked in, late, not in their store, not in yet, and open alerts, with the week at a glance." |
| Admins | Complete and exact, names the rules and thresholds, explains what is monitored and why | Nothing withheld; this is where monitoring is documented | "Worth a look points out impossible jumps (faster than 150 km/h, which a fake-location app makes), long silences … and long stays away." · Attendance page lead: "Who came, when, and where, day by day … Times are Lagos time; clock records cannot be changed or deleted." |

UI names in guides are wrapped in `<Ui>` (bold); tips in `<Tip>`. Staff guide: `src/components/staff-guide.tsx`
(also served at `/guide` and `/field/guide`); supervisor guide `src/app/admin/supervisor-guide/page.tsx`;
admin guide `src/app/admin/guide/page.tsx`. Notification titles are `"<Name>: <what happened>"`; bodies end with
where to act ("Open Support to reply.").

---

## 7. Exports (`src/lib/export/render.ts`)

### 7.1 The `Sheet` contract

```ts
interface ExportRow { values: string[]; link?: string | null }
interface Sheet {
  title: string; subtitle: string; notes?: string; wrap?: boolean;
  sheetName: string; columns: readonly string[]; rows: ExportRow[];
  widths: { xlsx: number[]; pdf: number[] };   // Excel characters / PDF points
  linkColumn?: number; linkText?: string; noLinkText?: string;
  statusColumn?: number;                         // red when value !== 'on_site'
  fileBase: string;
}
renderExport(format: 'xlsx' | 'docx' | 'pdf' | 'csv', sheet) → Response
// any other format → ApiError('Unsupported export format', 400)
```

Response headers: `Content-Type` per format, `Content-Disposition: attachment; filename="<name>"`, `Cache-Control: no-store`.
File name: `exportFileName(base, ext)` = `` `${base}-${new Date().toISOString().slice(0, 10)}.${ext}` `` (UTC date).
Routes are `/api/admin/export/<kind>/[format]` (see routes.md), each audited (e.g. `export.movement.<format>`).

Colour constants: `BRAND = 'FFC1572A'` (header fill), `LINK = 'FFC2410C'`.

### 7.2 CSV

Every cell double-quoted with `"` doubled; rows joined with `\r\n`; a UTF-8 BOM (`﻿`) prefixed so Excel on
Windows reads UTF-8. `text/csv; charset=utf-8`. Links are not special: the link column carries the URL text.

### 7.3 Excel (ExcelJS, dynamic import)

- `creator = 'Xtend'`, `created = now`.
- If `notes`: first sheet "Summary", column 1 width 110; row 1 title bold size 14; row 2 subtitle italic colour `FF6B6B72`;
  blank row; one row per note line, `wrapText`, top-aligned.
- Data sheet `sheetName`, frozen first row (`views: [{ state: 'frozen', ySplit: 1 }]`). Header row solid fill `FFC1572A`,
  bold white font. Link column cells become `{ text: linkText ?? 'Open selfie', hyperlink }` in `FFC2410C` underlined.
  Status column cells not `on_site` → bold `FFB91C1C`. Column widths from `widths.xlsx` (default 18).
  `autoFilter` across the header row.
- MIME `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.

### 7.4 Word (`docx`)

Heading 1 title; italic subtitle size 16 (half-points = 8 pt); each non-empty notes line a paragraph size 20 (10 pt) with
`spacing.after = 120`; a full-width table (100 % PERCENTAGE) with a repeating header row (`tableHeader: true`, bold size 16) and
body cells size 16; the link column uses `ExternalHyperlink` with style `Hyperlink` and `linkText ?? 'Open selfie'`.
MIME `application/vnd.openxmlformats-officedocument.wordprocessingml.document`.

### 7.5 PDF (`pdf-lib`)

- A4 landscape `842 × 595` pt, margin 24, fonts Helvetica and Helvetica-Bold (standard fonts).
- Title size 12 bold at `y = 595 − 24 − 4`; subtitle size 7, colour rgb(0.4, 0.4, 0.45) at `y − 13`; header row starts 32 pt below the top margin.
- Notes on the first page only: size 9, line height 12, wrapped to the page width, blank lines add 6 pt; header follows 10 pt below.
- Table text size 7, line height 11. Column widths from `widths.pdf` (default 60). Header bold.
- Text sanitiser: `₦` → `NGN `; anything outside WinAnsi-safe ranges removed (keeps ASCII, Latin-1, en/em dashes, curly quotes, bullet, ellipsis, €); whitespace collapsed.
- Cells: without `wrap` (and always for header and link column) truncated to `floor((width − 4) / 3.5)` chars with `…`.
  With `wrap`, greedy word wrap (breaking over-long words), max 8 lines per cell, last line ending in `…`. Wrapped rows get 3 pt extra spacing.
- Link column: `linkText ?? 'Open selfie'` in rgb(0.11, 0.31, 0.85) with a hand-built `/Annot /Link` URI annotation
  (rect `x, y−2, x+width−4, y+7+2`, no border); no link → `noLinkText ?? 'expired'` in rgb(0.45, 0.45, 0.5).
- Status column not `on_site` → rgb(0.7, 0.1, 0.1); other text rgb(0.1, 0.1, 0.12).
- New page (with title, subtitle and header repeated, no notes) when the next row would cross the bottom margin.

### 7.6 Sheets defined

| Export | `sheetName` | `fileBase` | Link column | Status col | Wrap | Widths xlsx / pdf |
|---|---|---|---|---|---|---|
| Attendance events (`export/data.ts`) | Attendance | `xtend-attendance` | last (selfie, signed URL 3600 s; text "deleted after 14 days" when gone) | 8 | no | `[24,12,10,18,22,42,18,12,12,16]` / `[98,58,48,66,96,190,60,48,54,58]` |
| Attendance days (`attendance-days.ts`) | Days | `xtend-attendance-days` | last, `linkText: 'Map'`, `noLinkText: ''` | — | yes | `[12,24,16,18,24,10,9,10,9,12,11,28,42,10]` / `[46,70,50,52,66,38,32,36,34,46,38,72,154,30]` |
| Analytics | Analytics | `xtend-analytics-by-<person\|store\|team>` | — | — | — | `[28,13,10,10,11,8,10,14,10,13,13,16]` / `[150,60,54,54,58,44,54,72,54,62,62,70]` |
| Store visits (`visits.ts`) | Store visits | `xtend-store-visits` | last | 8 | yes | `[20,11,26,14,22,12,16,12,12,14,12,16,34,34,26,15]` / `[62,42,78,38,62,36,44,30,34,40,34,40,80,80,54,40]` |
| Store coverage | Store coverage | `xtend-store-coverage` | — | — | yes | `[30,40,14,20,10,22,14]` / `[150,200,60,90,50,110,70]` |
| Alerts (`alerts.ts`) | Alerts | `xtend-alerts` | — | — | yes | `[22,16,22,34,18,14,40,12,22,20,40]` / `[70,60,70,100,62,44,110,40,66,60,112]` |
| Movement (route) | Journey | `xtend-movement-<name slug>` | 7, `'Open map'`, `''` | — | yes | `[18,8,12,16,34,10,10,10]` / `[110,50,70,100,240,70,70,60]` |
| X Metrics grades (`metrics/export.ts`) | Grades | `xmetrics-grades-<YYYY-MM>` | — | — | yes | `[26,8,10,8,14,10,12,8,36]` / `[120,40,55,40,70,50,60,40,160]` |
| X Metrics stock | Stock | `xmetrics-stock` | — | — | — | `[24,24,12,10,12,10,8,9,12,12]` / `[110,110,55,50,60,50,40,45,55,60]` |
| X Metrics reconciliation | Reconciliation | `xmetrics-reconciliation-<YYYY-MM>` | — | — | — | `[11,22,20,22,9,9,8,9,9,8,8,14]` / `[52,90,80,90,40,40,35,42,42,35,40,60]` |
| X Metrics supplies | Supplies | `xmetrics-supplies-<YYYY-MM>` | — | — | yes | `[11,22,22,9,11,10,11,20,30,20]` / `[50,90,90,40,50,45,52,80,105,75]` |
| Ask Xtend reports (`assistant-report.ts`) | per kind | `xtend-<kind with _ → ->` | per kind | — | — | per kind |

Integrity and audit exports exist too (`/api/admin/export/integrity`, `/audit`); they use the same renderer.
Attendance subtitle text: `"<n> record(s). Times are Africa/Lagos. Clock photos are deleted 14 days after capture; links to the ones still held expire an hour after this file was made."`
Attendance days filter line now ends "days off and leave are not absences" (no Sundays wording); its status words
include "Day off" and "On leave".

### 7.7 Marketer reports (designed files, not the `Sheet` renderer)

One person's day or month report (`MarketerReport`, built by
`buildMarketerReport` in `src/lib/marketer-report.ts`; page and rules in
`20-admin-dashboard.md`, Marketer reports). Route `GET
/api/admin/export/marketer-report/[format]` (`pdf | docx | xlsx`, anything
else 400 "Unsupported export format"), `renderMarketerReport()` in
`src/lib/export/marketer-report.ts`: `Content-Disposition: attachment;
filename="<fileBase>.<format>"` with `fileBase` =
`xtend-report-<name slug ≤ 40>-<YYYY-MM-DD | YYYY-MM>` (no export date
suffix, unlike `exportFileName`), `Cache-Control: no-store`. Audited
`export.marketer_report.<format>`.

**Logo** (`src/lib/export/brand-logo.ts`): the Xpel Beauty logo
(`public/brand/xpel-logo.png`, 300 px wide) inlined as base64 in
`XPEL_LOGO_PNG` with `XPEL_LOGO_RATIO` (width ÷ height), so the function
that draws a file does not depend on the public folder being deployed.

**Colours** (all three files): brand `#d1511a`, deep `#9b3517`, light
`#e8833a`, dark `#52281a`, peach `#f2b48a`, track `#f6e4d8`, stripe
`#fcf3ed`, wash `#fdf8f4`, text `#2b211c`, muted `#7c6c63`.

**PDF** (`marketer-report-pdf.ts`, pdf-lib, dynamic import):

- A4 **portrait** 595.28 × 841.89 pt, margin 40; Helvetica, Helvetica-Bold,
  Helvetica-Oblique; text through `pdfSafe` (`₦` → `NGN `, `→` → `->`,
  anything outside WinAnsi dropped, spaces collapsed). Metadata: title
  "`<name>` — `<Day report|Month report>`, `<period>`", author "Xtend",
  creator "Xtend · Xpel Beauty".
- **Brand bar** on every page: a 5 pt strip across the top, brand, with
  the last 28 % in light orange.
- First page header: the logo 46 pt tall at the left; right-aligned
  "MARKETER REPORT" (8.5 pt bold brand), the period (17 pt bold dark: "Friday
  16 October 2026" or "October 2026"), "`<kind>`  ·  Lagos time" (muted).
  Then the **person card** (rounded, wash fill, track border, a 3 pt brand
  bar on the left): name 16 pt bold; "Role   ·   Supervisor: X (or No
  supervisor)   ·   Home store: Y"; right "GENERATED" over the time.
- **8 tiles**, four to a row (48 pt tall, white, peach border): label in
  small caps muted, value 14 pt bold deep, optional note (Days worked "of N
  working days" on a month). Then the **summary** sentence in a track box
  with a 4 pt brand bar.
- Section headings 12.5 pt bold brand with a right-hand note; tables with a
  brand header row (white bold), striped rows, an address as a second grey
  line under a store, away/unclear arrivals and late/missing values in deep
  orange, empty sections as italic muted lines.
- **Day report**: "Clock in and out" (Time, Status, Where: rows Clock in /
  Clock out; "Did not clock in"), "Store visits" with "`<t>` in stores"
  (Store, Checked in, Checked out, Time in store, Arrived, Time before) or
  "No store visits recorded on this day.", "Daily report" with "Filed at
  HH:MM" (label column, then the text; empty sections italic "Nothing
  reported.") or "No daily report was filed for this day.", then Stock
  counts (Store, Product, In store, Sold) and X Metrics sales (Store,
  Product, Units, with a Total row) when any.
- **Month report**: "Day by day" (Date, Clock in, Clock out, Stores, Visits,
  Time in stores, Report; days with nothing muted; a "Month" total row:
  "N in", "N missing", stores, visits, time, "N filed"), "Stores visited"
  (Store, Visits, Total time, Last visit) or "No store visits recorded this
  month.", then "Each day in detail": per active day a track bar with the
  long date and chips "In HH:MM · Out HH:MM · N stores · time · Report
  filed|No report", the day summary, a compact visits table, the report
  and the extras; none: "Nothing was recorded this month."
- Pages after the first: the logo 20 pt tall, right "`<name>`  ·
  `<kind>`, `<period>`", a peach rule. **Footer** on every page: peach rule;
  "Xtend  ·  Xpel Beauty  ·  `<name>`, `<day report|month report>` for
  `<period>`" left, "Page i of n" bold brand right.

**Word** (`marketer-report-docx.ts`, `docx`): the same content and order
as the PDF, A4 portrait (11906 × 16838 twips, 18 mm margins), Arial 9 pt,
the logo, tiles as a four-column table, brand tables; running header
right-aligned "`<name>`  ·  `<kind>`, `<period>`" over a peach rule; footer
the same left text as the PDF and "Page N of M" (PageNumber fields) in bold
brand.

**Excel** (`marketer-report-xlsx.ts`, ExcelJS): sheet **Summary** (no
gridlines, A4 fit to width; the logo at the top right; "MARKETER REPORT",
the period, "`<kind>` · Lagos time · generated `<time>`"; Name, Role,
Supervisor, Home store, Period; "Summary" with the tiles two to a row and
the summary sentence in a track box), then detail sheets with a frozen
brand header row, striped rows and an auto-filter: **Days** (Date, Day,
Clock in, Clock-in status, Clock out, Stores visited, Visits, Minutes in
stores, Time in stores, Report filed, Summary), **Store visits** (Date, #,
Store, Address, Checked in, Checked out, Minutes in store, Arrived, Minutes
since the last store), **Stores** (Store, Address, Visits, Minutes in
store, Total time, Last visit), **Daily reports** (Date, Filed at, How the
day went, Sales, Stock status, Competitor activity, Issues for the office),
and **Stock and sales** (Date, Kind "Stock count" | "X Metrics sale",
Store, Product, In store, Sold or units) only when there are any.

`scripts/check-marketer-reports.ts [out-dir]` builds a report from made-up
rows, checks the numbers and words, and that the three files come out
valid (with an out-dir it writes them there to look at).

---

## Acceptance checks

A rebuild matches this specification when all of the following hold.

**Skeleton**
1. `npx tsc --noEmit -p .` and `npx eslint src scripts --quiet` pass; `@/lib/auth` resolves to `src/lib/auth.ts`.
2. `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9 NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy npx next build` succeeds and the client bundle contains `NEXT_PUBLIC_BUILD_ID`.
3. `GET /sw.js` returns `Cache-Control: no-cache, no-store, must-revalidate` and `Service-Worker-Allowed: /`.
4. Signed out, `GET /field` redirects to `/login?next=/field`; `GET /guide`, `/download`, `/offline` load; `GET /api/attendance` returns JSON 401, not a redirect.
5. Signed in, `GET /login` redirects to `/`.
6. `vercel.json` has exactly the two crons in 1.9 (`purge-selfies` `20 2 * * *`, `absence-sweep` `30 8 * * *`, every day), and `.github/workflows/alerts-cron.yml` calls `/api/cron/alerts` every 5 minutes; a cron call without `Authorization: Bearer $CRON_SECRET` is refused, and every call is refused when `CRON_SECRET` is unset.

**Sessions**
7. A merchandiser who signed in yesterday is sent to `/api/auth/expired?reason=new-day`; an API call returns 401 `{ code: 'relogin' }`.
8. An unexpected exception in a route returns 500 `{ error: 'Something went wrong. Try again.' }`; a `P0001` SQL error message reaches the caller verbatim; a constraint error does not.
9. The 11th sign-in attempt for one identifier within 15 minutes returns 429.
10. With `TRUSTED_PROXY_HOPS=1` and `X-Forwarded-For: 1.1.1.1, 2.2.2.2`, the client IP is `2.2.2.2`.

**Integrations**
11. With no `ANTHROPIC_API_KEY`: photo checks return `unchecked` and allow; support threads escalate with the fallback reply; Ask Xtend shows its setup notice; invoice PDF import returns 400.
12. Photo check requests use `claude-opus-5`, `effort: 'low'`, a strict JSON schema and a cached system prompt; invoice reading uses `claude-opus-5-5`; both use beta `server-side-fallback-2026-07-01` with `fallbacks: 'default'`.
13. Ask Xtend stops after 10 tool rounds and never writes data except through an applied card.
14. Without `GOOGLE_MAPS_API_KEY`, place labels still resolve through Nominatim/Overpass, else to `"lat, lng"` with 5 decimals; a Google answer is reused for the same 4-decimal spot.
15. A push to a 410'd web subscription marks it gone; a `native-fcm:` endpoint goes to FCM v1 with `priority: HIGH` and `ttl: 43200s`; an endpoint on a non-push host is never sent to.

**Offline**
16. With the network off, a clock-in is stored in IndexedDB `xtend/outbox`; reconnecting flushes it oldest first, uploading the selfie before posting.
17. A 4xx (not 401/423) drops the job; a 5xx keeps it and stops the flush; a job older than 24 h (72 h for X Metrics) or with 8 attempts is dropped.
18. Navigating while offline shows `/offline`; `/_next/static` assets load from cache.
19. A selfie is ≤ 640 px wide and ≤ 150 KB where quality ≥ 0.35 allows, with a 200×200 thumbnail; a report photo ≤ 900 px and ≤ 220 KB.
20. A dark or blurry frame keeps the camera open with the matching hint; there is no file picker in any capture flow.

**Native**
21. The Android build has the permissions, service and boot receiver in 5.3; the tracker posts at least every 150 s while on shift, with `Authorization: Bearer <token>`, and stops on 401 or `{ stop: true }`.
22. `getNativeFix()` returns `is_mock`/`compromised`; clock-in `device_info.native` carries them.
23. The workflow publishes `xtend.apk` on release tag `android` named `Xtend for Android 1.0.<code>`, and `/api/version` reports that build.

**Design**
24. At 390 px wide, no field or admin page scrolls horizontally (tables scroll only inside their wrapper); the field nav clears the home indicator.
25. Every colour comes from the tokens in 6.1 or the palettes in 6.4; there is no dark theme.
26. Staff-facing text never mentions monitoring, flags, alerts or reviews; the admin guide does.

**Exports**
27. Each export downloads as `<fileBase>-<YYYY-MM-DD>.<ext>`; the Excel header row is filled `#C1572A` with white bold text and frozen; the PDF is A4 landscape and turns `₦` into `NGN `; CSV opens in Excel with correct accents (BOM present).
28. Link columns are clickable in Excel, Word and PDF; off-site statuses print red in Excel and PDF.
29. A marketer report downloads as `xtend-report-<name>-<date or month>.<pdf|docx|xlsx>` (no export-date suffix); the PDF is A4 portrait with the brand bar on every page, the Xpel logo, eight tiles and "Page i of n"; the Word file has the running header and page numbers; the Excel file has Summary, Days, Store visits, Stores and Daily reports sheets (and Stock and sales when there are any).
30. The logo in those files comes from `XPEL_LOGO_PNG` in code, so the files render even when `public/` is not deployed with the function.
31. Staff calendars show missed working days red, days off grey and leave soft orange, each with its word and a legend; the attendance calendar shows "–" grey for a day off and "Lv" soft orange for leave.


### VPS recovery (2026-10-21)

A failed PM2 reload or new-build health check enters rollback. A reload failure
cannot be masked by a successful pm2 save. The previous release is reloaded and
its build ID health-checked before reporting rollback success; otherwise the
script reports that manual recovery is required and exits nonzero.
