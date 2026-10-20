#!/usr/bin/env bash
# One-time setup of a fresh Hostinger VPS (Ubuntu 22.04 or 24.04) for Xtend.
# Run as root, after pointing the domain's DNS A record at the VPS:
#
#   curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/<branch>/deploy/setup-server.sh -o setup.sh
#   bash setup.sh app.example.com you@example.com git@github.com:<owner>/<repo>.git
#
# or copy this file over with scp. It installs Node 22, PM2, Nginx and
# certbot, creates the xtend user and folders, opens only SSH and web
# traffic, turns on automatic security updates, adds swap for builds, sets
# the clock to UTC, installs the scheduled jobs and prints a deploy key to
# add to GitHub. Safe to run again. Full steps: deploy/README.md.
set -euo pipefail

DOMAIN="${1:?usage: setup-server.sh <domain> <email for HTTPS notices> <git ssh url>}"
EMAIL="${2:?usage: setup-server.sh <domain> <email> <git ssh url>}"
REPO_URL="${3:?usage: setup-server.sh <domain> <email> <git ssh url>}"
BRANCH="${XTEND_BRANCH:-claude/new-session-sgmxdg}"
APP_DIR=/var/www/xtend
APP_USER=xtend
say() { echo; echo "==> $*"; }

[ "$(id -u)" = 0 ] || { echo "Run as root."; exit 1; }

say "System packages and automatic security updates"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get upgrade -yq
apt-get install -yq curl git nginx certbot python3-certbot-nginx ufw unattended-upgrades ca-certificates
dpkg-reconfigure -fnoninteractive unattended-upgrades

say "Clock on UTC (the scheduled jobs are written in UTC)"
timedatectl set-timezone UTC

say "Node.js 22 and PM2"
if ! node -v 2>/dev/null | grep -q '^v22'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -yq nodejs
fi
npm install -g pm2@5 --loglevel=error

say "Swap, so a build cannot run the server out of memory"
if ! swapon --show | grep -q .; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

say "Firewall: SSH and web only"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null

say "The $APP_USER user and folders"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "/home/$APP_USER" --shell /bin/bash "$APP_USER"
mkdir -p "$APP_DIR"/{releases,shared/logs}
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

say "Deploy key, so the server can read the repository"
sudo -u "$APP_USER" -H bash -c '
  mkdir -p ~/.ssh && chmod 700 ~/.ssh
  [ -f ~/.ssh/id_ed25519 ] || ssh-keygen -q -t ed25519 -N "" -C "xtend-vps" -f ~/.ssh/id_ed25519
  ssh-keyscan -H github.com >> ~/.ssh/known_hosts 2>/dev/null
  sort -u -o ~/.ssh/known_hosts ~/.ssh/known_hosts
'
if ! sudo -u "$APP_USER" -H git ls-remote "$REPO_URL" >/dev/null 2>&1; then
  echo
  echo "Add this key in GitHub: the repository's Settings > Deploy keys > Add deploy key (read access only):"
  echo
  cat "/home/$APP_USER/.ssh/id_ed25519.pub"
  echo
  read -r -p "Press Enter once it is added... "
fi
[ -d "$APP_DIR/repo/.git" ] || sudo -u "$APP_USER" -H git clone --quiet --branch "$BRANCH" "$REPO_URL" "$APP_DIR/repo"

say "Environment file"
if [ ! -f "$APP_DIR/shared/.env.production" ]; then
  cp "$APP_DIR/repo/.env.example" "$APP_DIR/shared/.env.production"
  chown "$APP_USER:$APP_USER" "$APP_DIR/shared/.env.production"
  echo "Created $APP_DIR/shared/.env.production from .env.example: fill it in before the first deploy."
fi
chmod 600 "$APP_DIR/shared/.env.production"

say "Nginx"
sed "s/__DOMAIN__/$DOMAIN/g" "$APP_DIR/repo/deploy/nginx/xtend.conf" > /etc/nginx/sites-available/xtend
cp "$APP_DIR/repo/deploy/nginx/xtend-proxy.conf" /etc/nginx/snippets/xtend-proxy.conf
ln -sfn /etc/nginx/sites-available/xtend /etc/nginx/sites-enabled/xtend
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

say "HTTPS certificate for $DOMAIN"
if ! certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos -n --redirect; then
  echo "Certbot failed: check that $DOMAIN points at this server, then run:"
  echo "  certbot --nginx -d $DOMAIN -m $EMAIL --agree-tos -n --redirect"
fi

say "PM2 starts Xtend when the server boots"
env PATH="$PATH" pm2 startup systemd -u "$APP_USER" --hp "/home/$APP_USER" >/dev/null

say "Scheduled jobs"
crontab -u "$APP_USER" "$APP_DIR/repo/deploy/crontab"

say "GitHub can deploy as $APP_USER"
echo "For automatic deploys, make a key pair on your own computer (ssh-keygen -t ed25519 -f xtend-deploy)."
echo "Append xtend-deploy.pub to /home/$APP_USER/.ssh/authorized_keys on this server, and put the private"
echo "key in the GitHub secret VPS_SSH_KEY (deploy/README.md)."

cat <<DONE

Server ready. Next:
  1. Fill in $APP_DIR/shared/.env.production (nano $APP_DIR/shared/.env.production).
  2. First deploy:  sudo -u $APP_USER -H bash $APP_DIR/repo/deploy/deploy.sh
  3. Open https://$DOMAIN
DONE
