'use strict';
// Order-to-delivery workflow:
// request > proforma/quotation > order (LPO / verbal) > [stock check] > ordering/manufacturing >
// delivered in Nairobi > barcodes + allocation > invoice & delivery note > dispatch (OTP) > delivered
const crypto = require('crypto'), path = require('path'), fs = require('fs');
const companies = require('./companies');

const notify = require('./notify');

module.exports = function (app, db, { staff, mgr, take, wrap, bad, clean, audit }) {
  db.exec(`
  create table if not exists orders(id integer primary key, customer text, phone text, note text, status text not null,
    quote_no text, quote_amount text, auth_type text, lpo_no text, authorized_by text, supplier_ref text, inv_no text, dn_no text,
    receiver_name text, receiver_phone text, rider text, rider_phone text, vehicle text, rider_auth_by text, carrier text,
    otp_salt text, otp_hash text, otp_tries integer default 0, created integer, created_by text, updated integer);
  create table if not exists order_items(order_id integer, pid integer, qty integer);
  create table if not exists order_codes(order_id integer, code text primary key);
  create table if not exists order_events(id integer primary key, order_id integer, at integer, by text, text text);
  `);

  // add the invoice columns to databases created before this version
  const colsOf = t => db.prepare(`pragma table_info(${t})`).all().map(c => c.name);
  if (!colsOf('order_items').includes('price')) db.exec('alter table order_items add column price real');
  if (!colsOf('order_items').includes('vat')) db.exec('alter table order_items add column vat integer');   // 0 = no VAT on this line, 1 or empty = VAT charged
  [['vat_rate', 'real'], ['inv_at', 'integer'], ['inv_by', 'text'], ['company_id', 'integer default 1'],
    ['client_id', 'text'], ['address', 'text'], ['customer_id', 'integer'], ['quote_at', 'integer'], ['quote_by', 'text'], ['quote_valid_days', 'integer'], ['terms_days', 'integer'], ['due_at', 'integer']].forEach(([c, t]) => { if (!colsOf('orders').includes(c)) db.exec(`alter table orders add column ${c} ${t}`); });

  // one-time codes that unlock the invoice PDF (sent to the company email, never shown in the app)
  db.exec(`create table if not exists invoice_otps(order_id integer primary key, salt text, hash text, tries integer default 0,
    expires integer, sent_at integer, auth_by text, requested_by text)`);

  db.exec('update orders set company_id=1 where company_id is null');
  db.exec('create table if not exists doc_seq(k text primary key, n integer not null)');
  const co = id => companies.byId(id);
  const needCo = (u, cid) => { if (!companies.can(u, cid)) throw bad('You do not have access to this company.', 403); };
  const pad = id => String(id).padStart(5, '0');
  const refOf = o => co(o.company_id).orderPrefix + '-' + pad(o.id);
  // next invoice number for a company: INV-00008, KW-INV-00001 ... (counted per company, no gaps from the other company's orders)
  function nextInvoiceNo(cid) {
    const prefix = co(cid).invoicePrefix, key = 'inv:' + cid;
    const row = db.prepare('select n from doc_seq where k=?').get(key);
    let n = row ? row.n : 0;
    if (!row) { // first use: continue after the highest number already issued to this company
      const re = new RegExp('^' + prefix.replace(/[^\w]/g, '\\$&') + '-(\\d+)$');
      for (const r of db.prepare('select inv_no from orders where company_id=? and inv_no is not null').all(cid)) { const m = re.exec(r.inv_no); if (m) n = Math.max(n, +m[1]); }
    }
    do { n++; } while (db.prepare('select 1 from orders where inv_no=?').get(prefix + '-' + pad(n)));
    db.prepare('insert into doc_seq(k,n) values(?,?) on conflict(k) do update set n=excluded.n').run(key, n);
    return prefix + '-' + pad(n);
  }
  // next LPO number for a company: LPO-00001, KW-LPO-00001 ... (used when the order is confirmed and no LPO number is typed)
  function nextLpoNo(cid) {
    const c = co(cid), prefix = c.lpoPrefix || (c.code || 'DS') + '-LPO', key = 'lpo:' + cid;
    const row = db.prepare('select n from doc_seq where k=?').get(key);
    let n = row ? row.n : 0;
    if (!row) {
      const re = new RegExp('^' + prefix.replace(/[^\w]/g, '\\$&') + '-(\\d+)$');
      for (const r of db.prepare('select lpo_no from orders where company_id=? and lpo_no is not null').all(cid)) { const m = re.exec(r.lpo_no); if (m) n = Math.max(n, +m[1]); }
    }
    do { n++; } while (db.prepare('select 1 from orders where lpo_no=?').get(prefix + '-' + pad(n)));
    db.prepare('insert into doc_seq(k,n) values(?,?) on conflict(k) do update set n=excluded.n').run(key, n);
    return prefix + '-' + pad(n);
  }
  const ref = id => { const o = db.prepare('select id,company_id from orders where id=?').get(id); return o ? refOf(o) : 'ORD-' + pad(id); };
  const log = (id, by, text) => db.prepare('insert into order_events(order_id,at,by,text) values(?,?,?,?)').run(id, Date.now(), by, text);
  // Text the merchandiser who took an order when it is priced, dispatched or delivered, so they need not keep asking the office.
  // STATUS_NOTIFY = sms (default) | whatsapp | both | off.  Their number is set on the Staff screen.
  const STATUS_MSG = { quoted: 'has been priced and a quotation is ready', dispatched: 'has been dispatched and is on its way', delivered: 'has been delivered and confirmed by the receiver' };
  function notifyCreator(id, st) {
    const mode = (process.env.STATUS_NOTIFY || 'sms').toLowerCase();
    if (!STATUS_MSG[st] || mode === 'off') return;
    setImmediate(async () => {
      try {
        const o = db.prepare('select * from orders where id=?').get(id); if (!o) return;
        const u = db.prepare("select phone from users where name=? and role='merchandiser' and active=1").get(o.created_by);
        if (!u || !u.phone) return;
        const mark = 'Merchandiser notified (' + st + ')';
        if (db.prepare('select 1 from order_events where order_id=? and text like ?').get(id, mark + '%')) return;   // once per stage
        const text = `${co(o.company_id).short}: order ${refOf(o)} for ${o.customer} ${STATUS_MSG[st]}.`, sent = [];
        if (mode === 'sms' || mode === 'both') { const r = await notify.sms(u.phone, text); if (r.ok) sent.push('SMS'); }
        if (mode === 'whatsapp' || mode === 'both') { const r = await notify.whatsapp(u.phone, { text, textOnly: true }); if (r.ok) sent.push('WhatsApp'); }
        log(id, 'system', sent.length ? `${mark} by ${sent.join(' and ')} on ${notify.maskPhone(u.phone)}` : `Could not text the merchandiser about this (${st})`);
      } catch (e) { console.error('Status text failed:', e.message); }
    });
  }
  const setStatus = (id, st) => { db.prepare('update orders set status=?, updated=? where id=?').run(st, Date.now(), id); notifyCreator(id, st); };
  // Quantities are in PACKS. A pack barcode is worth 1 pack; a carton barcode is worth the packs in that carton (60, 100 ...).
  const freeCount = pid => db.prepare("select coalesce(sum(coalesce(units,1)),0) c from codes where pid=? and status='in_stock' and code not in (select code from order_codes)").get(pid).c;
  const freeCartons = pid => db.prepare("select count(*) c from codes where pid=? and kind='carton' and status='in_stock' and code not in (select code from order_codes)").get(pid).c;
  const haveOf = (oid, pid) => db.prepare('select coalesce(sum(coalesce(cd.units,1)),0) c from order_codes oc join codes cd on cd.code=oc.code where oc.order_id=? and cd.pid=?').get(oid, pid).c;
  // choose barcodes worth exactly `need` packs: whole cartons first (oldest first, never more than still needed), then single packs
  function pickFor(pid, need) {
    const free = db.prepare("select code,coalesce(units,1) units,coalesce(kind,'pack') kind from codes where pid=? and status='in_stock' and code not in (select code from order_codes) order by at, rowid").all(pid);
    const take = []; let left = need;
    for (const c of free) if (c.kind === 'carton' && c.units <= left) { take.push(c.code); left -= c.units; }
    for (const c of free) { if (left <= 0) break; if (c.kind !== 'carton') { take.push(c.code); left -= 1; } }
    return { codes: take, short: Math.max(0, left) };
  }
  const pname = pid => (db.prepare('select name from products where id=?').get(pid) || {}).name || 'item';
  const normPhone = p => { p = String(p || '').replace(/[^\d+]/g, ''); if (/^0\d{9}$/.test(p)) return '+254' + p.slice(1); if (/^254\d{9}$/.test(p)) return '+' + p; return p; };
  const hashOtp = (otp, salt) => crypto.createHash('sha256').update(salt + String(otp)).digest('hex');
  const getJsPDF = () => require('jspdf').jsPDF;
  const kes = n => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function allocate(o) { // all-or-nothing: reserve barcoded in-stock items for this order
    const plan = [];
    for (const it of db.prepare('select pid,qty from order_items where order_id=?').all(o.id)) {
      const need = it.qty - haveOf(o.id, it.pid);
      if (need > 0) {
        const got = pickFor(it.pid, need), free = freeCount(it.pid);
        if (got.short > 0) {
          const cq = (db.prepare('select carton_qty q from products where id=?').get(it.pid) || {}).q;
          return { ok: false, msg: `${pname(it.pid)}: need ${need} packs but ${free < need ? `only ${free} packs are in stock and unallocated` : `the stock cannot be made up exactly (${freeCartons(it.pid)} whole carton(s) in stock${cq ? `, ${cq} packs each` : ''}; ${got.short} pack(s) would have to come from a carton that is already open). Order whole cartons, or make pack barcodes for the loose packs`}.` };
        }
        plan.push(...got.codes);
      }
    }
    const ins = db.prepare('insert into order_codes(order_id,code) values(?,?)');
    db.transaction(() => plan.forEach(c => ins.run(o.id, c)))();
    return { ok: true };
  }

  // Delivery code for the RECEIVER: one SMS to the receiver's own phone. The code is never shown in the app (the rider must not see it),
  // unless OTP_SHOW_ON_SCREEN=true, which is for testing only.
  const SHOW_OTP = process.env.OTP_SHOW_ON_SCREEN === 'true', SMS_COOLDOWN = 45e3, lastSms = new Map();
  async function issueOtp(o, by) {
    const wait = SMS_COOLDOWN - (Date.now() - (lastSms.get(o.id) || 0));
    if (wait > 0) throw bad(`A code was just sent. Wait ${Math.ceil(wait / 1000)} seconds before sending another.`, 429);
    const otp = String(crypto.randomInt(100000, 1000000)), salt = crypto.randomBytes(8).toString('hex');
    db.prepare('update orders set otp_salt=?, otp_hash=?, otp_tries=0, updated=? where id=?').run(salt, hashOtp(otp, salt), Date.now(), o.id);
    lastSms.set(o.id, Date.now());
    const sms = await notify.sms(o.receiver_phone, `${co(o.company_id).short} delivery ${ref(o.id)}: your code is ${otp}. Give it to the rider ONLY after you have received your goods.`);
    return { otp, sms };
  }
  // what the browser is told about the delivery code (the code itself only in test mode)
  const otpOut = r => ({ smsSent: !!r.sms.ok, smsTo: notify.maskPhone(r.sms.to), smsConfigured: notify.smsConfigured(), smsError: r.sms.ok ? '' : r.sms.error, ...(SHOW_OTP ? { otp: r.otp } : {}) });

  // role 'clerk' gets no prices, totals or payments
  // role 'merchandiser' sees ONLY the requests they entered themselves, and only what they typed (no prices, stock, payments, codes, riders or history)
  function list(cids, role, userName) {
    const ids = cids && cids.length ? cids : [];
    if (role === 'merchandiser') {
      return db.prepare(`select * from orders where company_id in (${ids.map(() => '?').join(',') || 'null'}) and created_by=? order by id desc limit 200`).all(...ids, userName || '')
        .map(o => ({ id: o.id, ref: refOf(o), company_id: o.company_id, customer: o.customer, phone: o.phone, address: o.address, note: o.note, status: o.status, created: o.created, updated: o.updated,
          items: db.prepare('select pid,qty from order_items where order_id=?').all(o.id), codes: [], events: [], payments: [] }));
    }
    return db.prepare(`select * from orders where company_id in (${ids.map(() => '?').join(',') || 'null'}) order by id desc limit 500`).all(...ids).map(o => full(o, role === 'clerk'));
  }
  function full(o, noMoney) {
    {
      const { otp_salt, otp_hash, ...r } = o;
      r.ref = refOf(o);
      Object.assign(r, fin.moneyOf(o)); r.payments = fin.paymentsOf(o.id);
      r.items = db.prepare('select pid,qty,price,vat from order_items where order_id=?').all(o.id).map(it => ({ ...it, alloc: haveOf(o.id, it.pid), free: freeCount(it.pid) }));
      if (noMoney) { r.items = r.items.map(({ price, ...i }) => i); ['subtotal', 'vat_amount', 'taxable', 'exempt', 'total', 'paid', 'balance', 'pay_status', 'days_overdue', 'quote_amount', 'vat_rate', 'payments'].forEach(k => delete r[k]); }
      r.codes = db.prepare("select oc.code, cd.status, coalesce(cd.units,1) units, coalesce(cd.kind,'pack') kind from order_codes oc join codes cd on cd.code=oc.code where oc.order_id=? order by oc.code").all(o.id);
      r.events = db.prepare('select at,by,text from order_events where order_id=? order by id').all(o.id);
      return r;
    }
  }

  /* ---- create ---- */
  app.post('/api/orders', take, wrap((req, res) => {
    const customer = clean(req.body.customer, 120);
    if (!customer) throw bad('Enter the customer name.');
    // an order saved on a phone with no signal is sent again later: the same client_id never makes a second order
    const clientId = clean(req.body.client_id, 40);
    if (clientId) { const dup = db.prepare('select id from orders where created_by=? and client_id=?').get(req.user.name, clientId); if (dup) return res.json({ id: dup.id, ref: ref(dup.id), duplicate: true }); }
    if (req.user.role === 'merchandiser') { // brake on mistakes and misuse: a merchandiser can enter 40 requests an hour
      const n = db.prepare('select count(*) c from orders where created_by=? and created>?').get(req.user.name, Date.now() - 3600e3).c;
      if (n >= 40) throw bad('You have entered a lot of requests in the last hour. Please wait a little, or ask the office.', 429);
    }
    const cid = +req.body.company_id || companies.ids(req.user)[0]; needCo(req.user, cid);
    const merged = {};
    (Array.isArray(req.body.items) ? req.body.items : []).forEach(i => {
      const pid = +i.pid, qty = parseInt(i.qty);
      if (db.prepare(`select 1 from products where id=? and company_id in (${companies.catalogIds(cid).join(',')})`).get(pid) && qty > 0 && qty <= 100000) merged[pid] = (merged[pid] || 0) + qty;
    });
    if (!Object.keys(merged).length) throw bad('Add at least one item with a quantity.');
    const id = db.transaction(() => {
      const phone = normPhone(req.body.phone), address = clean(req.body.address, 200);
      const cust = fin.resolveCustomer(cid, { customer_id: req.body.customer_id, name: customer, phone, address }, req.user.name);
      const id = db.prepare('insert into orders(customer,phone,address,customer_id,note,status,created,created_by,updated,company_id,client_id) values(?,?,?,?,?,?,?,?,?,?,?)')
        .run(cust.name, phone || cust.phone, address || cust.address, cust.id, clean(req.body.note, 500), 'request', Date.now(), req.user.name, Date.now(), cid, clientId || null).lastInsertRowid;
      Object.entries(merged).forEach(([pid, qty]) => db.prepare('insert into order_items(order_id,pid,qty) values(?,?,?)').run(id, +pid, qty));
      log(id, req.user.name, req.user.role === 'merchandiser' ? 'Request taken by merchandiser' : 'Request received');
      if (req.user.role === 'merchandiser') audit(req.user.name, `Took order request ${ref(id)} for ${cust.name}`);
      return id;
    })();
    res.json({ id, ref: ref(id) });
  }));

  /* ---- customers, payments and statements (finance.js) ---- */
  const fin = require('./finance')(db, { mgr, wrap, bad, clean, needCo, log, audit, normPhone, refOf, pdfContext, getJsPDF });
  fin.backfill();
  { // invoices issued before due dates existed: assume the standard terms from the invoice date
    const upd = db.prepare('update orders set terms_days=?, due_at=? where id=?');
    for (const r of db.prepare('select id, company_id, inv_at from orders where inv_no is not null and due_at is null').all()) {
      const days = co(r.company_id).termsDays || 30; upd.run(days, fin.endOfDay((r.inv_at || Date.now()) + days * 86400e3), r.id);
    }
  }
  fin.routes(app);

  /* ---- confirm delivery with the receiver's one-time code ---- */
  app.post('/api/orders/:id/deliver', staff, wrap((req, res) => {
    const o = db.prepare('select * from orders where id=?').get(+req.params.id);
    if (!o || o.status !== 'dispatched') throw bad('This order is not out for delivery.');
    needCo(req.user, o.company_id);
    if (o.otp_tries >= 5) throw bad('Too many wrong codes. A manager must issue a new code or override with a reason.', 429);
    const otp = String(req.body.otp || '').trim();
    const a = Buffer.from(hashOtp(otp, o.otp_salt)), b = Buffer.from(o.otp_hash);
    if (!otp || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      db.prepare('update orders set otp_tries=otp_tries+1 where id=?').run(o.id);
      throw bad(`Wrong code. ${4 - o.otp_tries} attempt(s) left.`, 400);
    }
    setStatus(o.id, 'delivered'); log(o.id, req.user.name, 'Delivery confirmed with the receiver\u2019s one-time code');
    res.json({ ok: true });
  }));

  /* ---- invoice PDF: unlocked by a one-time code emailed to the company ---- */
  const OTP_LIFE = 10 * 60e3, OTP_RESEND = 60e3, OTP_TRIES = 5;
  const mask = notify.maskEmail;

  app.post('/api/orders/:id/invoice-otp', staff, (req, res) => {
    (async () => {
      const o = db.prepare('select * from orders where id=?').get(+req.params.id);
      if (!o) throw bad('Order not found.', 404);
      needCo(req.user, o.company_id);
      if (!o.inv_no) throw bad('This order has no invoice yet.');
      const authBy = clean(req.body.authorized_by, 80);
      if (authBy.length < 3) throw bad('Enter the name of the person authorising this download.');
      const prev = db.prepare('select sent_at from invoice_otps where order_id=?').get(o.id);
      if (prev && Date.now() - prev.sent_at < OTP_RESEND) throw bad(`A code was just sent. Wait ${Math.ceil((OTP_RESEND - (Date.now() - prev.sent_at)) / 1000)} seconds before asking for another.`, 429);
      const otp = String(crypto.randomInt(100000, 1000000)), salt = crypto.randomBytes(8).toString('hex'), now = Date.now();
      db.prepare(`insert into invoice_otps(order_id,salt,hash,tries,expires,sent_at,auth_by,requested_by) values(?,?,?,0,?,?,?,?)
        on conflict(order_id) do update set salt=excluded.salt, hash=excluded.hash, tries=0, expires=excluded.expires, sent_at=excluded.sent_at, auth_by=excluded.auth_by, requested_by=excluded.requested_by`)
        .run(o.id, salt, hashOtp(otp, salt), now + OTP_LIFE, now, authBy, req.user.name);
      const c = co(o.company_id), mins = OTP_LIFE / 60e3;
      const [em, wa] = await Promise.all([
        notify.email({ to: c.otpEmail, fromName: c.name, subject: `${c.short} invoice ${o.inv_no}: download code ${otp}`,
          text: `${c.name}\nInvoice download authorisation\n\nOrder: ${ref(o.id)}\nInvoice: ${o.inv_no}\nCustomer: ${o.customer}\nRequested by: ${req.user.name}\nAuthorised by: ${authBy}\n\n` +
            `One-time code: ${otp}\n\nThe code works once and expires in ${mins} minutes. If you did not expect this request, ignore this email.` }),
        notify.whatsapp(c.otpWhatsapp, { code: otp, text: `${c.short} invoice ${o.inv_no}: download code ${otp}\nRequested by ${req.user.name}, authorised by ${authBy}.\nWorks once, expires in ${mins} minutes. Do not share. If you did not expect this, ignore it.` })
      ]);
      const sent = em.ok || wa.ok;
      const chan = { email: { ok: em.ok, to: c.otpEmail ? mask(c.otpEmail) : '' }, whatsapp: { ok: wa.ok, to: c.otpWhatsapp ? notify.maskPhone(c.otpWhatsapp) : '' } };
      log(o.id, req.user.name, `Invoice download requested, authorised by ${authBy}. One-time code: ` +
        (sent ? [em.ok && 'emailed to ' + chan.email.to, wa.ok && 'sent by WhatsApp to ' + chan.whatsapp.to].filter(Boolean).join(' and ') : 'could not be delivered')
        + (sent && !(em.ok && wa.ok) ? ` (${!em.ok ? 'email' : 'WhatsApp'} failed)` : ''));
      res.json({ ok: true, sent, channels: chan, to: [em.ok && chan.email.to, wa.ok && chan.whatsapp.to].filter(Boolean).join(' and '), minutes: mins });
    })().catch(e => { if (!e.status) console.error(e); res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error' }); });
  });

  const logoCache = {};
  function logoData(c) {
    if (!(c.id in logoCache)) {
      logoCache[c.id] = null;
      try {
        const buf = fs.readFileSync(path.join(__dirname, 'public', 'img', c.logo)), ext = path.extname(c.logo).toLowerCase();
        logoCache[c.id] = { d: 'data:image/' + (ext === '.png' ? 'png' : 'jpeg') + ';base64,' + buf.toString('base64'), type: ext === '.png' ? 'PNG' : 'JPEG' };
      } catch (e) { /* no logo file: a text letterhead is used */ }
    }
    return logoCache[c.id];
  }
  const rgb = hex => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); return m ? [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)) : null; };
  const docs = require('./public/documents.js');
  const codesOf = oid => db.prepare('select cd.code, cd.pid from order_codes oc join codes cd on cd.code=oc.code where oc.order_id=?').all(oid);
  // everything a PDF needs to put one company's letterhead, product names and barcode on a page
  function pdfContext(cid) {
    const c = co(cid);
    return { products: db.prepare('select id,sku,name from products').all(), codes: [], JsBarcode: require('jsbarcode'), termsDays: c.termsDays,
      company: { name: c.name, short: c.short, tagline: c.tagline, color: rgb(c.color), accent: rgb(c.accent), logoHeight: c.logoHeight || 15, logoMaxW: c.logoMaxW || 0, logo: logoData(c), payment: c.paymentDetails || [],
        footer: [c.name, c.address, c.phone, c.email, c.web].filter(Boolean).join(' | ') } };
  }
  function sendPdf(res, doc, filename) {
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${String(filename).replace(/[^\w.-]/g, '_')}"`, 'Cache-Control': 'no-store' });
    res.send(Buffer.from(doc.output('arraybuffer')));
  }
  app.post('/api/orders/:id/invoice-pdf', staff, wrap((req, res) => {
    const o = db.prepare('select * from orders where id=?').get(+req.params.id);
    if (!o) throw bad('Order not found.', 404);
    needCo(req.user, o.company_id);
    if (!o.inv_no) throw bad('This order has no invoice yet.');
    const row = db.prepare('select * from invoice_otps where order_id=?').get(o.id);
    if (!row) throw bad('Request a code first. It is emailed to the company address.');
    if (Date.now() > row.expires) { db.prepare('delete from invoice_otps where order_id=?').run(o.id); throw bad('That code has expired. Request a new one.'); }
    if (row.tries >= OTP_TRIES) throw bad('Too many wrong codes. Request a new code.', 429);
    const otp = String(req.body.otp || '').trim(), a = Buffer.from(hashOtp(otp, row.salt)), b = Buffer.from(row.hash);
    if (!/^\d{6}$/.test(otp) || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      db.prepare('update invoice_otps set tries=tries+1 where order_id=?').run(o.id);
      throw bad(`Wrong code. ${OTP_TRIES - row.tries - 1} attempt(s) left.`);
    }
    db.prepare('delete from invoice_otps where order_id=?').run(o.id); // single use
    const when = Date.now();
    log(o.id, req.user.name, `Invoice ${o.inv_no} downloaded. Authorised by ${row.auth_by} with the one-time code`);
    const ord = full(o), c = co(o.company_id);
    const prepEvent = db.prepare("select by from order_events where order_id=? and text like 'Invoice %issued%' order by id limit 1").get(o.id);
    const ctx = pdfContext(o.company_id); ctx.codes = codesOf(o.id);
    ctx.sign = { preparedBy: o.inv_by || (prepEvent && prepEvent.by) || '', preparedAt: o.inv_at, authorizedBy: row.auth_by, authorizedAt: when };
    sendPdf(res, docs.invoice(getJsPDF(), ord, ctx), `${c.short}-${o.inv_no}.pdf`);
  }));

  /* ---- proforma invoice / quotation and delivery note: printable by signed-in staff, every print is logged ---- */
  app.post('/api/orders/:id/proforma-pdf', mgr, wrap((req, res) => {
    const o = db.prepare('select * from orders where id=?').get(+req.params.id);
    if (!o) throw bad('Order not found.', 404);
    needCo(req.user, o.company_id);
    if (!o.quote_no) throw bad('Record the proforma invoice / quotation first.');
    if (!(db.prepare('select count(*) c from order_items where order_id=? and price>0').get(o.id).c)) throw bad('Enter the unit prices first so the proforma can show amounts.');
    const ctx = pdfContext(o.company_id); ctx.sign = { preparedBy: o.quote_by || '', preparedAt: o.quote_at };
    log(o.id, req.user.name, `Proforma invoice / quotation ${o.quote_no} printed`);
    sendPdf(res, docs.proforma(getJsPDF(), full(o), ctx), `${co(o.company_id).short}-Proforma-${o.quote_no}.pdf`);
  }));
  app.post('/api/orders/:id/delivery-note-pdf', staff, wrap((req, res) => {
    const o = db.prepare('select * from orders where id=?').get(+req.params.id);
    if (!o) throw bad('Order not found.', 404);
    needCo(req.user, o.company_id);
    if (!o.dn_no || o.status === 'cancelled') throw bad('The delivery note is issued together with the invoice.');
    const ctx = pdfContext(o.company_id); ctx.codes = codesOf(o.id); ctx.sign = { preparedBy: o.inv_by || '', preparedAt: o.inv_at };
    log(o.id, req.user.name, `Delivery note ${o.dn_no} printed`);
    sendPdf(res, docs.deliveryNote(getJsPDF(), full(o, true), ctx), `${co(o.company_id).short}-DeliveryNote-${o.dn_no}.pdf`);
  }));

  /* ---- stage actions ---- */
  // unit prices typed on the form (price_<product id>); a blank box keeps the price already saved on the order
  function readPrices(o, b) {
    const have = Object.fromEntries(db.prepare('select pid,price from order_items where order_id=?').all(o.id).map(r => [r.pid, r.price]));
    return Object.keys(have).map(k => {
      const raw = b['price_' + k], p = raw === undefined || raw === null || raw === '' ? have[k] : Number(raw);
      if (!(p > 0 && p < 1e9)) throw bad(`Enter a unit price for ${pname(+k)}.`);
      return [+k, Math.round(p * 100) / 100];
    });
  }
  // VAT on an order is optional: vat_on 'no' charges no VAT at all; 'yes' (the default) charges the rate on goods marked as carrying VAT
  function readVat(o, b) {
    if (b.vat_on === 'no' || b.vat_on === false || b.vat_on === '0') return 0;
    const prev = o.vat_rate == null ? null : +o.vat_rate;
    const vat = b.vat_rate === undefined || b.vat_rate === '' ? (b.vat_on === 'yes' ? (prev > 0 ? prev : co(o.company_id).vat) : (prev == null ? co(o.company_id).vat : prev)) : Number(b.vat_rate);
    if (!(vat >= 0 && vat <= 100)) throw bad('VAT must be a percentage between 0 and 100.');
    return vat;
  }
  function readTerms(o, b) {
    const t = b.terms_days === undefined || b.terms_days === '' ? (o.terms_days != null ? o.terms_days : (co(o.company_id).termsDays != null ? co(o.company_id).termsDays : 30)) : Number(b.terms_days);
    if (!(Number.isInteger(t) && t >= 0 && t <= 365)) throw bad('Payment terms must be a whole number of days between 0 and 365.');
    return t;
  }
  // each line remembers whether its product carried VAT when it was priced, so changing a product later never alters an invoice already issued
  const savePrices = (o, prices) => prices.forEach(([pid, p]) => { const pr = db.prepare('select vat from products where id=?').get(pid); db.prepare('update order_items set price=?, vat=? where order_id=? and pid=?').run(p, pr && pr.vat === 0 ? 0 : 1, o.id, pid); });
  const totalOf = (prices, qtys, vat) => docs.totalsOf(prices.map(([pid, p]) => ({ pid, price: p, qty: qtys[pid], vat: (db.prepare('select vat from products where id=?').get(pid) || {}).vat })), vat).total;
  const qtyMap = o => Object.fromEntries(db.prepare('select pid,qty from order_items where order_id=?').all(o.id).map(r => [r.pid, r.qty]));

  const FROM = { prices: ['request', 'quoted', 'ordered', 'sourcing', 'in_nairobi', 'barcoded'], quote: ['request'], confirm: ['quoted'], source: ['ordered'], arrived: ['sourcing'], allocate: ['ordered', 'in_nairobi'],
    invoice: ['barcoded'], dispatch: ['invoiced'], newotp: ['dispatched'], override: ['dispatched'],
    cancel: ['request', 'quoted', 'ordered', 'sourcing', 'in_nairobi', 'barcoded', 'invoiced'] };
  const awrap = fn => (req, res) => { Promise.resolve().then(() => fn(req, res)).catch(e => { if (!e.status) console.error(e); res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error' }); }); };
  app.post('/api/orders/:id/:action', mgr, awrap(async (req, res) => {
    const o = db.prepare('select * from orders where id=?').get(+req.params.id), act = req.params.action, b = req.body, by = req.user.name;
    if (!o) throw bad('Order not found.', 404);
    needCo(req.user, o.company_id);
    if (!FROM[act]) throw bad('Unknown step.', 404);
    if (!FROM[act].includes(o.status)) throw bad(`This step is not available while the order is at "${o.status}".`);
    const out = { ok: true };
    if (act === 'prices') {
      const prices = readPrices(o, b), vat = readVat(o, b), terms = readTerms(o, b);
      db.transaction(() => { savePrices(o, prices); db.prepare('update orders set vat_rate=?, terms_days=?, updated=? where id=?').run(vat, terms, Date.now(), o.id); })();
      log(o.id, by, `Prices saved. Total with VAT KES ${kes(totalOf(prices, qtyMap(o), vat))}` + (o.quote_no ? ` (quotation ${o.quote_no} now shows these prices)` : ''));
    } else if (act === 'quote') {
      const prices = readPrices(o, b), vat = readVat(o, b), terms = readTerms(o, b), valid = Math.max(1, Math.min(90, parseInt(b.valid_days) || 14));
      const q = clean(b.quote_no, 40) || co(o.company_id).quotePrefix + '-' + pad(o.id), amount = 'KES ' + kes(totalOf(prices, qtyMap(o), vat));
      db.transaction(() => {
        savePrices(o, prices);
        db.prepare('update orders set quote_no=?, quote_amount=?, vat_rate=?, terms_days=?, quote_at=?, quote_by=?, quote_valid_days=? where id=?').run(q, amount, vat, terms, Date.now(), by, valid, o.id);
      })();
      setStatus(o.id, 'quoted'); log(o.id, by, `Proforma invoice / quotation ${q} issued (${amount} including VAT, valid ${valid} days)`);
    } else if (act === 'confirm') {
      const t = clean(b.auth_type, 10), who = clean(b.authorized_by, 80);
      let lpo = clean(b.lpo_no, 60);   // blank = made automatically (a customer's own LPO number can still be typed in)
      if (!['LPO', 'Verbal', 'Email'].includes(t)) throw bad('Choose how the order was authorised.');
      if (t === 'LPO' && !lpo) lpo = nextLpoNo(o.company_id);
      if (t !== 'LPO') lpo = '';
      if (t !== 'LPO' && !who) throw bad('Enter who authorised the order.');
      db.prepare('update orders set auth_type=?, lpo_no=?, authorized_by=? where id=?').run(t, lpo, who, o.id);
      setStatus(o.id, 'ordered'); log(o.id, by, 'Order confirmed: ' + (t === 'LPO' ? 'LPO ' + lpo : t + ' authorisation by ' + who));
      const r = allocate(o);
      if (r.ok) { setStatus(o.id, 'barcoded'); log(o.id, by, 'Stock is available and has been set aside for this order'); out.allocated = true; }
      else { log(o.id, by, 'Stock short: ' + r.msg); out.allocated = false; out.msg = r.msg; }
    } else if (act === 'source') {
      setStatus(o.id, 'sourcing'); log(o.id, by, 'Ordering or making the goods started');
    } else if (act === 'arrived') {
      db.prepare('update orders set supplier_ref=? where id=?').run(clean(b.supplier_ref, 80), o.id);
      setStatus(o.id, 'in_nairobi'); log(o.id, by, 'Goods delivered in Nairobi' + (b.supplier_ref ? ' (ref ' + clean(b.supplier_ref, 80) + ')' : ''));
    } else if (act === 'allocate') {
      const r = allocate(o);
      if (!r.ok) throw bad(r.msg + ' Print labels and scan the goods in (Receive) first.');
      setStatus(o.id, 'barcoded'); log(o.id, by, 'Barcoded items allocated to this order');
    } else if (act === 'invoice') {
      const typed = clean(b.inv_no, 40);
      if (typed && db.prepare('select 1 from orders where inv_no=? and id<>?').get(typed, o.id)) throw bad('That invoice number is already used.');
      const vat = readVat(o, b), prices = readPrices(o, b), terms = readTerms(o, b), now = Date.now();
      const inv = typed || nextInvoiceNo(o.company_id);
      db.transaction(() => {
        savePrices(o, prices);
        db.prepare('update orders set inv_no=?, dn_no=?, vat_rate=?, inv_at=?, inv_by=?, terms_days=?, due_at=? where id=?')
          .run(inv, co(o.company_id).dnPrefix + '-' + pad(o.id), vat, now, by, terms, fin.endOfDay(now + terms * 86400e3), o.id);
      })();
      setStatus(o.id, 'invoiced'); log(o.id, by, `Invoice ${inv} and delivery note issued. Total KES ${kes(totalOf(prices, qtyMap(o), vat))}, payment due in ${terms} days`);
    } else if (act === 'dispatch') {
      const total = db.prepare('select count(*) c from order_codes where order_id=?').get(o.id).c;
      const out2 = db.prepare("select count(*) c from order_codes oc join codes cd on cd.code=oc.code where oc.order_id=? and cd.status='dispatched'").get(o.id).c;
      if (out2 < total) throw bad(`${out2} of ${total} items scanned out. On the Scan screen choose Dispatch and this order, then scan every item.`);
      const f = { receiver_name: clean(b.receiver_name, 80), receiver_phone: normPhone(b.receiver_phone), rider: clean(b.rider, 80), rider_auth_by: clean(b.rider_auth_by, 80) };
      if (!f.receiver_name || f.receiver_phone.length < 9) throw bad('Enter the receiver\u2019s name and phone number.');
      if (!f.rider || !f.rider_auth_by) throw bad('Enter the rider/driver and who authorised them.');
      db.prepare('update orders set receiver_name=?, receiver_phone=?, rider=?, rider_auth_by=?, rider_phone=?, vehicle=?, carrier=? where id=?')
        .run(f.receiver_name, f.receiver_phone, f.rider, f.rider_auth_by, clean(b.rider_phone, 20), clean(b.vehicle, 20), clean(b.carrier, 80), o.id);
      const r = await issueOtp({ ...o, receiver_phone: f.receiver_phone }, by);
      setStatus(o.id, 'dispatched'); log(o.id, by, `Dispatched with ${f.rider}, authorised by ${f.rider_auth_by}. One-time code ${r.sms.ok ? 'sent by SMS to ' + notify.maskPhone(f.receiver_phone) : 'could NOT be sent by SMS to ' + notify.maskPhone(f.receiver_phone) + ' (use Send a new code)'}`);
      Object.assign(out, otpOut(r));
    } else if (act === 'newotp') {
      const r = await issueOtp(o, by); log(o.id, by, 'New one-time code ' + (r.sms.ok ? 'sent by SMS to ' + notify.maskPhone(o.receiver_phone) : 'could NOT be sent by SMS to ' + notify.maskPhone(o.receiver_phone))); Object.assign(out, otpOut(r));
    } else if (act === 'override') {
      const why = clean(b.reason, 200); if (why.length < 5) throw bad('Give a reason (at least a few words).');
      setStatus(o.id, 'delivered'); log(o.id, by, 'Delivered. One-time code overridden. Reason: ' + why);
    } else if (act === 'cancel') {
      const why = clean(b.reason, 200); if (why.length < 3) throw bad('Give a reason for cancelling.');
      if (fin.moneyOf(o).paid > 0.004) throw bad('Payments are recorded on this invoice. Cancel those payments first (with a reason), then cancel the order.');
      db.prepare('delete from order_codes where order_id=?').run(o.id);
      setStatus(o.id, 'cancelled'); log(o.id, by, 'Order cancelled. Reason: ' + why);
    }
    res.json(out);
  }));

  return {
    list, customers: fin.customerList, fin,
    // used by the scan route: items on an order may only be dispatched against that order
    scanBlock(orderId, code) {
      const held = db.prepare('select order_id from order_codes where code=?').get(code);
      if (!orderId) return held ? `This item is allocated to ${ref(held.order_id)}. Choose that order on the Scan screen to dispatch it.` : null;
      const o = db.prepare('select * from orders where id=?').get(+orderId);
      if (!o) return 'Order not found.';
      if (o.status !== 'invoiced') return `${ref(o.id)} is not ready for dispatch (invoice and delivery note come first).`;
      if (!held || held.order_id !== o.id) return `This item is not part of ${ref(o.id)}.`;
      return null;
    }
  };
};
