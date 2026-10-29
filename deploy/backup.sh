#!/usr/bin/env bash
# Makes ravicash-backup-<date>.tar.gz (database + receipt photos + the app's own rolling backups) in your home folder.
#   cd ravi-cash && sudo bash deploy/backup.sh
# Then download it: in the Google Cloud SSH window press the gear icon -> "Download file" -> ravicash-backup-<date>.tar.gz
set -euo pipefail
[ "$(id -u)" = "0" ] || { echo "Run it with sudo:  sudo bash deploy/backup.sh"; exit 1; }
cd "$(dirname "$0")/.."
CID="$(docker compose ps -q app)"
[ -n "$CID" ] || { echo "The app is not running (docker compose ps shows nothing)."; exit 1; }
OUTDIR="${SUDO_USER:+/home/$SUDO_USER}"; OUTDIR="${OUTDIR:-$PWD}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
docker cp "$CID:/data/." "$TMP/"
OUT="$OUTDIR/ravicash-backup-$(date +%F-%H%M).tar.gz"
tar czf "$OUT" --exclude=./.lock -C "$TMP" .
[ -n "${SUDO_USER:-}" ] && chown "$SUDO_USER" "$OUT"
echo "Saved: $OUT  ($(du -h "$OUT" | cut -f1))"
