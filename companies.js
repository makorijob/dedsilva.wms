'use strict';
// The companies that share this warehouse system. Each has its own products, barcodes, stock, orders,
// invoices and letterhead. EDIT THIS FILE to change a company's details, then restart the server.
//
//  - id            never change a company's id once it is in use (data is linked to it)
//  - barcodePrefix first part of every barcode for this company (DS-PTW-QRV-000001, KW-ZVR-REG-000001)
//  - logo / icon   file names inside public/img (optional: a text letterhead is used when missing)
//  - color         the company's accent colour (buttons, labels, invoice header lines)
//  - vat           default VAT % offered when an invoice is issued (it can still be changed per invoice)
//  - lpoPrefix      LPO numbers made by the system look like LPO-00001 (KW-LPO-00001 for Kaynes)
//  - termsDays     default days a customer has to pay an invoice (sets the due date; can be changed per invoice)
//  - paymentDetails lines of bank / M-Pesa details printed under "How to pay" on proformas, invoices and statements (optional)
//  - otpEmail      where invoice-download codes are emailed
//  - otpWhatsapp   the company WhatsApp number that also receives invoice-download codes (set COMPANY_WHATSAPP_DS / _KW in .env)
//  - products      catalogue added the FIRST time this company appears in a database
//  - catalog       (agent companies) ids of the companies whose PRODUCTS and STOCK this company sells. Citroen, AeroParts, Maerns and ORBiken
//                  order DedSilva and Kaynes products ({catalog: [1, 2]}) and work exactly like those two companies, but every order, quotation,
//                  invoice, delivery note and statement carries THEIR OWN letterhead, numbers and customers. Fill in their blank details here.
//  - logoMaxW      widest the logo may be on documents, in mm (for very wide logos)
const fs = require('fs'), path = require('path');

