#!/usr/bin/env bash
# Install a new version of the app on the VPS without touching your data or settings.
#   1. Upload and unzip the new version somewhere (for example /root/new-version).
#   2. sudo bash /root/new-version/deploy/update.sh
set -euo pipefail
APP_DIR=/opt/dedsilva-wms
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ "$(id -u)" -eq 0 ] || { echo "Run this with sudo."; exit 1; }
[ -f "$SRC_DIR/server.js" ] || { echo "server.js not found next to deploy/."; exit 1; }
echo "==> Backing up first"; sudo -u wms /usr/bin/node "$APP_DIR/scripts/backup.js"
echo "==> Copying the new version (your .env and data stay as they are)"
rsync -a --delete --exclude node_modules --exclude data --exclude .env --exclude .git "$SRC_DIR"/ "$APP_DIR"/
chown -R wms:wms "$APP_DIR"; chown wms:wms "$APP_DIR/.env"
( cd "$APP_DIR" && sudo -u wms npm ci --omit=dev --no-audit --no-fund )
install -m 644 "$APP_DIR/deploy/dedsilva-wms.service" /etc/systemd/system/dedsilva-wms.service; systemctl daemon-reload
systemctl restart dedsilva-wms; sleep 2
curl -fsS http://127.0.0.1:3000/healthz >/dev/null && echo "Updated and running." || { echo "Did not start: journalctl -u dedsilva-wms -n 50"; exit 1; }
