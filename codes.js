'use strict';
// Barcode numbers are  DS-<PRODUCT CODE>-<SERIAL>   e.g.  DS-PTW-QRV-000001
//  - the PRODUCT CODE is the product's SKU (SKUs are unique, so every product has its own code)
//  - the SERIAL counts up separately for each product and is never reused
// So no two barcodes can ever be the same, and every barcode tells you which product it belongs to.
// The database enforces this too (primary key on code + unique index on product + serial).
// Older labels (DS-000123) keep working exactly as before.

// Turn a SKU into a barcode-safe product code: capitals, digits and single hyphens only.
const norm = s => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function migrate(db) {
  const cols = db.prepare('pragma table_info(codes)').all().map(c => c.name);
  if (!cols.includes('serial')) db.exec('alter table codes add column serial integer');
  if (!cols.includes('units')) db.exec('alter table codes add column units integer default 1');          // packs this barcode stands for (a carton of 60 = 60)
  if (!cols.includes('kind')) db.exec("alter table codes add column kind text default 'pack'");            // 'pack' or 'carton'
  db.exec(`
    create table if not exists product_seq(pid integer primary key, n integer not null default 0);
    create unique index if not exists ux_codes_pid_serial on codes(pid, serial) where serial is not null;
  `);
}

// The product code printed in this product's barcodes. Normally the SKU; if two old SKUs would
// collapse to the same text (e.g. "A B" and "A-B"), the later product gets its id added.
function prefixFor(db, p) {
  const n = norm(p.sku) || 'P' + p.id;
  const clash = db.prepare('select id, sku from products where id <> ?').all(p.id).some(o => o.id < p.id && norm(o.sku) === n);
  return clash ? n + '-P' + p.id : n;
}

// Create `qty` new barcode numbers for product `pid`. Must run inside the caller's transaction.
// kind 'carton' makes one barcode per carton, e.g. KW-ZVR-REG-C000007, worth `units` packs; kind 'pack' (default) makes one barcode per pack.
function issue(db, pid, qty, { lot = '', site = '', by = '', now = Date.now(), prefix: brand = 'DS', kind = 'pack', units = 1 } = {}) {
  const carton = kind === 'carton'; if (!carton) { kind = 'pack'; units = 1; }
  const p = db.prepare('select id, sku from products where id=?').get(pid);
  if (!p) throw new Error('Unknown product');
  const prefix = prefixFor(db, p);
  const row = db.prepare('select n from product_seq where pid=?').get(pid);
  let n = row ? row.n : 0;
  const exists = db.prepare('select 1 from codes where code=?');
  const ic = db.prepare('insert into codes(code,pid,status,lot,site,at,serial,units,kind) values(?,?,?,?,?,?,?,?,?)');
  const ip = db.prepare('insert into prints(code,by,at,reprint,site) values(?,?,?,0,?)');
  const out = [];
  while (out.length < qty) {
    n++;
    const code = brand + '-' + prefix + '-' + (carton ? 'C' : '') + String(n).padStart(6, '0');
    if (exists.get(code)) continue; // never hand out a number that is already in the database
    ic.run(code, pid, 'printed', lot, site, now, n, units, kind);
    ip.run(code, by, now, site);
    out.push(code);
  }
  db.prepare('insert into product_seq(pid,n) values(?,?) on conflict(pid) do update set n=excluded.n').run(pid, n);
  return out;
}

module.exports = { norm, migrate, issue, prefixFor };