const COMPANIES = [
  {
    id: 1, code: 'DS', name: 'DedSilva International Limited', short: 'DedSilva', tagline: 'Delivering Results that Endure',
    address: 'Cardinal Otunga Plaza, Kaunda Street, Nairobi, Kenya', phone: '+254 700 55 55 65', email: 'info@dedsilva.com',
    color: '#cd181d', logo: 'dedsilva-logo.jpg', icon: 'dedsilva-icon.png',
    barcodePrefix: 'DS', orderPrefix: 'ORD', quotePrefix: 'QT', lpoPrefix: 'LPO', invoicePrefix: 'INV', dnPrefix: 'DN', vat: 16, termsDays: 30,
    paymentDetails: [], // lines printed under "How to pay", e.g. ['Bank: ... Account no: ...', 'M-Pesa Paybill: ... Account: invoice number']
    otpEmail: process.env.COMPANY_EMAIL_DS || process.env.COMPANY_EMAIL || 'info@dedsilva.com',
    otpWhatsapp: process.env.COMPANY_WHATSAPP_DS || process.env.COMPANY_WHATSAPP || '',   // company WhatsApp number for invoice codes, like +254700000000
    brands: ['Pitwan™', 'Slayer™', 'DedSilva', 'Third-party'],
    categories: ['Tactical gear', 'Outdoor & camping', 'CASEVAC', 'SAR equipment', 'Logistics supplies'],
    products: [] // DedSilva's catalogue is created in server.js (unchanged)
  },
  {
    id: 2, code: 'KW', name: 'Kaynes Ltd', short: 'Kaynes', tagline: 'Excellence Without Borders.', // tagline is printed in the invoice footer
    address: '6th Floor, Cardinal Otunga Annex, P.O. Box 37717-00100, Nairobi, Kenya', phone: '+254 180 030000 / +254 180 028888',
    email: 'sales@kaynesltd.com', web: 'www.kaynesltd.com',
    color: '#b40002', accent: '#c9a04a', logoHeight: 17, // color = letterhead red; accent = letterhead gold (thin line under the PDF header); logoHeight = mm
    logo: 'kaynes-logo.png', icon: 'kaynes-icon.png', labelLogo: true, // labelLogo = print the full logo (and a smaller barcode) on this company's item labels
    barcodePrefix: 'KW', orderPrefix: 'KW-ORD', quotePrefix: 'KW-QT', lpoPrefix: 'KW-LPO', invoicePrefix: 'KW-INV', dnPrefix: 'KW-DN', vat: 16, termsDays: 30,
    paymentDetails: [], // TODO: add Kaynes's bank / M-Pesa lines to print them on invoices and statements
    otpEmail: process.env.COMPANY_EMAIL_KW || process.env.COMPANY_EMAIL || 'sales@kaynesltd.com',
    otpWhatsapp: process.env.COMPANY_WHATSAPP_KW || process.env.COMPANY_WHATSAPP || '',
    brands: ['Zavira', 'Third-party'],
    categories: ['Sanitary pads', 'Menstrual pants', 'Panty liners', 'Saviete', 'Packaging & supplies'],
    products: [ // [brand, category, name, sku]
      ['Zavira', 'Menstrual pants', 'Zavira Menstrual Pants', 'ZVR-MPT'],
      ['Zavira', 'Sanitary pads', 'Zavira Regular Sanitary Pads', 'ZVR-REG'],
      ['Zavira', 'Sanitary pads', 'Zavira Heavy Flow Sanitary Pads', 'ZVR-HVY'],
      ['Zavira', 'Panty liners', 'Zavira Panty Liners', 'ZVR-PLN'],
      ['Zavira', 'Saviete', 'Zavira Saviete', 'ZVR-SAV']
    ]
  },
  // ---- agent companies: same work as DedSilva and Kaynes (orders, quotations, invoices, delivery, payments), their own letterhead and numbers ----
  {
    id: 3, code: 'CT', name: 'Citroen Enterprises', short: 'Citroen', tagline: '', catalog: [1, 2],
    address: 'Chai House, 4th Floor, P.O. Box 52878-00200, Nairobi, Kenya', phone: '+254 713 908512', email: '',   // TODO: add Citroen\'s email
    color: '#650021', accent: '#c9a04a', logoHeight: 18, logo: 'citroen-logo.png', icon: 'citroen-logo.png',
    barcodePrefix: 'CT', orderPrefix: 'CT-ORD', quotePrefix: 'CT-QT', lpoPrefix: 'CT-LPO', invoicePrefix: 'CT-INV', dnPrefix: 'CT-DN', vat: 16, termsDays: 30,
    paymentDetails: [], // TODO: Citroen's bank / M-Pesa lines
    otpEmail: process.env.COMPANY_EMAIL_CT || process.env.COMPANY_EMAIL || '', otpWhatsapp: process.env.COMPANY_WHATSAPP_CT || process.env.COMPANY_WHATSAPP || '',
    brands: ['Pitwan\u2122', 'Slayer\u2122', 'DedSilva', 'Zavira', 'Third-party'], categories: [], products: []
  },
  {
    id: 4, code: 'AP', name: 'AeroParts Limited', short: 'AeroParts', tagline: 'Quality is a trait that we navigate', catalog: [1, 2],
    address: 'National House, Koinange Street, P.O. Box 28296-00200, Nairobi, Kenya', phone: '+254 715 526067', email: '',
    color: '#c8102e', logoHeight: 18, logo: 'aeroparts-logo.png', icon: 'aeroparts-logo.png',
    barcodePrefix: 'AP', orderPrefix: 'AP-ORD', quotePrefix: 'AP-QT', lpoPrefix: 'AP-LPO', invoicePrefix: 'AP-INV', dnPrefix: 'AP-DN', vat: 16, termsDays: 30,
    paymentDetails: [],
    otpEmail: process.env.COMPANY_EMAIL_AP || process.env.COMPANY_EMAIL || '', otpWhatsapp: process.env.COMPANY_WHATSAPP_AP || process.env.COMPANY_WHATSAPP || '',
    brands: ['Pitwan\u2122', 'Slayer\u2122', 'DedSilva', 'Zavira', 'Third-party'], categories: [], products: []
  },
  {
    id: 5, code: 'MR', name: 'Maerns Ltd', short: 'Maerns', tagline: '', catalog: [1, 2],
    address: 'Bruce House, 7th Floor, P.O. Box 22688-00100, Nairobi, Kenya', phone: '+254 715 284957', email: '',
    color: '#4b4b4b', logoHeight: 10, logoMaxW: 58, logo: 'maerns-logo.png',   // very wide logo: no header icon
    barcodePrefix: 'MR', orderPrefix: 'MR-ORD', quotePrefix: 'MR-QT', lpoPrefix: 'MR-LPO', invoicePrefix: 'MR-INV', dnPrefix: 'MR-DN', vat: 16, termsDays: 30,
    paymentDetails: [],
    otpEmail: process.env.COMPANY_EMAIL_MR || process.env.COMPANY_EMAIL || '', otpWhatsapp: process.env.COMPANY_WHATSAPP_MR || process.env.COMPANY_WHATSAPP || '',
    brands: ['Pitwan\u2122', 'Slayer\u2122', 'DedSilva', 'Zavira', 'Third-party'], categories: [], products: []
  },
  {
    id: 6, code: 'OB', name: 'ORBiken Limited', short: 'ORBiken', tagline: 'Bringing Excellence to the Surface', catalog: [1, 2],
    address: '', phone: '', email: '',   // TODO: ORBiken's letterhead has no address or phone yet: add them here
    color: '#c2185b', logoHeight: 18, logo: 'orbiken-logo.png', icon: 'orbiken-logo.png',
    barcodePrefix: 'OB', orderPrefix: 'OB-ORD', quotePrefix: 'OB-QT', lpoPrefix: 'OB-LPO', invoicePrefix: 'OB-INV', dnPrefix: 'OB-DN', vat: 16, termsDays: 30,
    paymentDetails: [],
    otpEmail: process.env.COMPANY_EMAIL_OB || process.env.COMPANY_EMAIL || '', otpWhatsapp: process.env.COMPANY_WHATSAPP_OB || process.env.COMPANY_WHATSAPP || '',
    brands: ['Pitwan\u2122', 'Slayer\u2122', 'DedSilva', 'Zavira', 'Third-party'], categories: [], products: []
  }
];

