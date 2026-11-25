# Warehouse System (DedSilva International Limited and Kaynes Ltd)

Barcode tracking for the warehouse: print unique labels, scan every movement, keep a full audit trail.
Node.js + Express + SQLite on the server; the web app is served by the same server.

## Two companies in one system
The system runs **DedSilva International Limited** and **Kaynes Ltd** (Zavira sanitary products) side by side.
A **company switcher** in the header changes everything on screen to that company: products, barcodes, stock, scans, orders, invoices, labels, colours and letterhead.
- Each company has its own products, barcodes (`DS-PTW-QRV-000001`, `KW-ZVR-REG-000001`), stock and orders. SKUs must be unique across both.
- Order, quotation, delivery-note and **invoice numbers are counted per company** (`ORD-00007`, `INV-00008`; `KW-ORD-00001`, `KW-INV-00001`), so neither company has gaps in its numbering.
- **Staff access**: on the Staff screen choose *Works in* for each person (All companies, DedSilva only, or Kaynes only). Administrators always see both. The server enforces this: staff cannot see, scan, print, order or invoice for a company they are not given.
- Existing DedSilva data is untouched. On first start of this version, Kaynes's five Zavira products are added once (menstrual pants, regular pads, heavy flow pads, panty liners, saviete). Add more under Products while Kaynes is selected.
- **Company details live in `companies.js`**: name, address, phone, email, colour, default VAT, brands, categories, barcode prefix and the email that receives invoice codes. Edit it and restart. **Kaynes's address, phone and email in that file are placeholders: replace them with the real ones.**
- **Logos**: put `kaynes-logo.png` (letterhead) and optionally `kaynes-icon.png` (small, for labels) in `public/img/`. Both are already included.
- **Invoice code emails**: `COMPANY_EMAIL` is used for both companies. To send Kaynes's codes elsewhere set `COMPANY_EMAIL_KW` (and `COMPANY_EMAIL_DS` for DedSilva).
- **VAT** defaults to 16% for both companies and can be changed on every invoice. Check the correct rate for sanitary products with your accountant and set `vat` for Kaynes in `companies.js`.

## Run it
    npm install
    npm start            # http://localhost:3000

Open the page. On first run it asks you to create the **administrator** account (a username and a PIN of at least 6 digits; easy PINs such as 123456 are refused).
Then add staff under **Staff**.

## Settings (environment variables)
- `PORT`      port to listen on (default 3000)
- `DATA_DIR`  where the database and backups are kept (default `./data`)
- `SECRET`    optional fixed secret for login tokens (otherwise generated once and stored in the database)
- Settings can live in a `.env` file next to the app (see `.env.example`). Email, SMS and WhatsApp settings are explained in **DEPLOY.md**.

## Put it on the internet (needed for phones)
The phone camera scanner only works over **HTTPS** (or on localhost), and PINs must never travel over plain HTTP.
Run the app behind a reverse proxy that provides HTTPS, for example Caddy:

    your-domain.co.ke {
        reverse_proxy localhost:3000
    }

**On a VPS use `deploy/setup-vps.sh`: see DEPLOY.md.** It sets up Node, Nginx, HTTPS, the firewall, a systemd service and nightly backups in one go.

## Orders (request to delivery)
The **Orders** screen follows the company process: request > proforma invoice / quotation > order (LPO no. or verbal authorisation)
> stock check > ordering / manufacturing > delivered in Nairobi > barcodes generated and allocated > invoice and delivery note
> dispatch with a one-time code (OTP) > delivered.
- If the ordered items are already in stock (received by scan), they are allocated automatically and ordering/manufacturing is skipped.
- Items allocated to an order can only be dispatched against that order (Scan screen: Action = Dispatch, then choose the order).
- Dispatch records the receiver, the rider/driver and **who authorised them**, then issues a 6-digit OTP for the receiver.
  The rider enters the code the receiver gives at handover to complete the delivery (5 wrong tries lock it; a manager can issue a new code or override with a reason).
