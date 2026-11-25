'use strict';
// DedSilva Warehouse System - backend (Express + SQLite)
require('./loadenv');   // settings from the .env file (see .env.example)
process.env.TZ = process.env.TZ || 'Africa/Nairobi';   // times in reports and the daily summary
const express = require('express'), Database = require('better-sqlite3');
const crypto = require('crypto'), path = require('path'), fs = require('fs');

const PORT = process.env.PORT || 3000;
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(path.join(DATA, 'backups'), { recursive: true });
const db = new Database(path.join(DATA, 'wms.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
create table if not exists meta(k text primary key, v text);
create table if not exists users(id integer primary key, name text unique collate nocase, role text not null, salt text, hash text, active integer default 1, created integer);
create table if not exists products(id integer primary key, sku text unique collate nocase, name text not null, brand text, cat text, min integer default 0);
create table if not exists codes(code text primary key, pid integer references products(id), status text not null, loc text default '', lot text default '', site text, at integer);
create table if not exists prints(id integer primary key, code text, by text, at integer, reprint integer, site text);
create table if not exists scans(id text primary key, code text, action text, by text, site text, at integer, loc text, pname text, result text, prev text, prevLoc text, changed integer default 0, voided integer default 0);
create index if not exists ix_scans_code on scans(code);
create index if not exists ix_scans_at on scans(at);
`);

const notify = require('./notify'), codegen = require('./codes'), companies = require('./companies'), skuGen = require('./public/sku.js');
codegen.migrate(db);
companies.migrate(db);

// sign-in by username; a PIN set by an administrator must be changed at next sign-in; tv = token version (a reset signs the person out everywhere)
db.exec('create table if not exists audit(id integer primary key, at integer, by text, text text)');
for (const [col, def] of [['vat', 'integer default 1'], ['size_mm', 'integer'], ['carton_qty', 'integer']]) if (!db.prepare('pragma table_info(products)').all().some(c => c.name === col)) db.exec(`alter table products add column ${col} ${def}`);   // size_mm = pad length, carton_qty = packs in one carton   // 1 = VAT is charged on this product, 0 = no VAT
{
  const cols = db.prepare('pragma table_info(users)').all().map(c => c.name);
  [['username', 'text'], ['must_change', 'integer default 0'], ['tv', 'integer default 0'], ['phone', 'text']].forEach(([c, t]) => { if (!cols.includes(c)) db.exec(`alter table users add column ${c} ${t}`); });
  db.exec('create unique index if not exists ux_users_username on users(username collate nocase)');
}
const audit = (by, text) => db.prepare('insert into audit(at,by,text) values(?,?,?)').run(Date.now(), by, text);
// jane.wanjiku from "Jane Wanjiku"; a number is added if it is taken
function uniqueUsername(name, exceptId) {
  let base = String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').slice(0, 26);
  if (base.length < 3) base = (base + '.user').slice(0, 26);
  let u = base, n = 1;
  while (db.prepare('select 1 from users where username=? and id is not ?').get(u, exceptId || null)) u = base + (++n);
  return u;
}
db.prepare("select id, name from users where username is null or username=''").all().forEach(u => db.prepare('update users set username=? where id=?').run(uniqueUsername(u.name, u.id), u.id));

const getMeta = k => (db.prepare('select v from meta where k=?').get(k) || {}).v;
const setMeta = (k, v) => db.prepare('insert into meta(k,v) values(?,?) on conflict(k) do update set v=excluded.v').run(k, String(v));
let SECRET = process.env.SECRET || getMeta('secret');
if (!SECRET) { SECRET = crypto.randomBytes(32).toString('hex'); setMeta('secret', SECRET); }

// Starting catalogue taken from the DedSilva company profile (edit freely in the app)
if (!db.prepare('select count(*) c from products').get().c) {
  const P = [['Pitwan\u2122','Tactical gear','Quick-release vest','PTW-QRV'],['Pitwan\u2122','Tactical gear','Plate carrier','PTW-PLC'],['Pitwan\u2122','Tactical gear','Hydration pack','PTW-HYD'],['Pitwan\u2122','Tactical gear','Reinforced backpack','PTW-BPK'],['Pitwan\u2122','Tactical gear','Low-IR field shelter','PTW-LIR'],
    ['Slayer\u2122','Outdoor & camping','Quick-pitch tent','SLY-QPT'],['Slayer\u2122','Outdoor & camping','Thermal sleeping system','SLY-THS'],['Slayer\u2122','Outdoor & camping','Portable stove','SLY-STV'],['Slayer\u2122','Outdoor & camping','Solar kit','SLY-SOL'],['Slayer\u2122','Outdoor & camping','Frame tent','SLY-FRT'],
    ['DedSilva','CASEVAC','Rigid stretcher','CSV-RST'],['DedSilva','CASEVAC','Collapsible stretcher','CSV-CST'],['DedSilva','CASEVAC','Basket stretcher','CSV-BST'],['DedSilva','CASEVAC','Evacuation chair','CSV-EVC'],['DedSilva','CASEVAC','Spine board with immobilisation','CSV-SPB'],['DedSilva','CASEVAC','Evacuation harness or sling','CSV-HSL'],
    ['DedSilva','SAR equipment','First-aid kit','SAR-FAK'],['DedSilva','SAR equipment','Trauma / responder bag','SAR-TRB']];
  const ins = db.prepare('insert into products(brand,cat,name,sku,min) values(?,?,?,?,0)');
  db.transaction(() => P.forEach(r => ins.run(...r)))();
}

companies.seedProducts(db); // other companies' starting catalogues (once)

/* ---------- security helpers ---------- */
const hashPin = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString('hex');
const mkPw = pin => { const salt = crypto.randomBytes(16).toString('hex'); return { salt, hash: hashPin(pin, salt) }; };
const okPw = (u, pin) => { const a = Buffer.from(hashPin(pin, u.salt), 'hex'), b = Buffer.from(u.hash, 'hex'); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const sign = s => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
const mkToken = u => { const p = Buffer.from(JSON.stringify({ id: u.id, tv: u.tv || 0, exp: Date.now() + 12 * 3600e3 })).toString('base64url'); return p + '.' + sign(p); };
function readToken(t) {
  const [p, s] = String(t).split('.');
  if (!p || !s || sign(p) !== s) return null;
  try { const d = JSON.parse(Buffer.from(p, 'base64url')); return d.exp > Date.now() ? d : null; } catch (e) { return null; }
}
// failed-sign-in counters: 5 wrong PINs for one name from one place, 20 for one name from anywhere, 30 from one place for any names, then 15 minutes locked
const WINDOW = 15 * 60e3, fails = new Map();
const locked = (k, max) => { const f = fails.get(k); return !!f && f.n >= max && Date.now() - f.t < WINDOW; };
const failed = k => { const f = fails.get(k) || { n: 0, t: 0 }; if (Date.now() - f.t >= WINDOW) f.n = 0; f.n++; f.t = Date.now(); fails.set(k, f); };
const clearLocks = username => { for (const k of [...fails.keys()]) if (k === 'u|' + username || (k.startsWith('iu|') && k.endsWith('|' + username)) || k === 'cp|' + username) fails.delete(k); };
setInterval(() => { for (const [k, f] of fails) if (Date.now() - f.t >= WINDOW) fails.delete(k); }, 5 * 60e3).unref();
const DUMMY = { salt: '00'.repeat(16), hash: '00'.repeat(32) }; // checked when the username does not exist, so the reply takes the same time
const pinOk = p => typeof p === 'string' && p.length >= 6 && p.length <= 64;
// reject PINs like 111111, 123456, 654321 or 121212
const weakPin = p => /^(.+?)\1+$/.test(p) || (/^\d+$/.test(p) && [...p].every((d, i) => i === 0 || Math.abs(+d - +p[i - 1]) === 1 && (+d - +p[i - 1]) === (+p[1] - +p[0])));
const PIN_MSG = 'Choose a PIN of at least 6 characters that is not easy to guess (not 123456, 111111 or a repeated pattern).';
const validUsername = u => /^[a-z0-9][a-z0-9._-]{2,29}$/.test(u);
const clean = (v, n = 80) => String(v == null ? '' : v).trim().slice(0, n);

const app = express();
app.disable('x-powered-by');
// real client IPs when running behind Nginx/Caddy on the same server. Set TRUST_PROXY=1 (or a number of hops) if the proxy is elsewhere.
app.set('trust proxy', process.env.TRUST_PROXY ? (/^\d+$/.test(process.env.TRUST_PROXY) ? +process.env.TRUST_PROXY : process.env.TRUST_PROXY) : 'loopback');
// health check for the load balancer / uptime monitor / systemd (does not touch the database contents)
app.get('/healthz', (req, res) => { try { db.prepare('select 1').get(); res.type('text').send('ok'); } catch (e) { res.status(503).type('text').send('database error'); } });
const json100 = express.json({ limit: '100kb' });
app.use((req, res, next) => (req.path === '/api/products/import' ? next() : json100(req, res, next)));   // the spreadsheet import has its own, larger limit
app.use((req, res, next) => { res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
});
app.use((req, res, next) => {
  const h = req.headers.authorization || '', p = h.startsWith('Bearer ') ? readToken(h.slice(7)) : null;
  if (p) { const u = db.prepare('select id,name,username,role,companies,must_change,tv from users where id=? and active=1').get(p.id); if (u && (p.tv || 0) === (u.tv || 0)) req.user = u; }
  next();
});
// someone whose PIN was just reset can do nothing except set their own new PIN
app.use((req, res, next) => {
  if (req.user && req.user.must_change && !['/api/me', '/api/change-pin'].includes(req.path)) return res.status(403).json({ error: 'Set your new PIN before continuing.', code: 'must_change_pin' });
  next();
});
const need = (...roles) => (req, res, next) =>
  req.user && roles.includes(req.user.role) ? next() : res.status(req.user ? 403 : 401).json({ error: req.user ? 'Your role cannot do this.' : 'Sign in required.' });
// Roles. 'staff' = warehouse staff. The merchandiser is deliberately NOT in 'staff': they can sign in, change their own PIN,
// take orders and look items up, and nothing else (every other route below is limited to the roles named on it).
const staff = need('admin', 'manager', 'clerk'), mgr = need('admin', 'manager'), adm = need('admin');
const anyUser = need('admin', 'manager', 'clerk', 'merchandiser');
const ROLE_LIST = ['admin', 'manager', 'clerk', 'merchandiser'];
const MERCH_SCAN = ['view'];   // what a merchandiser may do with a scanner: look an item up (changes nothing)
const wrap = fn => (req, res) => { try { fn(req, res); } catch (e) { if (!e.status) console.error(e); res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error' }); } };
const bad = (m, s = 400) => { const e = new Error(m); e.status = s; return e; };
const userOut = u => ({ id: u.id, name: u.name, username: u.username, role: u.role, companies: companies.ids(u), mustChange: !!u.must_change });
// products, barcodes and stock belong to DedSilva or Kaynes; an agent company (Citroen ...) sells them, so its people may use them too
const needStock = (u, cid) => { if (!companies.canStock(u, cid)) throw bad('You do not have access to that company.', 403); };
const needCo = (u, cid) => { if (!companies.can(u, cid)) throw bad('You do not have access to that company.', 403); };
const companyOfCode = code => (db.prepare('select p.company_id c from codes cd join products p on p.id=cd.pid where cd.code=?').get(code) || {}).c;

/* ---------- auth ---------- */
app.get('/api/status', wrap((req, res) => {   // no staff names here: anyone can open this page
  res.json({ setup: db.prepare('select count(*) c from users').get().c === 0, companies: companies.COMPANIES.map(c => ({ name: c.name })) });
}));
app.post('/api/setup', wrap((req, res) => {
  if (db.prepare('select count(*) c from users').get().c) throw bad('Setup is already done.', 403);
  const name = clean(req.body.name, 60), username = clean(req.body.username, 30).toLowerCase() || uniqueUsername(name);
  if (!name || !pinOk(req.body.pin)) throw bad('Enter a name and a PIN of at least 6 characters.');
  if (!validUsername(username)) throw bad('The username needs 3 to 30 letters, numbers, dots or dashes, with no spaces.');
  if (weakPin(req.body.pin)) throw bad(PIN_MSG);
  const { salt, hash } = mkPw(req.body.pin);
  const id = db.prepare("insert into users(name,username,role,salt,hash,created) values(?, ?, 'admin', ?, ?, ?)").run(name, username, salt, hash, Date.now()).lastInsertRowid;
  audit(name, 'Administrator account created');
  res.json({ token: mkToken({ id, tv: 0 }), user: userOut({ id, name, username, role: 'admin' }) });
}));
app.post('/api/login', wrap((req, res) => {
  const username = clean(req.body.username, 60).toLowerCase(), pin = String(req.body.pin || '');
  const k1 = 'iu|' + req.ip + '|' + username, k2 = 'u|' + username, k3 = 'i|' + req.ip;
  if (locked(k1, 5) || locked(k2, 20) || locked(k3, 30)) throw bad('Too many failed attempts. Try again in 15 minutes, or ask an administrator.', 429);
  const u = username ? db.prepare('select * from users where username=? and active=1').get(username) : null;
  const ok = u ? okPw(u, pin) : (okPw(DUMMY, pin), false);
  if (!ok) { failed(k1); failed(k2); failed(k3); throw bad('Wrong username or PIN.', 401); }   // the same message whichever part was wrong
  fails.delete(k1);
  res.json({ token: mkToken(u), user: userOut(u) });
}));
// change your own PIN (also how a reset PIN is replaced). Signs out every other session.
app.post('/api/change-pin', anyUser, wrap((req, res) => {
  const u = db.prepare('select * from users where id=? and active=1').get(req.user.id), key = 'cp|' + u.username;
  if (locked(key, 5)) throw bad('Too many wrong attempts. Try again in 15 minutes.', 429);
  const oldPin = String(req.body.oldPin || ''), nw = String(req.body.newPin || '');
  if (!okPw(u, oldPin)) { failed(key); throw bad('The current PIN is not right.', 401); }
  if (!pinOk(nw) || weakPin(nw)) throw bad(PIN_MSG);
  if (nw === oldPin) throw bad('The new PIN must be different from the current one.');
  const { salt, hash } = mkPw(nw), tv = (u.tv || 0) + 1;
  db.prepare('update users set salt=?, hash=?, must_change=0, tv=? where id=?').run(salt, hash, tv, u.id);
  fails.delete(key); audit(u.name, 'Changed own PIN');
  res.json({ token: mkToken({ id: u.id, tv }), user: userOut({ ...u, must_change: 0, tv }) });
}));
app.get('/api/me', anyUser, (req, res) => res.json({ user: userOut(req.user) }));

/* ---------- state (shape matches what the frontend renders) ---------- */
function state(u) {
  const mer = u.role === 'merchandiser', full = u.role !== 'clerk' && !mer, cids = companies.ids(u), ph = cids.map(() => '?').join(',') || 'null', sids = companies.stockIds(u), sph = sids.map(() => '?').join(',') || 'null';
  const last = (t, n, withNull) => db.prepare(`select * from (select x.rowid rid, x.*, p.company_id cid from ${t} x left join codes c on c.code=x.code left join products p on p.id=c.pid
    where p.company_id in (${sph})${withNull ? ' or p.company_id is null' : ''} order by x.at desc, x.rowid desc limit ?) order by at asc, rid asc`).all(...sids, n);
  return {
    companies: companies.COMPANIES.filter(c => cids.includes(c.id)).map(companies.publicInfo),
    products: db.prepare(`select id,sku,name,brand,cat,min,vat,size_mm,carton_qty,company_id from products where company_id in (${sph}) order by id`).all(...sids).map(p => mer ? { id: p.id, sku: p.sku, name: p.name, brand: p.brand, size_mm: p.size_mm, carton_qty: p.carton_qty, company_id: p.company_id } : p),
    codes: mer ? [] : db.prepare(`select c.code,c.pid,c.status,c.loc,c.lot,c.site,c.at,coalesce(c.units,1) units,coalesce(c.kind,'pack') kind,p.company_id cid from codes c join products p on p.id=c.pid where p.company_id in (${sph}) order by c.at, c.rowid`).all(...sids),
    prints: full ? last('prints', 3000).map(p => ({ ...p, reprint: !!p.reprint })) : [],
    scans: (mer ? last('scans', 300, true).filter(s => s.by === u.name).slice(-25) : last('scans', full ? 3000 : 25, true)).map(fixScan),
    orders: orders.list(cids, u.role, u.name),
    customers: u.role === 'clerk' ? [] : mer ? orders.customers(cids).map(c => ({ id: c.id, name: c.name, phone: c.phone, address: c.address, company_id: c.company_id })) : orders.customers(cids),
    users: u.role === 'admin' ? db.prepare('select id,name,username,role,companies,phone from users where active=1 order by id').all() : [],
    audit: u.role === 'admin' ? db.prepare('select at,by,text from audit order by id desc limit 15').all() : []
  };
}
const fixScan = s => ({ ...s, changed: !!s.changed, voided: !!s.voided });
app.get('/api/state', anyUser, wrap((req, res) => res.json(state(req.user))));

/* ---------- products and staff ---------- */
// change whether VAT is charged on a product (and its low-stock warning level). Invoices already issued are not touched.
app.patch('/api/products/:id', mgr, wrap((req, res) => {
  const p = db.prepare('select * from products where id=?').get(+req.params.id);
  if (!p) throw bad('Product not found.', 404);
  needStock(req.user, p.company_id);
  if (req.body.vat !== undefined) {
    const v = [0, '0', false, 'no'].includes(req.body.vat) ? 0 : 1;
    db.prepare('update products set vat=? where id=?').run(v, p.id);
    audit(req.user.name, `VAT on ${p.name} (${p.sku}) set to ${v ? 'VAT charged' : 'no VAT'}`);
  }
  if (req.body.min !== undefined) db.prepare('update products set min=? where id=?').run(Math.max(0, parseInt(req.body.min) || 0), p.id);
  if (req.body.size_mm !== undefined || req.body.carton_qty !== undefined) {   // pad size and packs per carton
    const size = req.body.size_mm === undefined ? p.size_mm : (req.body.size_mm === '' || req.body.size_mm === null ? null : parseInt(req.body.size_mm));
    let carton = req.body.carton_qty === undefined ? p.carton_qty : (req.body.carton_qty === '' || req.body.carton_qty === null ? null : parseInt(req.body.carton_qty));
    if (size !== null && !(size >= 1 && size <= 2000)) throw bad('Size must be a number of millimetres.');
    if (carton !== null && !(carton >= 0 && carton <= 10000)) throw bad('Packs per carton must be a whole number.');
    if (req.body.size_mm !== undefined && req.body.carton_qty === undefined && size && skuGen.cartonFor(size)) carton = skuGen.cartonFor(size);   // choosing a size fills in its usual carton
    db.prepare('update products set size_mm=?, carton_qty=? where id=?').run(size, carton || null, p.id);
    audit(req.user.name, `${p.name} (${p.sku}): size ${size ? size + ' mm' : 'not set'}, ${carton ? carton + ' packs per carton' : 'no carton size'}`);
  }
  res.json({ ok: true });
}));
app.post('/api/products', mgr, wrap((req, res) => {
  const b = req.body, name = clean(b.name, 120);
  // the SKU is made automatically from the brand and name when it is left blank or sent as automatic (a number is added if it is already taken)
  const size = b.size_mm === undefined || b.size_mm === '' || b.size_mm === null ? null : parseInt(b.size_mm);
  if (size !== null && !(size >= 1 && size <= 2000)) throw bad('Size must be a number of millimetres.');
  let carton = b.carton_qty === undefined || b.carton_qty === '' || b.carton_qty === null ? (size ? skuGen.cartonFor(size) : 0) : parseInt(b.carton_qty);
  if (!(carton >= 0 && carton <= 10000)) throw bad('Packs per carton must be a whole number.');
  let sku = codegen.norm(clean(b.sku, 40));
  if (!sku || b.auto) sku = codegen.norm(skuGen.suggest(clean(b.brand, 40), name, db.prepare('select sku from products').all().map(p => p.sku), size || 0)) || sku;
  if (!name || !sku) throw bad('Enter the product name. The SKU is made from it automatically.');
  if (sku.length > 24) throw bad('Keep the SKU to 24 characters or fewer so the barcode stays easy to scan.');
  const cid = +b.company_id || companies.ids(req.user)[0]; needCo(req.user, cid);
  if (db.prepare('select id,sku from products').all().some(p => codegen.norm(p.sku) === sku)) throw bad('That SKU already exists. Every product needs its own code, even across companies.', 409);
  db.prepare('insert into products(name,sku,brand,cat,min,company_id,vat,size_mm,carton_qty) values(?,?,?,?,?,?,?,?,?)').run(name, sku, clean(b.brand, 40), clean(b.cat, 40), Math.max(0, parseInt(b.min) || 0), cid, [0, '0', false, 'no'].includes(b.vat) ? 0 : 1, size, carton || null);
  res.json({ ok: true });
}));
app.post('/api/users', adm, wrap((req, res) => {
  const name = clean(req.body.name, 60), role = req.body.role, username = clean(req.body.username, 30).toLowerCase() || uniqueUsername(name);
  if (!name || !ROLE_LIST.includes(role) || !pinOk(req.body.pin)) throw bad('Enter a name, a role and a PIN of at least 6 characters.');
  if (!validUsername(username)) throw bad('The username needs 3 to 30 letters, numbers, dots or dashes, with no spaces.');
  if (weakPin(req.body.pin)) throw bad(PIN_MSG);
  const access = companies.parseAccess(req.body.companies); if (!access) throw bad('Choose which company the staff member works in.');
  if (db.prepare('select 1 from users where name=?').get(name)) throw bad('That name is already used.', 409);
  if (db.prepare('select 1 from users where username=?').get(username)) throw bad('That username is already taken.', 409);
  const phone = req.body.phone ? notify.toE164(req.body.phone) : ''; if (req.body.phone && !phone) throw bad('That phone number does not look right. Use a format like 0712 345 678.');
  const { salt, hash } = mkPw(req.body.pin);
  db.prepare('insert into users(name,username,role,salt,hash,created,companies,must_change,phone) values(?,?,?,?,?,?,?,1,?)').run(name, username, role, salt, hash, Date.now(), access, phone); // they choose their own PIN at first sign-in
  audit(req.user.name, `Added ${name} (${username}) as ${role}`);
  res.json({ ok: true, username });
}));
app.delete('/api/users/:id', adm, wrap((req, res) => {
  const id = +req.params.id, u = db.prepare('select * from users where id=? and active=1').get(id);
  if (!u) throw bad('User not found.', 404);
  if (id === req.user.id) throw bad('You cannot remove your own account.');
  if (u.role === 'admin' && db.prepare("select count(*) c from users where role='admin' and active=1").get().c < 2) throw bad('Keep at least one administrator.');
  db.prepare('update users set active=0, tv=tv+1 where id=?').run(id);
  audit(req.user.name, `Removed ${u.name} (${u.username})`);
  res.json({ ok: true });
}));

app.patch('/api/users/:id', adm, wrap((req, res) => {
  const id = +req.params.id, u = db.prepare('select * from users where id=? and active=1').get(id);
  if (!u) throw bad('User not found.', 404);
  if (req.body.companies !== undefined) {
    const access = companies.parseAccess(req.body.companies); if (!access) throw bad('Invalid company.');
    db.prepare('update users set companies=? where id=?').run(access, id);
  }
  if (req.body.phone !== undefined) {   // the number that gets order-status texts (merchandisers)
    const ph = req.body.phone ? notify.toE164(req.body.phone) : ''; if (req.body.phone && !ph) throw bad('That phone number does not look right. Use a format like 0712 345 678.');
    db.prepare('update users set phone=? where id=?').run(ph, id); audit(req.user.name, `Phone of ${u.name} ${ph ? 'set to ' + notify.maskPhone(ph) : 'removed'}`);
  }
  if (req.body.username !== undefined) {
    const un = clean(req.body.username, 30).toLowerCase();
    if (!validUsername(un)) throw bad('The username needs 3 to 30 letters, numbers, dots or dashes, with no spaces.');
    if (db.prepare('select 1 from users where username=? and id<>?').get(un, id)) throw bad('That username is already taken.', 409);
    db.prepare('update users set username=? where id=?').run(un, id); audit(req.user.name, `Username of ${u.name} changed from ${u.username} to ${un}`);
  }
  if (req.body.role !== undefined) {
    const role = req.body.role;
    if (!ROLE_LIST.includes(role)) throw bad('Invalid role.');
    if (id === req.user.id) throw bad('You cannot change your own role.');
    if (u.role === 'admin' && role !== 'admin' && db.prepare("select count(*) c from users where role='admin' and active=1").get().c < 2) throw bad('Keep at least one administrator.');
    db.prepare('update users set role=? where id=?').run(role, id); audit(req.user.name, `Role of ${u.name} changed from ${u.role} to ${role}`);
  }
  res.json({ ok: true });
}));
// "Forgot PIN": an administrator issues a temporary PIN (shown once). The person must choose their own at next sign-in.
app.post('/api/users/:id/reset-pin', adm, wrap((req, res) => {
  const id = +req.params.id, u = db.prepare('select * from users where id=? and active=1').get(id);
  if (!u) throw bad('User not found.', 404);
  if (id === req.user.id) throw bad('Use \"Change my PIN\" for your own account. Another administrator can reset yours.');
  let temp; do { temp = String(crypto.randomInt(10000000, 100000000)); } while (weakPin(temp));
  const { salt, hash } = mkPw(temp);
  db.prepare('update users set salt=?, hash=?, must_change=1, tv=tv+1 where id=?').run(salt, hash, id);
  clearLocks(u.username); audit(req.user.name, `Reset the PIN of ${u.name} (${u.username}); a temporary PIN was issued`);
  res.json({ ok: true, pin: temp, name: u.name, username: u.username });
}));
app.post('/api/users/:id/pin', adm, wrap((req, res) => {
  if (!pinOk(req.body.pin) || weakPin(req.body.pin)) throw bad(PIN_MSG);
  const u = db.prepare('select * from users where id=? and active=1').get(+req.params.id); if (!u) throw bad('User not found.', 404);
  if (u.id === req.user.id) throw bad('Use \"Change my PIN\" for your own account.');
  const { salt, hash } = mkPw(req.body.pin);
  db.prepare('update users set salt=?, hash=?, must_change=1, tv=tv+1 where id=?').run(salt, hash, u.id);
  clearLocks(u.username); audit(req.user.name, `Set a temporary PIN for ${u.name} (${u.username})`);
  res.json({ ok: true });
}));

/* ---------- labels and printing ---------- */
app.post('/api/labels', mgr, wrap((req, res) => {
  const pid = +req.body.pid, qty = Math.max(1, Math.min(200, parseInt(req.body.qty) || 1)), lot = clean(req.body.lot, 40), site = clean(req.body.site, 40);
  const prod = db.prepare('select company_id,carton_qty,name from products where id=?').get(pid);
  if (!prod) throw bad('Choose a product first.');
  needStock(req.user, prod.company_id);
  // kind 'carton': one barcode for each carton, worth a fixed number of packs (the product's packs-per-carton unless a different number is sent)
  const kind = req.body.kind === 'carton' ? 'carton' : 'pack';
  let units = 1;
  if (kind === 'carton') {
    units = parseInt(req.body.units) || prod.carton_qty || 0;
    if (!(units >= 2 && units <= 10000)) throw bad(`Enter how many packs are in each carton of ${prod.name}.`);
  }
  const out = db.transaction(() => codegen.issue(db, pid, qty, { lot, site, by: req.user.name, prefix: companies.byId(prod.company_id).barcodePrefix, kind, units }))();
  audit(req.user.name, kind === 'carton' ? `Made ${qty} carton barcode${qty === 1 ? '' : 's'} of ${units} packs for ${prod.name}` : `Made ${qty} pack barcode${qty === 1 ? '' : 's'} for ${prod.name}`);
  res.json({ codes: out, kind, units });
}));
app.post('/api/reprint', mgr, wrap((req, res) => {
  const list = (Array.isArray(req.body.codes) ? req.body.codes : []).slice(0, 500), site = clean(req.body.site, 40), now = Date.now();
  const ip = db.prepare('insert into prints(code,by,at,reprint,site) values(?,?,?,1,?)'), has = db.prepare('select 1 from codes where code=?');
  db.transaction(() => list.forEach(c => { if (has.get(String(c)) && companies.canStock(req.user, companyOfCode(String(c)))) ip.run(String(c), req.user.name, now, site); }))();
  res.json({ ok: true });
}));

/* ---------- scanning (the server is the single source of truth) ---------- */
const NAME = { printed: 'Printed', in_stock: 'In stock', picked: 'Picked', dispatched: 'Dispatched' };
app.post('/api/scan', wrap((req, res) => {
  const user = req.user, isStaff = !!user, code = clean(req.body.code, 60).toUpperCase();
  if (!code) throw bad('Empty scan.');
  const act = isStaff ? clean(req.body.action, 12) || 'view' : 'view', loc = clean(req.body.loc, 40), now = Date.now();
  if (user && user.role === 'merchandiser' && (!MERCH_SCAN.includes(act) || code.startsWith('LOC-'))) throw bad('Your role can only look items up. It cannot receive, move, pick or send out stock.', 403);
  const rec = { id: 's' + now + crypto.randomBytes(3).toString('hex'), code, action: act, by: user ? user.name : 'Guest', site: clean(req.body.site, 40), at: now, loc: '', pname: '', result: '', prev: null, prevLoc: '', changed: 0, voided: 0 };
  let cls = 'ok', msg = '', c = null, location = null;
  if (code.startsWith('LOC-')) {
    rec.action = 'location';
    if (!isStaff) { cls = 'warn'; msg = 'Location scan recorded'; }
    else { location = code.slice(4); rec.loc = location; msg = `Location set to ${location}. Now scan the items to put away.`; }
  } else {
    c = db.prepare('select c.*, p.name pname, p.company_id cid from codes c left join products p on p.id=c.pid where c.code=?').get(code);
    if (!c) { cls = isStaff ? 'bad' : 'ok'; msg = isStaff ? `Unknown code ${code}. It was never printed by this system.` : 'Scan recorded'; rec.result = isStaff ? 'Rejected: ' + msg : 'Unknown code'; }
    else {
      rec.pname = c.pname || ''; rec.prev = c.status; rec.prevLoc = c.loc || '';
      let st = c.status, lc = c.loc || '';
      const block = isStaff && !companies.canStock(user, c.cid) ? 'This item belongs to a company you do not have access to.' : act === 'dispatch' ? orders.scanBlock(req.body.order, code) : null;
      const low = s => NAME[s].toLowerCase();
      const what = (c.kind === 'carton' && c.units > 1) ? `${rec.pname} (carton of ${c.units} packs)` : rec.pname;   // messages say when it is a whole carton
      if (block) { cls = 'bad'; msg = block; }
      else if (act === 'view') msg = isStaff ? 'Scan recorded: ' + what : 'Scan recorded';
      else if (act === 'receive') { if (st === 'printed') { st = 'in_stock'; msg = 'Received ' + what; } else { cls = 'warn'; msg = 'Already scanned in. Current status: ' + NAME[st]; } }
      else if (act === 'putaway') {
        if (!loc) { cls = 'bad'; msg = 'Enter a shelf or location first.'; }
        else if (st === 'dispatched' || st === 'picked') { cls = 'bad'; msg = `Cannot put away: item is ${low(st)}.`; }
        else { st = 'in_stock'; lc = loc; rec.loc = loc; msg = `Stored ${what} at ${loc}`; }
      } else if (act === 'pick') {
        if (st === 'in_stock') { st = 'picked'; msg = `Picked ${what}` + (lc ? ' from ' + lc : ''); } else { cls = 'bad'; msg = `Cannot pick: item is ${low(st)}.`; }
      } else if (act === 'dispatch') {
        if (st === 'dispatched') { cls = 'bad'; msg = 'Duplicate: this item was already dispatched.'; }
        else if (st === 'picked' || st === 'in_stock') { st = 'dispatched'; lc = ''; msg = 'Dispatched ' + what; }
        else { cls = 'bad'; msg = 'Cannot dispatch: item was never received.'; }
      } else { cls = 'bad'; msg = 'Unknown action.'; }
      rec.changed = (st !== c.status || lc !== (c.loc || '')) ? 1 : 0;
      if (rec.changed) db.prepare('update codes set status=?, loc=? where code=?').run(st, lc, code);
      c = isStaff && !companies.canStock(user, c.cid) ? null : { ...c, status: st, loc: lc };
    }
  }
  if (!rec.result) rec.result = (cls === 'ok' ? 'OK: ' : cls === 'warn' ? 'Warning: ' : 'Rejected: ') + msg;
  db.prepare('insert into scans(id,code,action,by,site,at,loc,pname,result,prev,prevLoc,changed,voided) values(@id,@code,@action,@by,@site,@at,@loc,@pname,@result,@prev,@prevLoc,@changed,@voided)').run(rec);
  const out = { cls, msg, scan: fixScan(rec), location };
  if (isStaff && c) out.code = user.role === 'merchandiser' ? { code: c.code, pid: c.pid, status: c.status, cid: c.cid } : { code: c.code, pid: c.pid, status: c.status, loc: c.loc, lot: c.lot, site: c.site, at: c.at, cid: c.cid, units: c.units || 1, kind: c.kind || 'pack' };
  if (!isStaff) { out.scan = undefined; }
  res.json(out);
}));
app.post('/api/scans/:id/void', mgr, wrap((req, res) => {
  const s = db.prepare('select * from scans where id=?').get(req.params.id);
  if (!s || !s.changed || s.voided || !s.prev) throw bad('This scan cannot be voided.');
  needStock(req.user, companyOfCode(s.code));
  const latest = db.prepare('select id from scans where code=? and changed=1 and voided=0 order by at desc, rowid desc limit 1').get(s.code);
  if (!latest || latest.id !== s.id) throw bad('Only the latest status change of an item can be voided.');
  db.transaction(() => {
    db.prepare('update codes set status=?, loc=? where code=?').run(s.prev, s.prevLoc || '', s.code);
    db.prepare('update scans set voided=1 where id=?').run(s.id);
    db.prepare("insert into scans(id,code,action,by,site,at,loc,pname,result,changed,voided) values(?,?,'void',?,?,?,?,?,?,0,0)")
      .run('s' + Date.now() + crypto.randomBytes(3).toString('hex'), s.code, req.user.name, s.site, Date.now(), s.prevLoc || '', s.pname, 'Voided scan from ' + new Date(s.at).toISOString());
  })();
  res.json({ ok: true });
}));

const orders = require('./orders')(app, db, { staff, mgr, take: need('admin', 'manager', 'merchandiser'), wrap, bad, clean, audit });
require('./excel')(app, db, { mgr, bad, clean, needCo, companies, codegen, skuGen, fin: orders.fin, audit });   // Excel export and product import
require('./reports')(app, db, { mgr, needCo, companies, fin: orders.fin, getMeta, setMeta, audit });        // daily summary email

/* ---------- backups ---------- */
app.get('/api/backup', adm, wrap((req, res) => {
  const dump = {}; for (const t of ['products', 'codes', 'prints', 'scans']) dump[t] = db.prepare(`select * from ${t}`).all();
  for (const t of ['orders', 'order_items', 'order_codes', 'order_events']) dump[t] = db.prepare(`select * from ${t}`).all();
  for (const t of ['customers', 'payments', 'audit']) dump[t] = db.prepare(`select * from ${t}`).all();
  dump.users = db.prepare('select id,name,username,role,active,companies from users').all();
  res.json(dump);
}));
async function dailyBackup() {
  try {
    const f = path.join(DATA, 'backups', 'wms-' + new Date().toISOString().slice(0, 10) + '.db');
    if (!fs.existsSync(f)) await db.backup(f);
    const all = fs.readdirSync(path.join(DATA, 'backups')).filter(x => x.endsWith('.db')).sort();
    all.slice(0, Math.max(0, all.length - 14)).forEach(x => fs.unlinkSync(path.join(DATA, 'backups', x)));
  } catch (e) { console.error('Backup failed:', e.message); }
}
dailyBackup(); setInterval(dailyBackup, 6 * 3600e3).unref();

app.use(express.static(path.join(__dirname, 'public'), { setHeaders: (res, f) => {
  if (/sw\.js$/.test(f)) res.set('Cache-Control', 'no-cache');   // the app updates itself: the service worker file is always re-checked
  if (/\.webmanifest$/.test(f)) res.type('application/manifest+json');
} }));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
const HOST = process.env.HOST || '0.0.0.0'; // use 127.0.0.1 when a reverse proxy sits in front
const notifyStatus = require('./notify').status();
const server = app.listen(PORT, HOST, () => {
  console.log('\nDedSilva Warehouse System is running.');
  console.log('  Email: ' + (notifyStatus.email.configured ? 'ready' : 'NOT set up') + ' | SMS (' + notifyStatus.sms.provider + '): ' + (notifyStatus.sms.configured ? 'ready' : 'NOT set up') + ' | WhatsApp (' + notifyStatus.whatsapp.provider + '): ' + (notifyStatus.whatsapp.configured ? 'ready' : 'NOT set up'));
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.SECRET) console.log('  Note: SECRET is not set in .env, so a secret stored in the database is used. That is fine, but keep your backups private.');
    if (process.env.OTP_SHOW_ON_SCREEN === 'true') console.log('  WARNING: OTP_SHOW_ON_SCREEN=true shows delivery codes on screen. Turn it off in production.');
  }
  console.log(`  On this computer:  http://localhost:${PORT}`);
  const nets = require('os').networkInterfaces();
  const lan = HOST !== '0.0.0.0' ? [] : Object.values(nets).flat().filter(n => n && (n.family === 'IPv4' || n.family === 4) && !n.internal);
  lan.forEach(n => console.log(`  On other devices (same Wi-Fi):  http://${n.address}:${PORT}`));
  if (!lan.length && HOST === '0.0.0.0') console.log('  No network address found. Connect this PC to Wi-Fi or a network cable, then restart.\n  Or run "ipconfig" and use the IPv4 Address, like http://192.168.1.20:' + PORT);
  if (process.stdout.isTTY) console.log('\nKeep this window open. Press Ctrl+C to stop.\n');
});
// stop cleanly when the service is restarted (finish requests, then close the database so the file is never left half-written)
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => {
  console.log(sig + ' received, shutting down...');
  server.close(() => { try { db.close(); } catch (e) { /* already closed */ } process.exit(0); });
  setTimeout(() => process.exit(1), 10e3).unref();
});
module.exports = app;
