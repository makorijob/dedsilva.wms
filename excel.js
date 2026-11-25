'use strict';
// Excel export (orders, stock, payments, products) and product import from .xlsx or .csv. Managers and administrators only.
const express = require('express'), ExcelJS = require('exceljs');
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

module.exports = function (app, db, { mgr, bad, clean, needCo, companies, codegen, skuGen, fin, audit }) {
  const awrap = fn => (req, res) => { Promise.resolve().then(() => fn(req, res)).catch(e => { if (!e.status) console.error(e); res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error' }); }); };
  const pad = id => String(id).padStart(5, '0');
  const day = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  const range = q => { const a = day(q.from), b = day(q.to); return [a ? a.getTime() : 0, b ? b.getTime() + 864e5 - 1 : 8.64e15]; };

  function sheet(wb, name, cols, rows) {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = cols.map(c => ({ header: c.h, key: c.k, width: c.w || 16, style: c.fmt ? { numFmt: c.fmt } : {} }));
    rows.forEach(r => ws.addRow(r));
    const h = ws.getRow(1); h.font = { bold: true, color: { argb: 'FFFFFFFF' } }; h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14202B' } }; h.alignment = { vertical: 'middle' }; h.height = 20;
    if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
    return ws;
  }
  async function send(res, wb, name) {
    const buf = await wb.xlsx.writeBuffer();
    res.set({ 'Content-Type': XLSX_TYPE, 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' }); res.send(Buffer.from(buf));
  }
  const stamp = () => new Date().toISOString().slice(0, 10);
  const D = '#,##0.00', DT = 'dd-mmm-yyyy hh:mm', DD = 'dd-mmm-yyyy';

  app.get('/api/export/:kind', mgr, awrap(async (req, res) => {
    const cid = +req.query.company_id || companies.ids(req.user)[0]; needCo(req.user, cid);
    const c = companies.byId(cid), kind = req.params.kind, [t0, t1] = range(req.query), wb = new ExcelJS.Workbook();
    wb.creator = c.name; wb.created = new Date();
    const file = `${c.short.toLowerCase()}-${kind}-${stamp()}.xlsx`;
    if (kind === 'orders') {
      const rows = db.prepare('select * from orders where company_id=? and created between ? and ? order by id').all(cid, t0, t1).map(o => {
        const m = fin.moneyOf(o), items = db.prepare('select p.name,i.qty from order_items i left join products p on p.id=i.pid where i.order_id=?').all(o.id);
        return { ref: c.orderPrefix + '-' + pad(o.id), customer: o.customer, phone: o.phone, status: o.status, created: new Date(o.created), by: o.created_by, items: items.map(i => `${i.qty} x ${i.name}`).join('; '),
          quote: o.quote_no, lpo: o.lpo_no, inv: o.inv_no, vatamt: m.vat_amount, total: m.total, paid: m.paid, balance: m.balance, pay: m.pay_status, due: o.due_at ? new Date(o.due_at) : null, overdue: m.days_overdue || null };
      });
      sheet(wb, 'Orders', [{ h: 'Order', k: 'ref' }, { h: 'Customer', k: 'customer', w: 28 }, { h: 'Phone', k: 'phone' }, { h: 'Status', k: 'status' }, { h: 'Taken', k: 'created', w: 18, fmt: DT }, { h: 'Taken by', k: 'by' },
        { h: 'Items', k: 'items', w: 48 }, { h: 'Quotation', k: 'quote' }, { h: 'LPO', k: 'lpo' }, { h: 'Invoice', k: 'inv' }, { h: 'VAT (KES)', k: 'vatamt', fmt: D }, { h: 'Total (KES)', k: 'total', fmt: D }, { h: 'Paid (KES)', k: 'paid', fmt: D },
        { h: 'Balance (KES)', k: 'balance', fmt: D }, { h: 'Payment', k: 'pay' }, { h: 'Due', k: 'due', fmt: DD }, { h: 'Days overdue', k: 'overdue' }], rows);
    } else if (kind === 'payments') {
      const rows = db.prepare('select p.*,o.customer,o.inv_no,o.id oid from payments p join orders o on o.id=p.order_id where o.company_id=? and p.paid_at between ? and ? order by p.paid_at, p.id').all(cid, t0, t1)
        .map(p => ({ date: new Date(p.paid_at), order: c.orderPrefix + '-' + pad(p.oid), inv: p.inv_no, customer: p.customer, amount: p.amount, method: p.method, ref: p.ref, by: p.received_by, note: p.note, voided: p.voided ? 'VOIDED' : '', why: p.void_reason }));
      sheet(wb, 'Payments', [{ h: 'Date', k: 'date', w: 18, fmt: DT }, { h: 'Order', k: 'order' }, { h: 'Invoice', k: 'inv' }, { h: 'Customer', k: 'customer', w: 28 }, { h: 'Amount (KES)', k: 'amount', fmt: D }, { h: 'Method', k: 'method' },
        { h: 'Reference', k: 'ref', w: 20 }, { h: 'Received by', k: 'by' }, { h: 'Note', k: 'note', w: 26 }, { h: 'Voided', k: 'voided' }, { h: 'Void reason', k: 'why', w: 26 }], rows);
    } else if (kind === 'stock') {
      const cat = companies.catalogIds(cid).join(','), prods = db.prepare(`select * from products where company_id in (${cat}) order by name`).all();
      const cnt = db.prepare(`select cd.pid,cd.status,sum(coalesce(cd.units,1)) n,sum(case when cd.kind='carton' then 1 else 0 end) cartons from codes cd join products p on p.id=cd.pid where p.company_id in (${cat}) group by cd.pid,cd.status`).all(), by = {}, ctn = {};
      cnt.forEach(r => { (by[r.pid] = by[r.pid] || {})[r.status] = r.n; if (r.status === 'in_stock') ctn[r.pid] = r.cartons; });   // all counts are in PACKS; a carton barcode counts as its packs
      sheet(wb, 'Stock', [{ h: 'SKU', k: 'sku' }, { h: 'Product', k: 'name', w: 34 }, { h: 'Brand', k: 'brand' }, { h: 'Category', k: 'cat', w: 20 }, { h: 'Size (mm)', k: 'size' }, { h: 'Packs per carton', k: 'cq' }, { h: 'Labelled (packs)', k: 'p' }, { h: 'In stock (packs)', k: 's' }, { h: 'of which whole cartons', k: 'ct' }, { h: 'Picked (packs)', k: 'k' }, { h: 'Dispatched (packs)', k: 'd' }, { h: 'Minimum (packs)', k: 'min' }, { h: 'Low?', k: 'low' }],
        prods.map(p => { const b = by[p.id] || {}; return { sku: p.sku, name: p.name, brand: p.brand, cat: p.cat, size: p.size_mm || '', cq: p.carton_qty || '', ct: ctn[p.id] || 0, p: b.printed || 0, s: b.in_stock || 0, k: b.picked || 0, d: b.dispatched || 0, min: p.min || 0, low: p.min && (b.in_stock || 0) < p.min ? 'LOW' : '' }; }));
      const codes = db.prepare('select cd.code,p.sku,p.name,cd.status,cd.loc,cd.lot,cd.site,cd.at,coalesce(cd.kind,\'pack\') kind,coalesce(cd.units,1) units from codes cd join products p on p.id=cd.pid where p.company_id in (' + companies.catalogIds(cid).join(',') + ') order by cd.at desc limit 20000').all();
      sheet(wb, 'Barcodes', [{ h: 'Code', k: 'code', w: 24 }, { h: 'SKU', k: 'sku' }, { h: 'Product', k: 'name', w: 34 }, { h: 'Type', k: 'type' }, { h: 'Packs', k: 'units' }, { h: 'Status', k: 'status' }, { h: 'Location', k: 'loc' }, { h: 'Lot', k: 'lot' }, { h: 'Site', k: 'site' }, { h: 'Created', k: 'at', w: 18, fmt: DT }],
        codes.map(r => ({ ...r, type: r.kind === 'carton' ? 'Carton' : 'Pack', at: new Date(r.at) })));
    } else if (kind === 'products') {
      sheet(wb, 'Products', PRODUCT_COLS, db.prepare('select * from products where company_id in (' + companies.catalogIds(cid).join(',') + ') order by name').all().map(p => ({ name: p.name, brand: p.brand, cat: p.cat, min: p.min || 0, vat: p.vat === 0 ? 'No' : 'Yes', size: p.size_mm || '', cq: p.carton_qty || '', sku: p.sku })));
    } else if (kind === 'products-template') {
      const ws = sheet(wb, 'Products', PRODUCT_COLS, [{ name: 'Example: Quick-release vest', brand: c.brands[0], cat: c.categories[0], min: 10, vat: 'Yes', size: 290, cq: 100, sku: '' }]);
      const n = wb.addWorksheet('How to fill this in');
      ['One product per row. Delete the example row.', 'Name is required.', 'Brand: ' + c.brands.join(', ') + ' (or leave blank).', 'Category: ' + c.categories.join(', ') + ' (any text is accepted).',
        'Minimum stock: you are warned when stock falls below this number (optional).', 'VAT: Yes if VAT is charged on this product, No if it is not (blank means Yes).', 'Size (mm) and Packs per carton: optional. 155 mm = 60 packs per carton, 290 mm and 340 mm = 100 packs per carton (filled in for you when you give the size).', 'SKU: leave blank and it is made automatically.'].forEach(t => n.addRow([t])); n.getColumn(1).width = 100;
      ws.getRow(2).font = { italic: true, color: { argb: 'FF888888' } };
    } else throw bad('Unknown export.', 404);
    audit(req.user.name, `Exported ${kind} (${c.short}) to Excel`);
    await send(res, wb, file);
  }));
  const PRODUCT_COLS = [{ h: 'Name', k: 'name', w: 36 }, { h: 'Brand', k: 'brand', w: 16 }, { h: 'Category', k: 'cat', w: 22 }, { h: 'Minimum stock', k: 'min', w: 15 }, { h: 'VAT (Yes/No)', k: 'vat', w: 14 }, { h: 'Size (mm)', k: 'size', w: 11 }, { h: 'Packs per carton', k: 'cq', w: 16 }, { h: 'SKU (leave blank)', k: 'sku', w: 20 }];

  /* ---- import products ---- */
  function parseCsv(text) {
    const rows = []; let row = [], cell = '', q = false;
    text = text.replace(/^\uFEFF/, '');
    const sep = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === sep) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  async function readRows(buf, filename) {
    if (buf.length > 2e6) throw bad('That file is too big (limit 2 MB).');
    if (buf[0] === 0x50 && buf[1] === 0x4b) {   // "PK": an .xlsx file
      const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
      const ws = wb.worksheets[0]; if (!ws) throw bad('The spreadsheet has no sheets.');
      const rows = []; ws.eachRow({ includeEmpty: false }, row => { const a = []; for (let i = 1; i <= Math.max(row.cellCount, 6); i++) { const c = row.getCell(i); a.push(c.value === null || c.value === undefined ? '' : (typeof c.value === 'object' ? String(c.text || '') : String(c.value))); } rows.push(a); });
      return rows;
    }
    if (/\.xlsx?$/i.test(filename || '') && !/\.csv$/i.test(filename || '')) throw bad('Please save the file as .xlsx (Excel Workbook) or .csv.');
    return parseCsv(buf.toString('utf8'));
  }
  const key = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  const stripTm = s => String(s || '').replace(/[\u2122\u00ae]/g, '').trim().toLowerCase();

  app.post('/api/products/import', mgr, express.json({ limit: '3mb' }), awrap(async (req, res) => {
    const cid = +req.body.company_id || companies.ids(req.user)[0]; needCo(req.user, cid);
    const c = companies.byId(cid), preview = !!req.body.preview;
    let buf; try { buf = Buffer.from(String(req.body.data || ''), 'base64'); } catch (e) { buf = Buffer.alloc(0); }
    if (!buf.length) throw bad('Choose an .xlsx or .csv file first.');
    let rows; try { rows = await readRows(buf, String(req.body.filename || '')); } catch (e) { if (e.status) throw e; throw bad('That file could not be read. Use the template: Download template, fill it in, and upload it.'); }
    let hi = rows.findIndex((r, i) => i < 6 && r.some(x => /^(product)?name$|^product$/.test(key(x))));
    if (hi < 0) throw bad('Could not find a "Name" column. Use the template (Download template).');
    const col = {}; rows[hi].forEach((h, i) => { const k = key(h); if (/^(product)?name$|^product$/.test(k)) col.name = i; else if (k === 'brand') col.brand = i; else if (/^(category|cat)$/.test(k)) col.cat = i; else if (/(min|warn|reorder)/.test(k)) col.min = i; else if (k.startsWith('vat')) col.vat = i; else if (/^size/.test(k)) col.size = i; else if (/^(packspercarton|cartonqty|packspercartons|carton)/.test(k)) col.cq = i; else if (k.startsWith('sku')) col.sku = i; });
    const data = rows.slice(hi + 1).map((r, i) => ({ r, n: hi + 2 + i })).filter(x => x.r.some(v => String(v).trim()));
    if (!data.length) throw bad('The file has no products in it.');
    if (data.length > 500) throw bad('Import up to 500 products at a time.');
    const usedSku = new Set(db.prepare('select sku from products').all().map(p => codegen.norm(p.sku))), have = new Set(db.prepare('select name from products where company_id=?').all(cid).map(p => p.name.trim().toLowerCase()));
    const create = [], skipped = [], errors = [];
    for (const { r, n } of data) {
      const get = k => (col[k] === undefined ? '' : String(r[col[k]] || '').trim());
      const name = clean(get('name'), 120); if (!name) { errors.push({ row: n, name: '', reason: 'Name is empty.' }); continue; }
      if (/^example:/i.test(name)) { skipped.push({ row: n, name, reason: 'Example row.' }); continue; }
      if (have.has(name.toLowerCase())) { skipped.push({ row: n, name, reason: 'Already in the catalogue.' }); continue; }
      let brand = get('brand');
      if (brand) { const m = c.brands.find(b => stripTm(b) === stripTm(brand)); if (!m) { errors.push({ row: n, name, reason: `Brand "${brand}" is not one of: ${c.brands.join(', ')}.` }); continue; } brand = m; }
      const cat0 = get('cat'), cat = (c.categories.find(x => stripTm(x) === stripTm(cat0)) || cat0).slice(0, 40);
      const min = Math.max(0, parseInt(get('min')) || 0), vraw = get('vat').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (vraw && !/^(yes|y|true|1|vat|standard|16|taxable|charged)$/.test(vraw) && !/^(no|n|false|0|none|exempt|zero|zerorated|novat|notaxable)$/.test(vraw)) { errors.push({ row: n, name, reason: `VAT must be Yes or No (found "${get('vat')}").` }); continue; }
      const vat = /^(no|n|false|0|none|exempt|zero|zerorated|novat|notaxable)$/.test(vraw) ? 0 : 1;
      const sizeRaw = get('size').replace(/\s*mm$/i, '').trim(), size = sizeRaw ? parseInt(sizeRaw) : null, cqRaw = parseInt(get('cq'));
      if (sizeRaw && !(size >= 1 && size <= 2000 && /^\d+$/.test(sizeRaw))) { errors.push({ row: n, name, reason: `Size must be a number of millimetres, like 290 (found "${get('size')}").` }); continue; }
      const carton = cqRaw > 0 ? Math.min(cqRaw, 10000) : (size ? skuGen.cartonFor(size) : 0);
      let sku = codegen.norm(clean(get('sku'), 40));
      if (sku) { if (usedSku.has(sku)) { errors.push({ row: n, name, reason: `SKU ${sku} is already used.` }); continue; } }
      else sku = codegen.norm(skuGen.suggest(brand, name, [...usedSku], size || 0));
      if (!sku || sku.length > 24) { errors.push({ row: n, name, reason: 'Could not make a SKU for this name.' }); continue; }
      usedSku.add(sku); have.add(name.toLowerCase()); create.push({ row: n, name, brand, cat, min, vat, size, carton, sku });
    }
    if (!preview && create.length) {
      db.transaction(() => create.forEach(p => db.prepare('insert into products(name,sku,brand,cat,min,company_id,vat,size_mm,carton_qty) values(?,?,?,?,?,?,?,?,?)').run(p.name, p.sku, p.brand, p.cat, p.min, cid, p.vat, p.size, p.carton || null)))();
      audit(req.user.name, `Imported ${create.length} product${create.length === 1 ? '' : 's'} into ${c.short} from a spreadsheet`);
    }
    res.json({ ok: true, preview, create, skipped, errors });
  }));
};