- Every step is written to the order history with who did it and when.
- The delivery code is sent **by SMS to the receiver only** (Africa's Talking or Twilio) and is never shown in the app. If the SMS fails, press *Send a new code*; a manager can override with a reason. `OTP_SHOW_ON_SCREEN=true` shows it on screen for testing only.

## Barcode numbers (unique per product and per item)
Every label is numbered `DS-<product SKU>-<serial>`, for example `DS-PTW-QRV-000001`, `DS-PTW-QRV-000002`, `DS-SLY-QPT-000001`.
- The SKU is the product's own code and must be unique (letters, numbers and hyphens, up to 24 characters). It is turned into capitals automatically.
- The serial counts up separately for each product and is never reused, even if a print is cancelled.
- The database refuses a duplicate barcode, or a duplicate serial for the same product.
- Labels printed before this change (`DS-000123`) still scan and work as before.
- Do not change a product's SKU after labels are printed: the SKU is part of every barcode.

## Customers
**Customers** is a saved list per company (name, phone, email, address, KRA PIN, notes). On a new order, typing a saved name fills in the phone and address; a new name is saved automatically. Each customer shows their orders (all of them), what they have been invoiced, paid and still owe, and prints a statement. Orders keep a copy of the details they were made with, so editing a customer does not change old documents. Existing orders were linked to customers automatically when the system was upgraded (matched by name, ignoring capitals; names spelled differently become separate customers).

## Proforma invoice / quotation and delivery note (PDF)
Same letterhead, barcode and sign-off style as the invoice.
- **Proforma invoice / quotation**: prices (before VAT), VAT % and payment days are entered when the quotation is issued, and they carry through to the invoice. The PDF shows the valid-until date, totals, terms and a **Prepared by / Approved by / Accepted by (customer)** block with space for the LPO number. Print it from the order once the quotation exists. Quotations made before this upgrade have no prices: the order shows a **Save prices** step.
- **Delivery note** (no prices): available once the invoice is issued, so the driver has it before leaving. It lists items and quantities with a tick box for every barcode, delivery details (blank lines are left for anything not known yet, such as the driver), a remarks area, and a **Prepared by / Driver or rider / Received by (customer)** block.
- Both can be printed again at any time by signed-in staff (the proforma by managers and administrators, the delivery note by any staff). Each print is recorded in the order history. Unlike the invoice, they do not need an emailed code.

## Payments and statements
- Open **Payments** (or the payment box on an invoiced order) and record money received: amount, how (M-Pesa, bank transfer, cash, cheque, other), the M-Pesa code / bank reference / cheque number, and the date. Part payments are fine.
- Each invoice shows **Paid**, **Part-paid**, **Not paid** or **Overdue** (a balance remains after the due date; part-paid invoices that are late show as Overdue). The due date is the invoice date plus the payment days chosen when the invoice is issued (default 30, `termsDays` in `companies.js`).
- Safeguards: no payment above the balance, no future dates, and a reference already used on another payment asks for confirmation. Payments are **never deleted**: a wrong entry is cancelled with a reason, and the balance is put back. An invoice with payments cannot be cancelled until those payments are cancelled.
- **Statement of account** (Customers > open a customer > Print statement): every invoice and payment with a running balance, ageing (not yet due, 1-30, 31-60, 61-90, over 90 days late), optional date range, and the usual letterhead, barcode and sign-off. Add bank / M-Pesa lines under `paymentDetails` in `companies.js` to print **How to pay** on proformas, invoices and statements.
- **Invoices issued before this upgrade** are given the standard 30 days from their invoice date and **have no payments recorded**, so they show as Not paid or Overdue until their payments are entered. Enter past payments with the real dates.
- **Download list (CSV)** on the Payments screen exports the invoice list for finance.

## Guides on screen
Each screen opens with a short **What to do next** tip (closed with **Got it**, brought back with **? Help**). Home has a live **To do** list (quotes to make, orders to invoice, goods to send out, overdue invoices). Every order has a **What to do next** box for its current step. Labels were reworded in plain language (for example *Print labels* is *Labels*, *Dashboard* is *Home*, and the order stages read *New request, Quote sent, Order confirmed, Getting the goods, Goods arrived, Stock set aside, Invoiced, Out for delivery, Delivered*).

## Invoices (PDF on company letterhead)
At the **Stock set aside** stage the manager checks the unit prices (already entered at quotation; excluding VAT), the VAT % (default 16) and the payment days, then issues the invoice and delivery note.
The PDF has the DedSilva logo, address footer, customer, invoice/order/LPO references, the priced items, subtotal, VAT and total, and the barcode numbers of every item on the invoice.
Long orders continue on extra pages with the letterhead repeated.

**Every page carries the invoice's own barcode** (Code 128 of the invoice number, e.g. `INV-00007`), and the last page has a **sign-off block** with
Name / Date / Signature lines for **Prepared by** (the user who issued the invoice), **Authorised by** (the person who authorised the download) and **Received by**
(the receiver recorded at dispatch; blank lines to fill in by hand if not dispatched yet).

**Downloading needs an OTP.** On the order, press *Send code to company*, type who is authorising the download, and a 6-digit code is sent to the company email **and** company WhatsApp.
Enter it to download. The PDF is only produced by the server after a correct code, so it cannot be fetched without one.
- The code works once, expires after 10 minutes, locks after 5 wrong tries, and a new one can be requested once a minute.
- Every request and download (who, authorised by whom, when) is written to the order history.
- Set `COMPANY_EMAIL(_DS/_KW)`, `COMPANY_WHATSAPP(_DS/_KW)` and the SMTP and WhatsApp settings (see DEPLOY.md). Check them with `npm run check` and `npm run notify-test`.
- A channel that is not set up is reported on screen and the other still delivers. Codes are never written to the server log.

## Signing in and PINs
- Staff **type their username and PIN**. The sign-in page lists no names. A wrong username and a wrong PIN give the same message, and repeated wrong PINs lock sign-in for 15 minutes (per person and place, per username overall, and per place overall).
- **Forgot PIN:** an administrator opens **Staff** and presses **Reset PIN** next to the person. A temporary 8-digit PIN is shown once; the person signs in with it and must choose their own PIN before doing anything else. A reset also signs that person out everywhere. Administrators cannot reset their own PIN (use **Change my PIN**); another administrator does it.
- New staff get the starting PIN the administrator types and must change it at first sign-in. Anyone can use **Change PIN** in the header.
- **Existing databases are upgraded automatically.** Each existing person gets a username made from their name (Jane Wanjiku becomes `jane.wanjiku`; a number is added if it is taken). Administrators can see and change usernames on the Staff screen, and should tell staff what theirs is.
- **Last resort** (only administrator locked out): `node reset-pin.js` lists the usernames; `node reset-pin.js username NEWPIN` sets a temporary PIN.
- **Recent account changes** on the Staff screen records who added, removed or reset whom.

## Roles
- **admin**: everything, including staff accounts and backups
- **manager**: orders, customers, payments, print labels, products, history, void scans
- **clerk**: scan, view item details, print delivery notes, enter the delivery code. Clerks see no prices, totals, payments or customers.
- **guest** (no sign-in): scan only; sees "Scan recorded", never item details

## Data and backups
Everything is in `data/wms.db` (SQLite). On a VPS a nightly integrity-checked copy goes to `/var/backups/dedsilva-wms` (30 days kept); see DEPLOY.md.
Admins can also download a JSON copy from **Products > Backup**. Back up the `data` folder off the machine too.

## API (all under /api, JSON, `Authorization: Bearer <token>`)
GET /status, POST /setup, POST /login, GET /me, GET /state,
POST /change-pin, POST /products, POST /users, PATCH /users/:id (role, companies, username), POST /users/:id/reset-pin, POST /users/:id/pin, DELETE /users/:id,
POST /customers, PATCH /customers/:id, GET /customers/:id/history, POST /customers/:id/statement-pdf,
POST /payments, POST /payments/:id/void, POST /orders/:id/proforma-pdf, POST /orders/:id/delivery-note-pdf,
POST /orders, POST /orders/:id/invoice-otp, POST /orders/:id/invoice-pdf, POST /orders/:id/{prices,quote,confirm,source,arrived,allocate,invoice,dispatch,newotp,override,cancel,deliver},
POST /labels, POST /reprint, POST /scan, POST /scans/:id/void, GET /backup

## Not included yet
Offline queueing of scans, payment receipts, one payment spread across several invoices, credit notes, stock-take mode, batch expiry rules, and password-reset by email.

## Automatic SKUs and LPO numbers

- **SKU:** on *Add product*, the SKU fills itself in as soon as the name is typed (and updates if the brand changes). Brand code + name letters, for example Pitwan + "Quick-release vest" gives `PTW-QRV`. If the code is already taken, a number is added (`PTW-QRV2`). It can still be typed over by hand; clear the box to go back to automatic. Works the same for DedSilva and Kaynes. The rule lives in `public/sku.js`.
- **LPO number:** when an order is confirmed as "LPO" and the LPO box is left blank, the system numbers it: `LPO-00001` for DedSilva and `KW-LPO-00001` for Kaynes, each company counting separately. If the customer has their own LPO number, type it in and it is kept as typed. Prefixes are set by `lpoPrefix` in `companies.js`.

## Phone app, faster orders, updates, summaries and Excel

- **Install on the phone:** the system is an installable app (Install app button, or Add to Home Screen on iPhone). It opens full screen and loads with no signal.
- **Faster order entry:** type to search products, **Repeat last order** for regular institutions, and unfinished orders are kept as drafts. With no signal an order is saved on the phone and sent automatically; it can never be created twice.
- **Updates for merchandisers:** they are texted when their order is priced, dispatched and delivered (set their phone on the Staff screen; `STATUS_NOTIFY`).
- **Handheld scanners (Zebra etc.):** they work as a keyboard, with Enter or Tab at the end. Scans are caught even when the cursor is elsewhere, double reads are ignored, and *Handheld scanner mode* hides the on-screen keyboard. DataWedge setup steps are in DEPLOY.md (section 4b).
- **Clear scanning:** a big green tick or red cross, a beep and a buzz (switch it off with *Sound and vibration* on the Scan screen).
- **Managers:** low-stock warnings on the dashboard, and a daily summary email (orders, quotations, dispatches, deliveries, unpaid and overdue invoices, low stock). *Email today's summary now* sends it on demand.
- **Excel:** dashboard buttons export orders, payments, stock and products (with a date range). On *Products*, download the template, fill it in, press *Check file*, and confirm to import many products at once (SKUs are made automatically; nothing is added until you confirm).

## VAT per product

Each product is either **VAT charged** or **No VAT** (set when adding a product, in the *VAT* column on the Products list, or in the Excel import/template). When an order is priced, each line remembers the setting, and VAT is calculated only on the lines that carry it:
- Proforma, invoice and statement PDFs show `VAT (16% on KES 2,000.00)` when only some goods carry VAT, `VAT  Not charged` when none do, and the usual `VAT (16%)` when all do. Lines with no VAT are marked "No VAT".
- Changing a product later never alters an order that has already been priced; saving prices again on an open order picks up the new setting.
- Existing products and older orders are treated as *VAT charged*, exactly as before. Go through *Products* once and set *No VAT* where it applies.
- The VAT rate (16%) is still set per company and can be changed per invoice. The system does not separate "zero-rated" from "exempt": both are simply *No VAT*.

## Cartons, packs and optional VAT

- **Carton barcodes.** On *Print labels* choose **A whole carton** and the number of cartons: every carton gets its own barcode (like `KW-ZVR-RGL-290-C000007`) printed with a `CARTON | 100 PACKS` banner. **A single pack** makes one barcode per pack, as before.
- **Sizes.** On *Products* set the **Pad size**: 155 mm = 60 packs per carton, 290 mm and 340 mm = 100 packs per carton (filled in for you, editable per product, and per batch when labelling). The size is added to the SKU, so each size has its own code.
- **Stock is counted in packs.** Scanning a carton in, out or onto a shelf moves all its packs. Home, the stock export and the daily summary show packs, and cartons separately (e.g. `304 packs: 3 cartons + 4 loose packs`).
- **Orders are in packs.** On an order line you can count in cartons or packs; cartons are converted to packs (2 cartons of 100 = 200 packs). Allocation uses whole cartons first, then single packs. If an order cannot be made up exactly (for example 50 packs when only 100-pack cartons are in stock) it explains why and reserves nothing; order whole cartons, or make pack barcodes for the loose packs. Prices are per pack.
- **VAT is optional on every order.** When pricing, *Charge VAT on this order?* is *Yes: on goods marked VAT* (default) or *No VAT on this order* (the documents then say "VAT Not charged"). The rate can still be changed.

## Agent companies (Citroen, AeroParts, Maerns, ORBiken)
These four work **exactly like DedSilva and Kaynes**, with no separate logins. They appear in the **company switcher** at the top, next to DedSilva and Kaynes. Choose one and you work as that company:
- the **products and stock** are DedSilva's and Kaynes's (shared, so you never count stock twice);
- **orders, quotations, LPOs, invoices, delivery notes, payments and statements** work the same way, but every document carries **that company's own letterhead** (logo, address, phone, colours), its own numbers (`CT-ORD-00001`, `CT-QT-…`, `CT-INV-…`, `AP-…`, `MR-…`, `OB-…`) and its own customer list;
- an order can mix DedSilva and Kaynes products; the stock is set aside and scanned out as usual.

**Who can use them:** administrators see every company. For other staff, on **Staff** choose *Works in: Citroen only* (and so on) so a person works only for that company; they still see the DedSilva and Kaynes products and stock it sells. Merchandisers can take orders for an agent company the same way.

**Details to fill in:** open `companies.js` and complete the lines marked `TODO` (ORBiken's address and phone, every agent's email and bank / M-Pesa lines), then restart. Logos are in `public/img/`. Invoice-download codes go to each company's `otpEmail`, set `COMPANY_EMAIL_CT`, `_AP`, `_MR`, `_OB` (and `COMPANY_WHATSAPP_…`) in `.env`; if left blank they use `COMPANY_EMAIL`.

## Carton labels (all companies, including Kaynes)
On **Labels**, choose the product and **A whole carton**, then the **Carton size**: 155 mm = 60 packs, 290 mm and 340 mm = 100 packs each (or *Other size* to type the packs). One barcode and label is made for each carton. If the product has no pad size yet, the size you choose is saved on it, so orders and stock count its cartons correctly.

## Easier to use (latest)
- On a phone the top bar is smaller, so the screen below it has more room.
- Administrators and managers now start on **Home** (what needs doing); clerks start on **Scan**.
- The sign-in page has a **Show PIN** box, so a mistyped PIN is easy to spot.
- The label screen explains the carton size in plain words.

## Printing barcodes on a receipt (thermal) printer
On **Labels** set **Label width / printer** to **80 mm receipt printer** or **58 mm receipt printer** (match your paper roll), then **Make and print**. Each label comes out as its own ticket, the full width of the roll, so you can tear or cut and stick it on the carton.
In the print window that opens (once):
1. Choose your receipt printer.
2. Paper size: the roll width (80 mm or 58 mm) if it is listed; otherwise leave it as offered, the page size is set for you.
3. Margins: **None**. Scale: **100%**. Turn **Headers and footers** off.
The same setting also makes **Download PDF** produce one ticket per page at the roll size.
Tips: use a direct-thermal label roll for labels that must last (receipt paper fades with heat and time); 203 dpi printers read these barcodes fine; if a scanner struggles, print at 80 mm (bigger bars) and set the printer darkness a notch higher. Test by scanning one printed label on the Scan screen before printing a full batch.