const byId = id => COMPANIES.find(c => c.id === +id) || COMPANIES[0];
const exists = f => { try { return !!f && fs.existsSync(path.join(__dirname, 'public', 'img', f)); } catch (e) { return false; } };

// what the browser is told about a company (no private settings)
const publicInfo = c => ({
  id: c.id, code: c.code, name: c.name, short: c.short, tagline: c.tagline, address: c.address, phone: c.phone, email: c.email, web: c.web || '', labelLogo: !!c.labelLogo && exists(c.logo),
  color: c.color, logo: exists(c.logo) ? 'img/' + c.logo : null, icon: exists(c.icon) ? 'img/' + c.icon : null,
  catalog: catalogIds(c.id), barcodePrefix: c.barcodePrefix, orderPrefix: c.orderPrefix, vat: c.vat, termsDays: c.termsDays, brands: c.brands, categories: c.categories
});

// the companies whose products and stock a company sells: itself, plus (for agent companies) DedSilva and Kaynes
const catalogIds = cid => { const c = byId(cid); return [...new Set([c.id, ...(c.catalog || [])])]; };
// products and stock a user can see/use: those of every company they work in, and of the companies those sell for
const stockIds = u => [...new Set(ids(u).flatMap(catalogIds))];
const canStock = (u, cid) => stockIds(u).includes(+cid);

// which company ids a user may work in: administrators always all; others as set on their account
function ids(u) {
  const all = COMPANIES.map(c => c.id);
  if (!u) return [];
  if (u.role === 'admin' || !u.companies || u.companies === 'all') return all;
  const list = String(u.companies).split(',').map(Number).filter(n => all.includes(n));
  return list;
}
const can = (u, cid) => ids(u).includes(+cid);
const parseAccess = v => { // 'all', an id, or a list of ids -> stored string, or null if invalid
  if (v === 'all' || v === undefined || v === null || v === '') return 'all';
  const list = [].concat(v).join(',').split(',').map(s => +s).filter(Boolean);
  return list.length && list.every(n => COMPANIES.some(c => c.id === n)) ? [...new Set(list)].join(',') : null;
};

function migrate(db) {
  const colsOf = t => db.prepare(`pragma table_info(${t})`).all().map(c => c.name);
  if (!colsOf('products').includes('company_id')) db.exec('alter table products add column company_id integer default 1');
  if (!colsOf('users').includes('companies')) db.exec("alter table users add column companies text default 'all'");
  db.exec('update products set company_id=1 where company_id is null');
}

// add each other company's starting catalogue once (never again, so deleted/renamed items stay that way)
function seedProducts(db) {
  const get = k => (db.prepare('select v from meta where k=?').get(k) || {}).v;
  const ins = db.prepare('insert into products(brand,cat,name,sku,min,company_id) values(?,?,?,?,0,?)');
  for (const c of COMPANIES) {
    if (!c.products.length || get('seeded_company_' + c.id)) continue;
    db.transaction(() => {
      for (const [brand, cat, name, sku] of c.products) {
        if (!db.prepare('select 1 from products where sku=?').get(sku)) ins.run(brand, cat, name, sku, c.id);
      }
      db.prepare('insert into meta(k,v) values(?,?) on conflict(k) do update set v=excluded.v').run('seeded_company_' + c.id, '1');
    })();
  }
}

module.exports = { COMPANIES, byId, publicInfo, ids, can, catalogIds, stockIds, canStock, parseAccess, migrate, seedProducts };
