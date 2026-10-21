#!/usr/bin/env bash
# Deploys one commit of Xtend on the VPS (deploy/README.md). Run as the
# xtend user, by hand or from .github/workflows/deploy-vps.yml:
#
#   bash /var/www/xtend/repo/deploy/deploy.sh            # newest on the branch
#   bash /var/www/xtend/repo/deploy/deploy.sh <commit>   # a given commit (or roll back)
#
# Each commit is built in its own folder under releases/ while the live one
# keeps serving. Only a finished build is switched in (the `current`
# symlink), PM2 reloads one process at a time, and if the new build does
# not answer /api/version with its own build id within a minute the
# previous release is put back. The last 5 releases are kept.
set -euo pipefail

APP_DIR="${XTEND_APP_DIR:-/var/www/xtend}"
BRANCH="${XTEND_BRANCH:-claude/new-session-sgmxdg}"
KEEP=5
log() { echo "[deploy $(date -u +%H:%M:%S)] $*"; }

cd "$APP_DIR/repo"
git fetch --quiet --prune origin "$BRANCH"
SHA="$(git rev-parse "${1:-origin/$BRANCH}^{commit}")"
BUILD_ID="${SHA:0:12}"
REL="$APP_DIR/releases/$BUILD_ID"

if [ -f "$APP_DIR/current/.xtend-build-ok" ] && [ "$(readlink -f "$APP_DIR/current")" = "$REL" ]; then
  log "$BUILD_ID is already live"
  exit 0
fi

if [ ! -f "$REL/.xtend-build-ok" ]; then
  log "building $BUILD_ID"
  rm -rf "$REL"
  mkdir -p "$REL"
  git archive "$SHA" | tar -x -C "$REL"
  ln -sfn "$APP_DIR/shared/.env.production" "$REL/.env.production"
  cd "$REL"
  npm ci --no-audit --no-fund --loglevel=error
  XTEND_BUILD_ID="$BUILD_ID" NODE_OPTIONS="--max-old-space-size=${XTEND_BUILD_MEMORY_MB:-3072}" npm run build
  touch .xtend-build-ok
else
  log "$BUILD_ID was built before; switching to it"
fi

PREVIOUS="$(readlink -f "$APP_DIR/current" 2>/dev/null || true)"
ln -sfn "$REL" "$APP_DIR/current.next"
mv -Tf "$APP_DIR/current.next" "$APP_DIR/current"

reload() {
  pm2 startOrReload "$APP_DIR/current/deploy/ecosystem.config.cjs" --update-env >/dev/null || return 1
  pm2 save >/dev/null
}
healthy() {
  for _ in $(seq 1 30); do
    if curl -fs --max-time 5 http://127.0.0.1:3000/api/version | grep -q "\"build\":\"$1\""; then return 0; fi
    sleep 2
  done
  return 1
}

log "reloading"
if reload && healthy "$BUILD_ID"; then
  log "live: $BUILD_ID"
else
  log "the new build did not come up healthy"
  if [ -n "$PREVIOUS" ] && [ -d "$PREVIOUS" ] && [ "$PREVIOUS" != "$REL" ]; then
    ln -sfn "$PREVIOUS" "$APP_DIR/current.next"
    mv -Tf "$APP_DIR/current.next" "$APP_DIR/current"
    if reload && healthy "$(basename "$PREVIOUS")"; then
      log "rolled back to $(basename "$PREVIOUS")"
    else
      log "rollback failed: previous release selected, but it is not healthy; manual recovery required"
    fi
  fi
  exit 1
fi

# Keep the newest releases (and always the live one).
cd "$APP_DIR/releases"
ls -1t | tail -n +$((KEEP + 1)) | while read -r old; do
  [ "$APP_DIR/releases/$old" = "$REL" ] || rm -rf "$old"
done
