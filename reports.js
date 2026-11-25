'use strict';
// Daily summary email for managers: orders taken / priced / dispatched / delivered today, unpaid and overdue invoices, low stock.
//   Sent once a day after DAILY_REPORT_HOUR (default 18 = 6 pm, server time zone; TZ defaults to Africa/Nairobi) to REPORT_EMAIL_DS / REPORT_EMAIL_KW
//   (comma-separated list allowed; falls back to the company email). DAILY_REPORT=off turns it off.
const notify = require('./notify');

module.exports = function (app, db, { mgr, needCo, companies, fin, getMeta, setMeta, audit }) {
  const wrap = fn => (req, res) => { Promise.resolve().then(() => fn(req, res)).catch(e => { if (!e.status) console.error(e); res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error' }); }); };
  const money = n => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pad = id => String(id).padStart(5, '0');
  const recipients = c => process.env['REPORT_EMAIL_' + c.code.slice(0, 2)] || (c.id <= 2 ? process.env['REPORT_EMAIL_' + (c.id === 1 ? 'DS' : 'KW')] : '') || c.otpEmail || '';

  function summary(cid, now = new Date()) {
    const c = companies.byId(cid), t0 = new Date(now); t0.setHours(0, 0, 0, 0);
    const since = t0.getTime();
    const ev = like => db.prepare(`select count(distinct e.order_id) n from order_events e join orders o on o.id=e.order_id where o.company_id=? and e.at>=? and (${like})`).get(cid, since).n;
    const taken = db.prepare('select id,customer,created_by from orders where company_id=? and created>=? order by id').all(cid, since);
    const unpaid = { count: 0, total: 0, overdue: 0, overdueTotal: 0, top: [] };
    for (const o of db.prepare("select * from orders where company_id=? and inv_no is not null and status<>'cancelled'").all(cid)) {
      const m = fin.moneyOf(o);
      if (m.balance > 0.004) {
        unpaid.count++; unpaid.total += m.balance;
        if (m.days_overdue > 0) { unpaid.overdue++; unpaid.overdueTotal += m.balance; }
        unpaid.top.push({ ref: c.orderPrefix + '-' + pad(o.id), customer: o.customer, balance: m.balance, days: m.days_overdue });
      }
    }
    unpaid.top.sort((a, b) => b.days - a.days || b.balance - a.balance); unpaid.top = unpaid.top.slice(0, 8);
    const low = db.prepare("select p.name,p.sku,p.min,(select coalesce(sum(coalesce(cd.units,1)),0) from codes cd where cd.pid=p.id and cd.status='in_stock') have from products p where p.company_id=? and p.min>0").all(cid).filter(p => p.have < p.min);
    return {
      company: c.name, date: now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
      taken: taken.length, takenBy: taken.reduce((a, o) => { a[o.created_by] = (a[o.created_by] || 0) + 1; return a; }, {}),
      priced: ev("e.text like 'Proforma invoice%'"), dispatched: ev("e.text like 'Dispatched with%'"), delivered: ev("e.text like 'Delivered%' or e.text like 'Delivery confirmed%'"),
      unpaid, low
    };
  }

  function render(s, c) {
    const L = [];
    L.push(`${s.company}: daily summary`, s.date, '', 'TODAY');
    L.push(`  Orders taken:       ${s.taken}` + (s.taken ? '  (' + Object.entries(s.takenBy).map(([n, k]) => `${n} ${k}`).join(', ') + ')' : ''));
    L.push(`  Quotations issued:  ${s.priced}`, `  Dispatched:         ${s.dispatched}`, `  Delivered:          ${s.delivered}`, '');
    L.push('MONEY OWED');
    if (!s.unpaid.count) L.push('  No unpaid invoices.');
    else {
      L.push(`  Unpaid invoices: ${s.unpaid.count}, KES ${money(s.unpaid.total)}`, `  Overdue:         ${s.unpaid.overdue}, KES ${money(s.unpaid.overdueTotal)}`);
      s.unpaid.top.forEach(u => L.push(`    ${u.ref}  ${u.customer}  KES ${money(u.balance)}` + (u.days ? `  (${u.days} day${u.days === 1 ? '' : 's'} overdue)` : '')));
    }
    L.push('', 'LOW STOCK');
    if (!s.low.length) L.push('  All products are above their minimum.');
    else s.low.forEach(p => L.push(`  ${p.name} (${p.sku}): ${p.have} packs in stock, minimum ${p.min} packs`));
    L.push('', `Sent automatically by the ${c.short} warehouse system.`);
    return L.join('\n');
  }

  async function send(cid) {
    const c = companies.byId(cid), to = recipients(c), s = summary(cid);
    if (!to) return { ok: false, error: 'No report email set for ' + c.short + ' (REPORT_EMAIL_* or COMPANY_EMAIL_*).', summary: s };
    const r = await notify.email({ to, fromName: c.name, subject: `${c.short} daily summary: ${s.taken} order${s.taken === 1 ? '' : 's'} taken` + (s.low.length ? `, ${s.low.length} low on stock` : '') + (s.unpaid.overdue ? `, ${s.unpaid.overdue} overdue` : ''), text: render(s, c) });
    return { ok: r.ok, error: r.error, to: notify.maskEmail(to), summary: s };
  }

  // manager presses "Email today's summary now"
  app.post('/api/reports/daily', mgr, wrap(async (req, res) => {
    const cid = +req.body.company_id || companies.ids(req.user)[0]; needCo(req.user, cid);
    const r = await send(cid);
    audit(req.user.name, `Daily summary for ${companies.byId(cid).short} ` + (r.ok ? 'emailed' : 'could not be emailed'));
    res.json(r);
  }));

  // automatic daily send
  const MAX_TRIES = 3;
  async function tick() {
    if ((process.env.DAILY_REPORT || '').toLowerCase() === 'off') return;
    const now = new Date(), hour = Math.min(23, Math.max(0, +(process.env.DAILY_REPORT_HOUR || 18)));
    if (now.getHours() < hour) return;
    for (const c of companies.COMPANIES) {
      const key = `report:${now.getFullYear()}${now.getMonth() + 1}${now.getDate()}:${c.id}`, v = getMeta(key) || '';
      if (v === 'ok') continue;
      const [, n, at] = v.split(':'); if (v && (+n >= MAX_TRIES || Date.now() - +at < 10 * 60e3)) continue;
      if (!recipients(c)) { setMeta(key, 'ok'); continue; }
      setMeta(key, 'try:' + ((+n || 0) + 1) + ':' + Date.now());   // marked first, so a slow send is never repeated
      try { const r = await send(c.id); setMeta(key, r.ok ? 'ok' : 'try:' + ((+n || 0) + 1) + ':' + Date.now()); if (!r.ok) console.error('Daily summary failed for ' + c.short + ': ' + r.error); }
      catch (e) { console.error('Daily summary error:', e.message); }
    }
  }
  setInterval(() => tick().catch(e => console.error(e.message)), 60e3).unref();
  return { summary, send, render };
};
