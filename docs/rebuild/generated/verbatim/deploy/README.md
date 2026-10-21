# Running Xtend on a Hostinger VPS

Xtend runs on one Ubuntu VPS: Nginx in front, Next.js under PM2 (one process
per CPU core), the scheduled jobs in the server's crontab. The database,
sign-in, photo storage and realtime stay on Supabase. Every push to the main
branch deploys itself through GitHub Actions.

| File | What it does |
|---|---|
| `setup-server.sh` | One-time server setup (run as root) |
| `deploy.sh` | Builds a commit beside the live one, switches over when healthy, rolls back if not |
| `ecosystem.config.cjs` | PM2: cluster mode, one process per core, restarts, logs |
| `nginx/xtend.conf`, `nginx/xtend-proxy.conf` | The Nginx site and its proxy headers |
| `crontab`, `cron.sh` | The scheduled jobs, called on `127.0.0.1` |
| `../.github/workflows/deploy-vps.yml` | Deploys on every push to the main branch |

## 1. Choose the VPS

- **Location:** a European data centre (United Kingdom, France or the
  Netherlands). The Supabase database is in Ireland (`eu-west-1`), and every
  page makes several trips to it, so the server must be close to it.
- **Size:** about 2 vCPU and 8 GB (KVM 2) for a pilot of a few hundred staff;
  4 vCPU and 16 GB (KVM 4) up to a few thousand; 8 vCPU and 32 GB (KVM 8)
  toward 10,000. The 08:00 clock-in rush is the peak to size for: a VPS does
  not grow on its own.
- **System:** Ubuntu 24.04 (or 22.04), plain, no control panel.

## 2. Point the domain at it

at your DNS provider, add an **A record** for the address staff will use (your
example `app.example.com`) pointing at the VPS's IP address. Wait until it
resolves (`ping app.example.com` shows the VPS address).

## 3. Set up the server (once)

Log in as root (Hostinger's browser terminal or `ssh root@<ip>`), copy
`deploy/setup-server.sh` over (or download it from GitHub), then:

```bash
bash setup-server.sh app.example.com you@example.com git@github.com:abahvictor360-sketch/Xtend.git
```

It installs Node 22, PM2, Nginx and certbot. Then it:

- creates the `xtend` user and `/var/www/xtend`;
- opens only SSH and web traffic in the firewall;
- turns on automatic security updates;
- adds 4 GB of swap;
- sets the clock to UTC;
- gets the HTTPS certificate;
- installs the scheduled jobs.

When it shows a **deploy key**, add it in GitHub: **Settings → Deploy keys →
Add deploy key**, read access only, then press Enter. Running the script again
is safe.

## 4. Fill in the settings

```bash
nano /var/www/xtend/shared/.env.production
```

It starts as a copy of `.env.example`. Fill in every variable from section 7
of `docs/BUILD_GUIDE.md`: the Supabase keys, `CRON_SECRET`, the VAPID keys,
and the push and AI keys you use. Notes:

- Keep `TRUSTED_PROXY_HOPS=1`. Use 2 if Cloudflare is in front of the server.
- `NEXT_PUBLIC_…` values are built into the pages, so a change to one needs a
  deploy, not just a restart.

## 5. First deploy

```bash
sudo -u xtend -H bash /var/www/xtend/repo/deploy/deploy.sh
```

It takes a few minutes. When it prints `live: <build>`, open
`https://app.example.com`. If Xtend has no admin yet, create one with the
bootstrap script (`docs/BUILD_GUIDE.md` §4.3).

## 6. Deploy on every push

Make a key pair on your own computer:

```bash
ssh-keygen -t ed25519 -N "" -f xtend-deploy
```

1. On the server, append `xtend-deploy.pub` to
   `/home/xtend/.ssh/authorized_keys`. Create the file if it does not exist;
   it must be owned by `xtend` and have mode `600`.
2. In GitHub, go to **Settings → Secrets and variables → Actions**:
   - **Secrets:** `VPS_HOST` (the server's IP or domain), `VPS_SSH_KEY` (the
     whole private key file `xtend-deploy`). Optional: `VPS_PORT` (default
     22) and `VPS_USER` (default `xtend`).
   - **Variables:**
     - `APP_URL` = `https://app.example.com`: the phone apps open this
       address from their next build.
     - `JOBS_ON_VPS` = `true`: the GitHub alerts job stands down, because the
       server runs it now.

From then on, every push to the main branch builds and goes live with no
downtime. To roll back, run **Actions → Deploy to VPS → Run workflow** with
an older commit, or on the server:

```bash
sudo -u xtend -H bash /var/www/xtend/repo/deploy/deploy.sh <commit>
```

## 7. Move the phones over

The Android and iPhone apps open `APP_URL`. After setting it, the next app
build points at the server, and staff get it as an app update. Keep the old
address working (Vercel, or a redirect) until everyone has updated. Then turn
the old one off.

## Day to day

| To | Run (as root, or prefix `sudo -u xtend -H`) |
|---|---|
| See the app's state | `pm2 status` |
| Read the app's logs | `pm2 logs xtend` or `/var/www/xtend/shared/logs/` |
| Read failed scheduled jobs | `tail /var/www/xtend/shared/logs/cron.log` |
| Restart after changing a server-only setting | `pm2 reload xtend --update-env` |
| Check the live build | `curl -s http://127.0.0.1:3000/api/version` |
| Renew HTTPS (automatic; to test) | `certbot renew --dry-run` |

Set up Hostinger's backups or snapshots for the VPS. The data itself is in
Supabase, so also turn on Supabase backups (point-in-time recovery on the Pro
plan).


Recovery checks: both PM2 reload failures and failed new-build health checks
trigger rollback. The script verifies the previous build before reporting
successful rollback; if that fails, it reports manual recovery is required.
Run `npx tsx --tsconfig tsconfig.scripts.json scripts/check-deploy.ts` locally
to exercise these paths with mocked server commands.
