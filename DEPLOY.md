# Putting the Warehouse System on a VPS

Time needed: about 30 minutes. You need a VPS, a domain name, and accounts for email, SMS and WhatsApp (steps below).

## 1. What to buy
- **VPS**: Ubuntu 24.04 or 22.04, 1 vCPU and 2 GB RAM is plenty (DigitalOcean, Hetzner, Contabo, Linode, etc.).
- **Domain** (or a subdomain such as `warehouse.yourcompany.com`). Phones need HTTPS to use the camera scanner.
- In your domain's DNS add an **A record** pointing the name to the VPS IP address. Wait a few minutes.

## 2. Install (one command)
On your computer, upload the project zip, then on the VPS:

    scp dedsilva-wms-updated.zip root@YOUR_VPS_IP:/root/
    ssh root@YOUR_VPS_IP
    apt-get install -y unzip
    unzip dedsilva-wms-updated.zip && cd dedsilva-wms
    bash deploy/setup-vps.sh warehouse.yourcompany.com you@yourcompany.com

The script installs Node.js, Nginx, HTTPS (Let's Encrypt), the firewall and fail2ban, creates the service, and schedules a **nightly backup**.
It is safe to run again. It never overwrites `.env` or your data.

Then open `https://warehouse.yourcompany.com` and create the **administrator** account.

Where things live: app `/opt/dedsilva-wms`, settings `/opt/dedsilva-wms/.env`, database `/var/lib/dedsilva-wms`, backups `/var/backups/dedsilva-wms`.

## 3. Settings (`sudo nano /opt/dedsilva-wms/.env`, then `sudo systemctl restart dedsilva-wms`)

### Who receives the invoice-download code (company side)
    COMPANY_EMAIL_DS=info@dedsilva.com
    COMPANY_EMAIL_KW=sales@kaynesltd.com
    COMPANY_WHATSAPP_DS=+2547XXXXXXXX
    COMPANY_WHATSAPP_KW=+2547XXXXXXXX
The same 6-digit code is sent to the company email **and** the company WhatsApp. It works once and expires in 10 minutes.

### Email (Nodemailer, SMTP)
Use your email provider's SMTP details.
- Google Workspace / Gmail: `smtp.gmail.com`, port 587, `SMTP_SECURE=false`, and an **App Password** (needs 2-step verification) as `SMTP_PASS`.
- Zoho: `smtp.zoho.com`, port 587. Microsoft 365: `smtp.office365.com`, port 587. Or Brevo / Mailgun / your hosting email.

    SMTP_HOST=smtp.gmail.com
    SMTP_PORT=587
    SMTP_SECURE=false
    SMTP_USER=no-reply@yourcompany.com
    SMTP_PASS=your-app-password
    SMTP_FROM=Warehouse <no-reply@yourcompany.com>

### SMS to the receiver (delivery code)
**Africa's Talking** (best coverage in Kenya): create an account, create an app, copy the username and API key. Top up airtime/credit. Optionally apply for an alphanumeric sender ID.

    SMS_PROVIDER=africastalking
    AT_USERNAME=yourusername
    AT_API_KEY=your-api-key
    AT_SENDER_ID=

(`AT_USERNAME=sandbox` is test mode: nothing reaches real phones.) Prefer Twilio? Set `SMS_PROVIDER=twilio` and the `TWILIO_*` lines in `.env.example`.
The receiver's code is **never shown in the app**; the rider cannot see it. The receiver reads it out at hand-over.

### WhatsApp to the company (invoice code)
Meta WhatsApp Cloud API:
1. developers.facebook.com, create an app (type Business), add **WhatsApp**, and link your Meta Business account.
2. Register the sending number. Copy the **Phone number ID**.
3. Create a **permanent token**: Business settings, System users, add a user, assign the app, generate a token with `whatsapp_business_messaging`.
4. In WhatsApp Manager create a message template in the **Authentication** category (for example named `invoice_code`) and wait for approval.

    WHATSAPP_PROVIDER=meta
    WA_PHONE_NUMBER_ID=1234567890
    WA_ACCESS_TOKEN=EAAB...
    WA_TEMPLATE=invoice_code
    WA_TEMPLATE_LANG=en

Without an approved template WhatsApp only delivers if the company number messaged your business number in the last 24 hours, so use a template for reliable delivery. Twilio WhatsApp is also supported (`WHATSAPP_PROVIDER=twilio`).

### Order updates and the daily summary
    STATUS_NOTIFY=sms          # merchandisers are texted when an order is priced, dispatched, delivered
    DAILY_REPORT=on
    DAILY_REPORT_HOUR=18       # the summary email goes out after 6 pm
    REPORT_EMAIL_DS=manager@dedsilva.com
    REPORT_EMAIL_KW=manager@kaynesltd.com
    TZ=Africa/Nairobi
Add each merchandiser's phone number on the **Staff** screen (Edit next to Phone). Managers can also press **Email today's summary now** on the dashboard.

### Installing on phones
Open the site in Chrome (Android) and tap **Install app**, or in Safari (iPhone) tap Share, then **Add to Home Screen**. It then opens full screen like an app, and merchandisers can keep taking orders with no signal (they are sent when the connection returns). Phones need the HTTPS address for this.

## 4. Test every channel
    cd /opt/dedsilva-wms
    sudo -u wms npm run check
    sudo -u wms npm run notify-test -- email    you@yourcompany.com
    sudo -u wms npm run notify-test -- sms      +2547XXXXXXXX
    sudo -u wms npm run notify-test -- whatsapp +2547XXXXXXXX
Then try a real order: invoice download (email + WhatsApp) and dispatch (SMS to the receiver).

## 4b. Zebra handheld scanners
The app reads a handheld scanner as a **keyboard**: the scanner "types" the barcode and presses Enter. Nothing is installed on the scanner, and the camera is not needed.

**Zebra Android computers (TC21, TC26, TC52, TC57, MC33 ...) with DataWedge**
1. Open the **DataWedge** app and use the default `Profile0` (applies to every app) or create a profile for Chrome (and for the installed Warehouse app, if you install it).
2. *Barcode input*: Enabled. *Decoders*: **Code 128** enabled (it is by default). Our labels are Code 128.
3. *Keystroke output*: **Enabled**. Under *Basic data formatting* tick **Send data** and **Send ENTER key**. Leave prefix and suffix empty.
4. *Intent output*: off (not used).
5. Open the app, go to **Scan**, pull the trigger on a label: the result should appear with a beep. Turn on **Handheld scanner mode** on the Scan screen to stop the on-screen keyboard popping up.

**Bluetooth Zebra scanners (CS60, DS2278, DS3678, LI4278 ...)**
1. Pair the scanner to the phone/tablet in **HID keyboard** mode (scan the HID pairing barcode in the scanner's guide).
2. Program an **Enter** suffix: scan the "Enter" (or "Carriage return") suffix barcode from the Zebra Product Reference Guide.
3. Tab as the ending key also works. On Android you may need to allow the on-screen keyboard while a hardware keyboard is connected (or use Handheld scanner mode).

The scan box is found automatically: even if the cursor is somewhere else, the first scanned character moves it back, and a double read of the same label within a second counts once.
Use **HTTPS** (needed for the camera and the installed app), and test a printed label at the size you use (70 mm labels scan comfortably; on 50 mm labels the barcode is dense, so test first).

## 5. Staff and security checklist
- Create staff on the **Staff** screen (Merchandiser, Clerk, Manager). Everyone changes their PIN at first sign-in.
- Keep `OTP_SHOW_ON_SCREEN=false` and `NODE_ENV=production`.
- Never share `.env`. The firewall allows only SSH, HTTP and HTTPS; the app listens only on 127.0.0.1 behind Nginx.
- Optional hardening: SSH keys only (`PasswordAuthentication no`), and a non-root sudo user.

## 6. Backups
A compressed, integrity-checked copy is made every night at 02:30 into `/var/backups/dedsilva-wms` (30 days kept). **Also copy them off the server**: set `BACKUP_RSYNC_TARGET=user@other-server:/backups/wms/` in `.env`, or download them regularly.

Restore:

    sudo systemctl stop dedsilva-wms
    gunzip -c /var/backups/dedsilva-wms/wms-DATE.db.gz | sudo -u wms tee /var/lib/dedsilva-wms/wms.db > /dev/null
    sudo rm -f /var/lib/dedsilva-wms/wms.db-wal /var/lib/dedsilva-wms/wms.db-shm
    sudo systemctl start dedsilva-wms

## 7. Updating later
Upload and unzip the new version, then `sudo bash deploy/update.sh` from inside it. It takes a backup first and keeps your data and `.env`.

## 8. Troubleshooting
- Logs: `journalctl -u dedsilva-wms -f`. Status: `systemctl status dedsilva-wms`. Health: `curl http://127.0.0.1:3000/healthz`.
- "Email/SMS/WhatsApp NOT set up" in the startup log: a setting is missing; run `npm run check`.
- SMS fails: check Africa's Talking credit, the number format, and that the username is not `sandbox`.
- WhatsApp fails: token expired or wrong, template not approved, or the template name/language differs.
- No HTTPS: confirm the DNS record, then `sudo certbot --nginx -d warehouse.yourcompany.com`.
