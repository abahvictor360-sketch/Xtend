#!/usr/bin/env bash
# Proof that no secret key reaches a browser: builds Xtend with FAKE keys
# carrying a marker, then searches everything a browser downloads
# (.next/static) and every pre-rendered page for the marker. Never uses or
# prints a real key. Takes a few minutes (a full build).
#
#   bash scripts/check-browser-bundle-secrets.sh
set -u
cd "$(dirname "$0")/.."
M="FAKEMARKER$RANDOM$RANDOM"
env -i PATH="$PATH" HOME="$HOME" NODE_OPTIONS=--max-old-space-size=3072 \
  NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9 NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_public \
  SUPABASE_SERVICE_ROLE_KEY="sb_secret_${M}" GOOGLE_MAPS_API_KEY="${M}" ANTHROPIC_API_KEY="sk-ant-${M}" \
  VAPID_PRIVATE_KEY="${M}" CRON_SECRET="${M}" TURNSTILE_SECRET_KEY="${M}" FIREBASE_SERVICE_ACCOUNT="${M}" \
  APNS_KEY="${M}" REDIS_URL="redis://u:${M}@x:6379" CREDENTIALS_WEBHOOK_TOKEN="${M}" IP_API_KEY="${M}" AI_KEYS_SECRET="${M}" \
  npx next build >/dev/null 2>&1 || { echo "FAIL: the build did not finish"; rm -rf .next; exit 1; }
browser=$(grep -rl "$M" .next/static 2>/dev/null | wc -l)
pages=$(grep -rl "$M" .next/server/app --include=*.html --include=*.rsc --include=*.body 2>/dev/null | wc -l)
maps=$(find .next/static -name '*.map' | wc -l)
rm -rf .next
fail=0
[ "$browser" -eq 0 ] && echo "ok: no secret key in any file a browser downloads" || { echo "FAIL: a secret key is in $browser browser file(s)"; fail=1; }
[ "$pages" -eq 0 ] && echo "ok: no secret key in any pre-rendered page" || { echo "FAIL: a secret key is in $pages page(s)"; fail=1; }
[ "$maps" -eq 0 ] && echo "ok: no source maps for browsers" || { echo "FAIL: $maps source map(s) shipped"; fail=1; }
[ $fail -eq 0 ] && echo "ALL BROWSER BUNDLE SECRET CHECKS PASSED"
exit $fail
