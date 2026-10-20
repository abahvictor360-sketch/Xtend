#!/usr/bin/env bash
# Calls one of Xtend's scheduled jobs on this server (deploy/crontab).
# Usage: cron.sh alerts | absence-sweep | purge-selfies
# Reads CRON_SECRET from the shared .env.production and calls the app
# directly on 127.0.0.1, so it does not depend on DNS or HTTPS.
set -euo pipefail
APP_DIR="${XTEND_APP_DIR:-/var/www/xtend}"
job="${1:?which job: alerts, absence-sweep or purge-selfies}"
secret="$(grep -E '^CRON_SECRET=' "$APP_DIR/shared/.env.production" | head -1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//')"
if [ -z "$secret" ]; then
  echo "$(date -u +%FT%TZ) $job: CRON_SECRET is not set in $APP_DIR/shared/.env.production" >&2
  exit 1
fi
code=$(curl -s -o /tmp/xtend-cron-$job.json -w '%{http_code}' --max-time 110 \
  -H "Authorization: Bearer $secret" "http://127.0.0.1:3000/api/cron/$job" || echo 000)
if [ "$code" != "200" ]; then
  echo "$(date -u +%FT%TZ) $job: HTTP $code $(head -c 300 /tmp/xtend-cron-$job.json 2>/dev/null)" >&2
  exit 1
fi
