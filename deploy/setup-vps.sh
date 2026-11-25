#!/usr/bin/env bash
# One-command setup for a fresh Ubuntu 22.04 / 24.04 VPS (also works on Debian 12).
#
#   1. Point your domain's DNS "A" record at the VPS IP address.
#   2. Upload and unzip this project on the VPS, then from inside the project folder run:
#          sudo bash deploy/setup-vps.sh  warehouse.yourdomain.com  you@yourdomain.com
#      (the email is only used by Let's Encrypt for certificate expiry notices)
#
# Safe to run again: it never overwrites your .env or your data.
set -euo pipefail

DOMAIN="${1:-}"; LE_EMAIL="${2:-}"
APP_DIR=/opt/dedsilva-wms
DATA_DIR=/var/lib/dedsilva-wms
BACKUP_DIR=/var/backups/dedsilva-wms
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

[ "$(id -u)" -eq 0 ] || { echo "Run this with sudo (as root)."; exit 1; }
[ -f "$SRC_DIR/server.js" ] || { echo "Run it from the project folder: sudo bash deploy/setup-vps.sh <domain> <email>"; exit 1; }
[ -n "$DOMAIN" ] || echo "No domain given: the app will be set up but HTTPS will be skipped. Phones need HTTPS to scan, so add a domain soon."

echo "==> 1/8 Installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates gnupg ufw nginx certbot python3-certbot-nginx build-essential python3 rsync fail2ban unattended-upgrades

echo "==> 2/8 Node.js (version 22)"
NODE_MAJOR=0; command -v node >/dev/null && NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
echo "    node $(node -v)"

echo "==> 3/8 Service user and folders"
id wms >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin wms
mkdir -p "$APP_DIR" "$DATA_DIR" "$BACKUP_DIR"
chown -R wms:wms "$DATA_DIR" "$BACKUP_DIR"; chmod 700 "$DATA_DIR" "$BACKUP_DIR"

echo "==> 4/8 Copying the application"
rsync -a --delete --exclude node_modules --exclude data --exclude .env --exclude .git "$SRC_DIR"/ "$APP_DIR"/
chown -R wms:wms "$APP_DIR"

echo "==> 5/8 Settings file (.env)"
if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  SECRET="$(openssl rand -hex 32)"
  sed -i "s|^SECRET=.*|SECRET=$SECRET|" "$APP_DIR/.env"
  echo "    Created $APP_DIR/.env with a fresh SECRET. You must still fill in email, SMS and WhatsApp (see DEPLOY.md)."
else
  echo "    Keeping your existing .env"
fi
chown wms:wms "$APP_DIR/.env"; chmod 600 "$APP_DIR/.env"

echo "==> 6/8 Installing dependencies (this compiles the database driver, give it a minute)"
( cd "$APP_DIR" && sudo -u wms npm ci --omit=dev --no-audit --no-fund )

echo "==> 7/8 Starting the service"
install -m 644 "$APP_DIR/deploy/dedsilva-wms.service" /etc/systemd/system/dedsilva-wms.service
systemctl daemon-reload
systemctl enable dedsilva-wms >/dev/null
systemctl restart dedsilva-wms
# nightly backup at 02:30
cat > /etc/cron.d/dedsilva-wms-backup <<CRON
30 2 * * * wms /usr/bin/node $APP_DIR/scripts/backup.js >> /var/log/dedsilva-wms-backup.log 2>&1
CRON
touch /var/log/dedsilva-wms-backup.log; chown wms:wms /var/log/dedsilva-wms-backup.log

echo "==> 8/8 Web server, firewall and HTTPS"
ufw allow OpenSSH >/dev/null; ufw allow 'Nginx Full' >/dev/null; ufw --force enable >/dev/null
systemctl enable --now fail2ban >/dev/null 2>&1 || true
if [ -n "$DOMAIN" ]; then
  sed "s/__DOMAIN__/$DOMAIN/g" "$APP_DIR/deploy/nginx.conf" > /etc/nginx/sites-available/dedsilva-wms
  ln -sf /etc/nginx/sites-available/dedsilva-wms /etc/nginx/sites-enabled/dedsilva-wms
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl reload nginx
  if [ -n "$LE_EMAIL" ]; then
    certbot --nginx -d "$DOMAIN" -m "$LE_EMAIL" --agree-tos --no-eff-email --redirect -n || echo "Certbot could not get a certificate. Check that $DOMAIN points to this server, then run:  sudo certbot --nginx -d $DOMAIN"
  else
    echo "No email given, so HTTPS was skipped. Run:  sudo certbot --nginx -d $DOMAIN"
  fi
fi

sleep 2
if curl -fsS http://127.0.0.1:3000/healthz >/dev/null; then echo; echo "The app is running."; else echo; echo "The app did not start. Look at:  journalctl -u dedsilva-wms -n 50"; fi
cat <<MSG

NEXT STEPS
  1. Edit the settings:     sudo nano $APP_DIR/.env       (company email/WhatsApp, SMTP, SMS, WhatsApp keys)
  2. Restart:               sudo systemctl restart dedsilva-wms
  3. Test each channel:     cd $APP_DIR && sudo -u wms npm run check
                            sudo -u wms npm run notify-test -- email    you@yourdomain.com
                            sudo -u wms npm run notify-test -- sms      +2547XXXXXXXX
                            sudo -u wms npm run notify-test -- whatsapp +2547XXXXXXXX
  4. Open https://${DOMAIN:-your-server-ip} and create the administrator account.
  Logs: journalctl -u dedsilva-wms -f      Backups: $BACKUP_DIR (nightly)
MSG
