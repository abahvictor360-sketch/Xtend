# Running Xtend with Dokploy or Coolify (Hostinger VPS)

Dokploy and Coolify both build the repository's `Dockerfile` and put
Traefik (HTTPS, Let's Encrypt) in front of it. The database, sign-in,
storage and realtime stay on Supabase. This replaces the PM2 + Nginx setup
in `deploy/README.md`; use one or the other, not both.

## 1. Before anything: secure the server

Do these on the fresh VPS before installing the panel.

1. **Ubuntu 24.04**, KVM 2 (2 vCPU, 8 GB) for a pilot, KVM 4 for a few
   thousand staff. A European data centre (the database is in Ireland).
2. **SSH keys only.** Add your public key, then in `/etc/ssh/sshd_config`:
   `PasswordAuthentication no`, `PermitRootLogin prohibit-password`;
   `systemctl restart ssh`. Check you can still log in from a second
   terminal before closing the first.
3. **Automatic security updates:** `apt install -y unattended-upgrades fail2ban`.
4. **Firewall:** Hostinger's VPS firewall (hPanel → VPS → Security →
   Firewall) or `ufw`: allow **22, 80, 443** only. Docker publishes ports
   around `ufw`, so prefer Hostinger's firewall, or keep the panel port
   closed as below.
5. **The panel itself** (Dokploy listens on 3000, Coolify on 8000): sign up
   straight away (the first visitor becomes the owner), give the panel its
   own domain with HTTPS in its settings, turn on two-factor sign-in, then
   close the raw panel port in the firewall.

## 2. Install the panel

- **Dokploy:** `curl -sSL https://dokploy.com/install.sh | sh`
- **Coolify:** `curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash`

## 3. Create the app

- Source: GitHub, repository `abahvictor360-sketch/Xtend`, branch
  `claude/new-session-sgmxdg` (the main branch). Turn on auto-deploy on push.
- Build type: **Dockerfile** (`Dockerfile` at the root). Port **3000**.
  Dokploy defaults new apps to **Nixpacks**: change it (app → General →
  Build Type). A Nixpacks build is the wrong one for Xtend: it copies every
  environment variable, secrets included (service-role key, `CRON_SECRET`,
  the Anthropic and VAPID private keys), into the image as build `ARG`/`ENV`
  (Docker's `SecretsUsedInArgOrEnv` warnings), and without a Node version in
  the repo it picks Node 18, which `@supabase/supabase-js` no longer supports
  (`EBADENGINE`, "Node.js 20 and below are deprecated"). The Dockerfile takes
  only the `NEXT_PUBLIC_*` build arguments below and runs Node 22. As a net,
  `package.json` now says `"engines": {"node": ">=22"}` and `.nvmrc` says
  `22`, so a Nixpacks build also gets Node 22.
- Domain: e.g. `app.example.com`, HTTPS on (Let's Encrypt). Point the
  domain's A record at the VPS first.
- Health check: path `/api/health` (the image also has its own).

## 4. Settings

**Build arguments** (baked into the pages; set them as build args *and* as
environment variables):

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the anon (publishable) key |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | web push public key |
| `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` | optional; restrict it to your domain in Google Cloud |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | optional; the human check on sign-in (Cloudflare Turnstile), with `TURNSTILE_SECRET_KEY` in the environment |

The build stops with a clear message if the first two are missing.

**Environment variables** (runtime only, never in the image): everything in
`docs/BUILD_GUIDE.md` §7, at least `SUPABASE_SERVICE_ROLE_KEY`,
`CRON_SECRET` (a long random string: `openssl rand -hex 32`),
`VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, and the push, Google, Anthropic and
app-download settings you use. Plus:

| Name | Value |
|---|---|
| `TRUSTED_PROXY_HOPS` | `1` (Traefik in front, DNS only) |

Get the caller's address right: the audit log, the VPN checks and the
sign-in lockout read it. Traefik throws away any `X-Forwarded-For` a caller
sends and writes the real address, so with the domain's DNS record set to
**DNS only** (grey cloud in Cloudflare), `1` is correct and nobody can fake
their address. If you turn Cloudflare's proxy (orange cloud) on, Traefik
would see only Cloudflare: first add Cloudflare's address ranges to
Traefik's entry point `forwardedHeaders.trustedIPs` (Dokploy: Traefik file
system → `traefik.yml`; Coolify: Proxy configuration), then set `2`.

**Bots.** Xtend already refuses crawlers, scrapers and scripts itself
(`docs/BUILD_GUIDE.md` §4.8). For more, put Cloudflare's proxy in front as
above and turn on **Security → Bots → Bot Fight Mode**. The scheduled jobs
run inside the container (`node run-job.mjs`), so Cloudflare never sees
them; if the GitHub Actions alerts job still calls the site with curl and
starts getting 403, add a WAF skip rule for `/api/cron/` and `/api/track/`.
For the human check on sign-in, create a Turnstile widget (Cloudflare →
Turnstile → Add site, Managed) and set `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
(build argument and environment) and `TURNSTILE_SECRET_KEY` (environment).

## 5. Scheduled jobs

Add these as scheduled tasks on the app (Dokploy: the app's **Schedules**;
Coolify: **Scheduled Tasks**). Each runs inside the container and calls the
app on its own port with `CRON_SECRET`; nothing is exposed. Times are UTC.

| Schedule | Command |
|---|---|
| `*/5 * * * *` | `node run-job.mjs alerts` |
| `30 8 * * *` | `node run-job.mjs absence-sweep` |
| `20 2 * * *` | `node run-job.mjs purge-selfies` |

Then stop the other copies, or jobs run twice: set the GitHub repository
variable `JOBS_ON_VPS=true` (the five-minute GitHub workflow stands down),
and remove the crons from Vercel (or the Vercel project itself) once this
server is live.

## 6. Moving over

1. In Supabase, run any migration not yet run (the app says which number a
   page needs). As of November 2026: `0077_sign_in_lockout.sql`,
   `0078_function_grants.sql`, and the 0069 reminder constraint fix.
2. Supabase → Authentication → URL configuration: set the Site URL to the
   new domain.
3. The phone apps open the address in the repository variable `APP_URL`
   (default `https://xtend-brown.vercel.app`). Set `APP_URL` to the new
   domain and let the mobile workflow build new apps; keep the old address
   working until staff have the new app.
4. Check: `https://app.example.com/api/health` shows `"ok": true` and every
   `configured` value you expect as `true`; `curl -sI` on the login page
   shows the security headers and no `x-powered-by`.

## 7. Scaling and headers

- One container runs one Node process. For the 08:00 rush on a bigger VPS,
  run 2 or more replicas (Dokploy: Advanced → Replicas; Coolify: scale the
  service). The sign-in lockout is kept in the database, so it holds across
  replicas.
- The app already sends HSTS, `nosniff`, `X-Frame-Options: DENY`, a
  `frame-ancestors 'none'` policy, a referrer policy and a permissions
  policy, and no `X-Powered-By`. Traefik adds no `Server` header.
  `x-nextjs-cache` can be removed with a Traefik headers middleware
  (`customResponseHeaders: X-Nextjs-Cache: ""`); leave the other
  `x-nextjs-*` headers, which the browser's page router reads.
