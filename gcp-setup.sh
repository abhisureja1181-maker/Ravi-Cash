#!/usr/bin/env bash
# Ravi Cash — one-command setup for a fresh Ubuntu server (Google Cloud e2-micro, or any Ubuntu VPS).
#
#   sudo bash deploy/gcp-setup.sh your-name.duckdns.org
#
# What it does: adds 1 GB swap (small servers need it), installs Docker, writes the .env file
# (your domain + a random SETUP_KEY), builds the app and starts it behind Caddy (automatic HTTPS).
# Safe to run again: it keeps the SETUP_KEY and your data. See GOOGLE-CLOUD-GUIDE.md.
set -euo pipefail

DOMAIN="${1:-}"
if [ "$(id -u)" != "0" ]; then echo "Run it with sudo:  sudo bash deploy/gcp-setup.sh your-name.duckdns.org"; exit 1; fi
if [ -z "$DOMAIN" ]; then echo "Usage:  sudo bash deploy/gcp-setup.sh your-name.duckdns.org"; exit 1; fi
case "$DOMAIN" in *://*|*/*|*" "*|*@*) echo "Give only the name, like  raviwater.duckdns.org  (no https://, no spaces)."; exit 1;; esac
case "$DOMAIN" in *.*) ;; *) echo "The name must look like  raviwater.duckdns.org"; exit 1;; esac

cd "$(dirname "$0")/.."
DRY="${DRY_RUN:-0}"
say() { printf '\n==> %s\n' "$*"; }

# 1) swap: a 1 GB server runs out of memory while building without it
if [ "$DRY" != "1" ] && [ -z "$(swapon --show --noheadings 2>/dev/null)" ]; then
  say "Adding 1 GB swap"
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# 2) Docker
if [ "$DRY" != "1" ] && ! command -v docker >/dev/null 2>&1; then
  say "Installing Docker (1-2 minutes)"
  curl -fsSL https://get.docker.com | sh
fi
[ "$DRY" = "1" ] || systemctl enable --now docker >/dev/null 2>&1 || true

# 3) is the name already pointing at this server? (HTTPS cannot start before that)
MYIP=""
if [ "$DRY" != "1" ]; then
  MYIP="$(curl -fsS -m 5 -H 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip 2>/dev/null || true)"
  [ -n "$MYIP" ] || MYIP="$(curl -fsS -m 8 -4 https://api.ipify.org 2>/dev/null || true)"
  THEIRS="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}')"
  if [ -n "$MYIP" ] && [ "$THEIRS" != "$MYIP" ] && [ "${FORCE:-0}" != "1" ]; then
    echo
    echo "!! $DOMAIN points to '${THEIRS:-nothing yet}', but this server's address is $MYIP."
    echo "   Open duckdns.org, put $MYIP in the 'current ip' box of your name, press 'update ip',"
    echo "   wait 2 minutes and run this command again.   (To go on anyway:  sudo FORCE=1 bash deploy/gcp-setup.sh $DOMAIN)"
    exit 1
  fi
fi

# 4) .env — keep an existing SETUP_KEY, otherwise make a random one
KEY=""
[ -f .env ] && KEY="$(sed -n 's/^SETUP_KEY=//p' .env | head -n1)"
if [ -z "$KEY" ]; then KEY="$(head -c 64 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"; fi
printf 'DOMAIN=%s\nSETUP_KEY=%s\n' "$DOMAIN" "$KEY" > .env
chmod 600 .env

# 5) build + start
if [ "$DRY" != "1" ]; then
  say "Building and starting Ravi Cash (3-6 minutes the first time)"
  docker compose up -d --build
  say "Waiting for it to answer"
  for i in $(seq 1 30); do
    if docker compose exec -T app node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then OK=1; break; fi
    sleep 2
  done
  [ "${OK:-0}" = "1" ] || { echo "The app did not start. See:  sudo docker compose logs --tail 80 app"; exit 1; }
fi

cat <<DONE

=====================================================================
  Ravi Cash is running.

  Open:        https://$DOMAIN        (the first time the padlock can take ~1 minute)
  SETUP KEY:   $KEY
               (paste it on the first-time setup screen; it is also saved in the file  .env)

  Next: open the link, fill the setup screen, then add your users.
=====================================================================
DONE
