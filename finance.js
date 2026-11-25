'use strict';
// Customers, payments and statements.
//  - customers: a saved list per company (name, phone, email, address) that fills new orders and shows order history
//  - payments:  money received against an invoice (M-Pesa, bank, cash, cheque). Never deleted: a wrong entry is voided with a reason.
//  - status:    Paid (balance 0), Part-paid (some paid, not yet due), Overdue (balance left after the due date), Unpaid (nothing paid, not yet due)
const D = require('./public/documents.js');
const companies = require('./companies');

const DAY = 86400e3, EAT = 3 * 3600e3;                      // Nairobi is UTC+3 all year
const r2 = n => Math.round(n * 100) / 100;
const startOfDay = t => Math.floor((t + EAT) / DAY) * DAY - EAT;
const endOfDay = t => startOfDay(t) + DAY - 1;
const dayStr = t => new Date(t + EAT).toISOString().slice(0, 10);
const parseDay = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? Date.parse(s + 'T00:00:00+03:00') : NaN;
const kes = n => r2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const METHODS = ['M-Pesa', 'Bank transfer', 'Cash', 'Cheque', 'Other'];

module.exports = function (db, { mgr, wrap, bad, clean, needCo, log, audit, normPhone, refOf, pdfContext, getJsPDF }) {
  db.exec(`
  create table if not exists customers(id integer primary key, company_id integer not null, name text not null collate nocase, phone text default '', email text default '',
    address text default '', kra_pin text default '', notes text default '', created integer, created_by text, active integer default 1);
  create unique index if not exists ux_customers_name on customers(company_id, name);
  create table if not exists payments(id integer primary key, order_id integer not null, amount real not null, method text not null, ref text default '', paid_at integer not null,
    received_by text, note text default '', voided integer default 0, void_reason text, void_by text, void_at integer, created integer);
  create index if not exists ix_payments_order on payments(order_id);
  `);

  /* ---------- money on an order ---------- */
  function moneyOf(o, now = Date.now()) {
    const T = D.totalsOf(db.prepare('select pid,qty,price,vat from order_items where order_id=?').all(o.id), o.vat_rate);
    const paid = r2(db.prepare('select coalesce(sum(amount),0) s from payments where order_id=? and voided=0').get(o.id).s);
    const invoiced = !!o.inv_no && o.status !== 'cancelled';
    const out = { subtotal: T.subtotal, taxable: T.taxable, exempt: T.exempt, vat_amount: T.vat, total: T.total, paid, balance: invoiced ? r2(T.total - paid) : null, pay_status: null, days_overdue: 0 };
    if (invoiced) {
      if (out.balance <= 0.004) out.pay_status = 'paid';
      else if (o.due_at && now > o.due_at) { out.pay_status = 'overdue'; out.days_overdue = Math.floor((now - o.due_at) / DAY) + 1; }
      else out.pay_status = paid > 0 ? 'part' : 'unpaid';
    }
    return out;
  }
  const paymentsOf = oid => db.prepare('select id,amount,method,ref,paid_at,received_by,note,voided,void_reason,void_by,void_at from payments where order_id=? order by paid_at, id').all(oid).map(p => ({ ...p, voided: !!p.voided }));

  /* ---------- customers ---------- */
  const accNo = c => companies.byId(c.company_id).code + '-C' + String(c.id).padStart(4, '0');
  const custRow = c => ({ id: c.id, company_id: c.company_id, name: c.name, phone: c.phone, email: c.email, address: c.address, kra_pin: c.kra_pin, notes: c.notes, acc_no: accNo(c) });
  const emailOk = e => !e || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

  // find the saved customer for an order, or save a new one (names are matched ignoring capitals); blanks on an existing customer are filled in
  function resolveCustomer(cid, { customer_id, name, phone, address }, by) {
    let c = customer_id ? db.prepare('select * from customers where id=? and company_id=? and active=1').get(+customer_id, cid) : null;
    if (!c) c = db.prepare('select * from customers where company_id=? and name=?').get(cid, name);
    if (!c) {
      const id = db.prepare('insert into customers(company_id,name,phone,address,created,created_by) values(?,?,?,?,?,?)').run(cid, name, phone || '', address || '', Date.now(), by).lastInsertRowid;
      return db.prepare('select * from customers where id=?').get(id);
    }
    if (!c.active) db.prepare('update customers set active=1 where id=?').run(c.id);
    if ((!c.phone && phone) || (!c.address && address)) db.prepare('update customers set phone=?, address=? where id=?').run(c.phone || phone || '', c.address || address || '', c.id);
    return db.prepare('select * from customers where id=?').get(c.id);
  }

  // customers with order counts and what they owe, for the given companies
  function customerList(cids) {
    if (!cids.length) return [];
    const ph = cids.map(() => '?').join(',');
    const custs = db.prepare(`select * from customers where company_id in (${ph}) and active=1 order by name`).all(...cids);
    const stats = {};
    for (const o of db.prepare(`select * from orders where company_id in (${ph}) and customer_id is not null`).all(...cids)) {
      const s = stats[o.customer_id] = stats[o.customer_id] || { orders: 0, last_order: 0, billed: 0, paid: 0, balance: 0, overdue: 0, open: 0 };
      s.orders++; s.last_order = Math.max(s.last_order, o.created || 0);
      if (o.inv_no && o.status !== 'cancelled') {
        const m = moneyOf(o); s.billed += m.total; s.paid += m.paid;
        if (m.balance > 0.004) { s.balance += m.balance; s.open++; if (m.pay_status === 'overdue') s.overdue += m.balance; }
      }
    }
    return custs.map(c => { const s = stats[c.id] || { orders: 0, last_order: 0, billed: 0, paid: 0, balance: 0, overdue: 0, open: 0 };
      return { ...custRow(c), orders: s.orders, last_order: s.last_order || null, billed: r2(s.billed), paid: r2(s.paid), balance: r2(s.balance), overdue: r2(s.overdue), open: s.open }; });
  }

  // one-time tidy-up: give every old order a saved customer
  function backfill() {
    const rows = db.prepare("select id, company_id, customer, phone, created_by from orders where customer_id is null and customer is not null and trim(customer) <> '' order by id").all();
    if (!rows.length) return;
    db.transaction(() => {
      for (const o of rows) {
        const name = String(o.customer).trim().slice(0, 120);
        const c = resolveCustomer(o.company_id || 1, { name, phone: o.phone || '' }, o.created_by || 'system');
        db.prepare('update orders set customer_id=? where id=?').run(c.id, o.id);
      }
    })();
  }

  /* ---------- statement data ---------- */
  function statementData(c, fromMs, toMs, asOf) {
    const orders = db.prepare("select * from orders where customer_id=? and inv_no is not null and status<>'cancelled' order by inv_at, id").all(c.id);
    const events = [];
    for (const o of orders) {
      const m = moneyOf(o);
      events.push({ at: o.inv_at, k: 0, id: o.id, ref: o.inv_no, desc: `Invoice for ${refOf(o)}` + (o.due_at ? ` (due ${D.shortDate(o.due_at)})` : ''), debit: m.total, credit: 0 });
      for (const p of paymentsOf(o.id)) if (!p.voided) events.push({ at: p.paid_at, k: 1, id: p.id, ref: p.ref || p.method, desc: `Payment (${p.method}) for ${o.inv_no}`, debit: 0, credit: p.amount });
    }
    events.sort((a, b) => a.at - b.at || a.k - b.k || a.id - b.id);
    const upto = events.filter(e => e.at <= toMs);
    let opening = 0; if (fromMs) upto.filter(e => e.at < fromMs).forEach(e => { opening += e.debit - e.credit; });
    let bal = r2(opening);
    const rows = upto.filter(e => !fromMs || e.at >= fromMs).map(e => { bal = r2(bal + e.debit - e.credit); return { at: e.at, ref: e.ref, desc: e.desc, debit: e.debit || '', credit: e.credit || '', balance: bal }; });
    const A = { current: 0, d30: 0, d60: 0, d90: 0, over90: 0 }; let open = 0;
    for (const o of orders) {
      if (o.inv_at > toMs) continue;
      const m = moneyOf(o), paidTo = r2(paymentsOf(o.id).filter(p => !p.voided && p.paid_at <= toMs).reduce((s, p) => s + p.amount, 0)), out = r2(m.total - paidTo);
      if (out <= 0.004) continue;
      open++;
      const late = o.due_at && toMs > o.due_at ? Math.floor((toMs - o.due_at) / DAY) + 1 : 0;
      const k = !late ? 'current' : late <= 30 ? 'd30' : late <= 60 ? 'd60' : late <= 90 ? 'd90' : 'over90';
      A[k] = r2(A[k] + out);
    }
    return { customer: custRow(c), asOf, from: fromMs || null, to: toMs, opening: r2(opening), rows, closing: bal, ageing: A, overdueTotal: r2(A.d30 + A.d60 + A.d90 + A.over90), openCount: open };
  }

  /* ---------- routes ---------- */
  const getCustomer = (req, id) => {
    const c = db.prepare('select * from customers where id=? and active=1').get(+id);
    if (!c) throw bad('Customer not found.', 404);
    needCo(req.user, c.company_id); return c;
  };
  const fields = b => ({ name: clean(b.name, 120), phone: normPhone(clean(b.phone, 30)), email: clean(b.email, 120), address: clean(b.address, 200), kra_pin: clean(b.kra_pin, 20).toUpperCase(), notes: clean(b.notes, 300) });

  return {
    moneyOf, paymentsOf, customerList, resolveCustomer, backfill, METHODS, endOfDay, dayStr,
    routes(app) {
      app.post('/api/customers', mgr, wrap((req, res) => {
        const f = fields(req.body), cid = +req.body.company_id; needCo(req.user, cid);
        if (f.name.length < 2) throw bad('Enter the customer name.');
        if (!emailOk(f.email)) throw bad('That email address does not look right.');
        const old = db.prepare('select id, active from customers where company_id=? and name=?').get(cid, f.name);
        if (old) throw bad('A customer with that name is already saved. Search for them in the list instead.', 409);
        const id = db.prepare('insert into customers(company_id,name,phone,email,address,kra_pin,notes,created,created_by) values(?,?,?,?,?,?,?,?,?)').run(cid, f.name, f.phone, f.email, f.address, f.kra_pin, f.notes, Date.now(), req.user.name).lastInsertRowid;
        res.json({ id });
      }));
      app.patch('/api/customers/:id', mgr, wrap((req, res) => {
        const c = getCustomer(req, req.params.id), f = fields({ ...c, ...req.body });
        if (f.name.length < 2) throw bad('Enter the customer name.');
        if (!emailOk(f.email)) throw bad('That email address does not look right.');
        if (db.prepare('select 1 from customers where company_id=? and name=? and id<>?').get(c.company_id, f.name, c.id)) throw bad('Another customer already has that name.', 409);
        db.prepare('update customers set name=?, phone=?, email=?, address=?, kra_pin=?, notes=? where id=?').run(f.name, f.phone, f.email, f.address, f.kra_pin, f.notes, c.id);
        res.json({ ok: true });
      }));
      // the customer's whole order history (the main list only carries the latest orders)
      app.get('/api/customers/:id/history', mgr, wrap((req, res) => {
        const c = getCustomer(req, req.params.id);
        const orders = db.prepare('select * from orders where customer_id=? order by id desc').all(c.id).map(o => {
          const m = moneyOf(o);
          return { id: o.id, ref: refOf(o), status: o.status, created: o.created, inv_no: o.inv_no, inv_at: o.inv_at, due_at: o.due_at, total: m.total, paid: m.paid, balance: m.balance, pay_status: m.pay_status,
            items: db.prepare('select pid,qty from order_items where order_id=?').all(o.id).map(i => i.qty + '\u00d7 ' + ((db.prepare('select name from products where id=?').get(i.pid) || {}).name || 'item')).join(', ') };
        });
        res.json({ customer: custRow(c), orders });
      }));
      app.post('/api/customers/:id/statement-pdf', mgr, wrap((req, res) => {
        const c = getCustomer(req, req.params.id), now = Date.now();
        const from = req.body.from ? parseDay(req.body.from) : null, to = req.body.to ? parseDay(req.body.to) : null;
        if ((req.body.from && isNaN(from)) || (req.body.to && isNaN(to))) throw bad('Use valid dates.');
        const toMs = to ? Math.min(endOfDay(to), now) : now;
        if (from && from > toMs) throw bad('The start date is after the end date.');
        const data = statementData(c, from, toMs, toMs);
        const ctx = pdfContext(c.company_id);
        ctx.sign = { preparedBy: req.user.name, preparedAt: now };
        const doc = D.statement(getJsPDF(), data, ctx);
        audit(req.user.name, `Statement printed for ${c.name} (${accNo(c)}), balance KES ${kes(data.closing)}`);
        res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="Statement-${accNo(c)}-${dayStr(now)}.pdf"`, 'Cache-Control': 'no-store' });
        res.send(Buffer.from(doc.output('arraybuffer')));
      }));

      /* ---- payments ---- */
      app.post('/api/payments', mgr, wrap((req, res) => {
        const b = req.body, by = req.user.name, now = Date.now();
        const o = db.prepare('select * from orders where id=?').get(+b.order_id);
        if (!o) throw bad('Order not found.', 404);
        needCo(req.user, o.company_id);
        if (!o.inv_no || o.status === 'cancelled') throw bad('Payments can only be recorded against an issued invoice.');
        const m = moneyOf(o), amount = r2(Number(b.amount));
        if (!(amount > 0 && amount < 1e10)) throw bad('Enter the amount received.');
        if (amount > m.balance + 0.004) throw bad(`That is more than the KES ${kes(m.balance)} still owing on ${o.inv_no}.`);
        const method = clean(b.method, 20), ref = clean(b.ref, 60);
        if (!METHODS.includes(method)) throw bad('Choose how it was paid.');
        if (method !== 'Cash' && ref.length < 3) throw bad(method === 'M-Pesa' ? 'Enter the M-Pesa transaction code.' : method === 'Cheque' ? 'Enter the cheque number.' : 'Enter the bank or payment reference.');
        if (ref && !b.confirm_duplicate) {
          const d = db.prepare('select o.inv_no from payments p join orders o on o.id=p.order_id where o.company_id=? and p.voided=0 and lower(p.ref)=lower(?)').get(o.company_id, ref);
          if (d) throw bad(`The reference ${ref} was already recorded on ${d.inv_no}.`, 409);
        }
        let at = now;
        if (b.paid_on) {
          const day = parseDay(b.paid_on); if (isNaN(day)) throw bad('Use a valid payment date.');
          if (b.paid_on > dayStr(now)) throw bad('The payment date cannot be in the future.');
          if (b.paid_on !== dayStr(now)) at = day + 12 * 3600e3;
        }
        const id = db.prepare('insert into payments(order_id,amount,method,ref,paid_at,received_by,note,created) values(?,?,?,?,?,?,?,?)').run(o.id, amount, method, ref, at, by, clean(b.note, 200), now).lastInsertRowid;
        const after = moneyOf(o);
        log(o.id, by, `Payment of KES ${kes(amount)} received by ${method}${ref ? ' (' + ref + ')' : ''}. ` + (after.balance <= 0.004 ? 'Invoice ' + o.inv_no + ' is now paid in full.' : `Balance KES ${kes(after.balance)}.`));
        res.json({ ok: true, id, balance: after.balance, pay_status: after.pay_status });
      }));
      app.post('/api/payments/:id/void', mgr, wrap((req, res) => {
        const p = db.prepare('select * from payments where id=?').get(+req.params.id);
        if (!p) throw bad('Payment not found.', 404);
        const o = db.prepare('select * from orders where id=?').get(p.order_id); needCo(req.user, o.company_id);
        if (p.voided) throw bad('This payment is already cancelled.');
        const why = clean(req.body.reason, 200); if (why.length < 5) throw bad('Give a reason (at least a few words).');
        db.prepare('update payments set voided=1, void_reason=?, void_by=?, void_at=? where id=?').run(why, req.user.name, Date.now(), p.id);
        log(o.id, req.user.name, `Payment of KES ${kes(p.amount)} (${p.method}${p.ref ? ', ' + p.ref : ''}) cancelled. Reason: ${why}`);
        res.json({ ok: true });
      }));
    }
  };
};
