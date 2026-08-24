#!/usr/bin/env bash
#
# Roll the backend back to a previously deployed build.
#
# Deploys keep their build tarball, so going back is unpacking one that is
# already on this machine — no CI run, no rebuild, no network.
#
#   ./scripts/rollback.sh              list what is available
#   ./scripts/rollback.sh <commit>     switch to that build and restart
#   ./scripts/rollback.sh previous     switch to the one before the current
#
# THIS ROLLS BACK CODE, NOT THE DATABASE. Migrations only roll forward, and
# nothing here undoes one. Going back past a migration is safe when it only
# added things, and is not when it renamed or removed them. If the bad deploy
# carried a destructive migration, restore the backup instead.

set -euo pipefail

RELEASES_DIR="${RELEASES_DIR:-$HOME/releases}"
APP_DIR="${APP_DIR:-$HOME/OpenATS}"
PM2_CONFIG="${PM2_CONFIG:-ecosystem.config.js}"
HEALTH_URL="${HEALTH_URL:-http://localhost:8080/health}"
CURRENT_FILE="$APP_DIR/.current-release"

die() { echo "error: $*" >&2; exit 1; }

current_release() {
  [ -f "$CURRENT_FILE" ] && cat "$CURRENT_FILE" || echo ""
}

# Newest first. Deploy writes each tarball as <commit>.tar.gz, so mtime order
# is deploy order — commit hashes sort meaninglessly.
list_releases() {
  find "$RELEASES_DIR" -maxdepth 1 -name '*.tar.gz' -type f -exec ls -t {} + 2>/dev/null \
    | while read -r f; do basename "$f" .tar.gz; done
}

[ -d "$RELEASES_DIR" ] || die "no releases directory at $RELEASES_DIR"

if [ $# -eq 0 ]; then
  current="$(current_release)"
  echo "Releases in $RELEASES_DIR (newest first):"
  found=0
  while read -r rel; do
    [ -z "$rel" ] && continue
    found=1
    if [ "$rel" = "$current" ]; then echo "  $rel  <- current"; else echo "  $rel"; fi
  done <<< "$(list_releases)"
  [ "$found" -eq 0 ] && echo "  (none)"
  echo
  echo "Usage: $0 <commit>|previous"
  exit 0
fi

target="$1"

if [ "$target" = "previous" ]; then
  current="$(current_release)"
  # The first entry that is not the one running. Without a recorded current
  # release the newest is almost certainly what is deployed, so skip it.
  target="$(list_releases | grep -v -x -F "${current:-$(list_releases | head -1)}" | head -1 || true)"
  [ -n "$target" ] || die "no earlier release to go back to"
  echo "previous release is $target"
fi

archive="$RELEASES_DIR/$target.tar.gz"
[ -f "$archive" ] || die "no such release: $target (run with no arguments to list)"

# Unpack somewhere else first and check it before touching what is running: a
# truncated archive would otherwise replace a working build with nothing, and
# the first thing to notice would be the health check, after the restart.
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT

tar -xzf "$archive" -C "$staging" || die "$target is not a readable archive"
[ -f "$staging/dist/src/server.js" ] || die "$target does not contain a usable build"

echo "rolling back to $target"
rm -rf "$APP_DIR/backend/dist"
mv "$staging/dist" "$APP_DIR/backend/dist"
echo "$target" > "$CURRENT_FILE"

cd "$APP_DIR"
SENTRY_RELEASE="$target" pm2 restart "$PM2_CONFIG" --update-env
pm2 save

sleep 5
if curl -fsS "$HEALTH_URL" >/dev/null; then
  echo "rolled back to $target and healthy"
else
  die "rolled back to $target but $HEALTH_URL is not healthy — check 'pm2 logs'"
fi
