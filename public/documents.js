/* Printable documents on the company letterhead. Used by the server (Node) to produce PDFs.

   const D = require('./public/documents.js');
   D.invoice(jsPDF, order, ctx)      -> jsPDF document   (tax invoice, with payments received and balance due)
   D.proforma(jsPDF, order, ctx)     -> jsPDF document   (proforma invoice / quotation, with customer acceptance block)
   D.deliveryNote(jsPDF, order, ctx) -> jsPDF document   (no prices; barcode checklist; driver and customer sign-off)
   D.statement(jsPDF, data, ctx)     -> jsPDF document   (customer statement of account with ageing)

   ctx.company  = { name, short, tagline, color:[r,g,b], logo:{d,type}, footer, payment:[lines] }
   ctx.products = [{ id, sku, name }]      ctx.codes = [{ code, pid }]
   ctx.JsBarcode = the JsBarcode function   (every page carries the document's own Code 128 barcode, drawn as vector bars)
   ctx.sign     = { preparedBy, preparedAt, authorizedBy, authorizedAt }  names + times printed in the sign-off block

   Every document has the same letterhead, red rule, barcode, address footer and Prepared / Authorised / Received style sign-off. */
(function (root) {
  var RED0 = [205, 24, 29], INK = [40, 40, 45], GREY = [110, 118, 125], LIGHT = [245, 246, 247], GREEN = [27, 127, 75];
  var MX = 14, W = 182, RIGHT = MX + W;           // A4 portrait, 14 mm side margins
  var TOP = 36, BOTTOM = 270;                      // body area between letterhead and footer
  var COMPANY0 = "DedSilva International Limited | Cardinal Otunga Plaza, Kaunda Street, Nairobi, Kenya | +254 700 55 55 65 | info@dedsilva.com";

  function r2(n) { return Math.round(n * 100) / 100; }
  function money(n) { return r2(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function dateOf(t) { return new Date(t + 3 * 3600e3); }   // show dates in Nairobi time (UTC+3), wherever the server runs
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function longDate(t) { var d = dateOf(t); return d.getUTCDate() + " " + MONTHS[d.getUTCMonth()] + " " + d.getUTCFullYear(); }
  function shortDate(t) { var d = dateOf(t); return d.getUTCDate() + " " + MONTHS[d.getUTCMonth()].slice(0, 3) + " " + d.getUTCFullYear(); }
  function shortStamp(t) { if (!t) return ""; var d = dateOf(t), z = function (n) { return ("0" + n).slice(-2); }; return shortDate(t) + ", " + z(d.getUTCHours()) + ":" + z(d.getUTCMinutes()); }

  // Code 128 bar pattern ("1" = bar, "0" = space) for a text, using JsBarcode's encoder (no canvas needed)
  function code128(JsBarcode, text) {
    var t = {}; JsBarcode(t, String(text), { format: "CODE128" });
    return t.encodings.map(function (e) { return e.data; }).join("");
  }

  // Subtotal, VAT and total exactly as the invoice shows them (also used by the server for balances)
  function totalsOf(items, vatRate) {
    // an item with vat === 0 carries no VAT; anything else (including older orders with no flag) is charged VAT at the order's rate
    var lines = (items || []).map(function (it) { var price = +it.price || 0; return { pid: it.pid, qty: it.qty, price: price, amount: r2(price * it.qty), taxable: !(it.vat === 0 || it.vat === false) }; });
    var subtotal = r2(lines.reduce(function (s, l) { return s + l.amount; }, 0)), rate = vatRate == null ? 16 : +vatRate;
    var taxable = r2(lines.reduce(function (s, l) { return s + (l.taxable ? l.amount : 0); }, 0));
    var vat = r2(Math.round(taxable * rate) / 100);
    return { lines: lines, subtotal: subtotal, taxable: taxable, exempt: r2(subtotal - taxable), vat: vat, total: r2(subtotal + vat), rate: rate };
  }
  // the VAT row under the subtotal: plain when everything is taxed, says what it was charged on when only some goods carry VAT
  function vatRow(T) {
    if (T.taxable <= 0.004 || !T.rate) return ["VAT", "Not charged"];
    if (T.exempt > 0.004) return ["VAT (" + T.rate + "% on KES " + money(T.taxable) + ")", "KES " + money(T.vat)];
    return ["VAT (" + T.rate + "%)", "KES " + money(T.vat)];
  }

  /* ---------- shared page furniture ---------- */
  function kit(jsPDF, ctx, meta) {
    var co = ctx.company || {}, RED = co.color || RED0, FOOT = co.footer || COMPANY0;
    var TAG = co.tagline === undefined ? "Delivering Results that Endure" : co.tagline;
    var logo = co.logo || ctx.logo || null;
    var JB = ctx.JsBarcode || (typeof window !== "undefined" ? window.JsBarcode : null);
    var products = ctx.products || [];
    var doc = new jsPDF({ unit: "mm", format: "a4" });
    if (logo && !(logo.w && logo.h)) { var ip = doc.getImageProperties(logo.d); logo = { d: logo.d, type: logo.type, w: ip.width, h: ip.height }; }
    var K = { doc: doc, y: TOP, RED: RED, co: co };
    K.tc = function (c) { doc.setTextColor(c[0], c[1], c[2]); };
    K.fc = function (c) { doc.setFillColor(c[0], c[1], c[2]); };
    K.font = function (style, size, color) { doc.setFont("helvetica", style); doc.setFontSize(size); K.tc(color || INK); };
    K.prod = function (pid) { return products.filter(function (p) { return p.id === pid; })[0] || { name: "Item", sku: "" }; };
    K.need = function (h) { if (K.y + h > BOTTOM) { doc.addPage(); K.y = TOP; return true; } return false; };
    K.heading = function (text) {
      K.font("bold", 9); doc.text(text, MX, K.y); K.y += 2;
      doc.setDrawColor(190); doc.setLineWidth(0.2); doc.line(MX, K.y, RIGHT, K.y); K.y += 5;
    };

    // "BILL TO" block on the left, key/value details on the right
    K.parties = function (label, name, extra, kv) {
      var y = K.y;
      K.font("bold", 7.5, GREY); doc.text(label, MX, y + 3);
      K.font("bold", 11); var cust = doc.splitTextToSize(String(name || ""), 90); doc.text(cust, MX, y + 9);
      var ly = y + 9 + cust.length * 5;
      K.font("normal", 9, GREY);
      (extra || []).forEach(function (t) { if (!t) return; doc.splitTextToSize(String(t), 90).forEach(function (s) { doc.text(s, MX, ly); ly += 4.6; }); });
      var ry = y + 3;
      kv.filter(function (r) { return r[1]; }).forEach(function (r) {
        K.font("normal", 8.5, GREY); doc.text(r[0], 118, ry);
        K.font("bold", 8.5); doc.text(String(r[1]).slice(0, 38), RIGHT, ry, { align: "right" });
        ry += 5.2;
      });
      K.y = Math.max(ly, ry) + 6;
    };

    // priced items table (invoice and proforma)
    K.priced = function (lines) {
      var X = { num: MX + 2, desc: MX + 10, qty: MX + 120, unit: MX + 150, amt: RIGHT - 2 };
      function head() {
        K.fc(RED); doc.rect(MX, K.y, W, 7, "F");
        doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(255, 255, 255);
        doc.text("#", X.num, K.y + 4.7); doc.text("Description", X.desc, K.y + 4.7);
        doc.text("Qty", X.qty, K.y + 4.7, { align: "right" }); doc.text("Unit price (KES)", X.unit, K.y + 4.7, { align: "right" }); doc.text("Amount (KES)", X.amt, K.y + 4.7, { align: "right" });
        K.y += 7;
      }
      head();
      lines.forEach(function (l, i) {
        var p = K.prod(l.pid); doc.setFont("helvetica", "bold"); doc.setFontSize(9);
        var d = doc.splitTextToSize(p.name, 100), h = Math.max(9, d.length * 4.2 + 5.2);
        if (K.need(h)) head();
        if (i % 2) { K.fc(LIGHT); doc.rect(MX, K.y, W, h, "F"); }
        K.font("normal", 9); doc.text(String(i + 1), X.num, K.y + 5.4);
        doc.setFont("helvetica", "bold"); doc.text(d, X.desc, K.y + 5.4);
        if (p.sku || l.taxable === false) { K.font("normal", 7, GREY); doc.text((p.sku || "") + (l.taxable === false ? (p.sku ? "   |   " : "") + "No VAT" : ""), X.desc, K.y + 5.4 + d.length * 4.2 - 0.6); }
        K.font("normal", 9);
        doc.text(String(l.qty), X.qty, K.y + 5.4, { align: "right" });
        doc.text(money(l.price), X.unit, K.y + 5.4, { align: "right" });
        doc.text(money(l.amount), X.amt, K.y + 5.4, { align: "right" });
        K.y += h;
      });
      doc.setDrawColor(190); doc.setLineWidth(0.2); doc.line(MX, K.y, RIGHT, K.y);
    };

    // totals block; rows = [[label, value, bold?]]
    K.totals = function (rows) {
      K.need(8 + rows.length * 6); K.y += 6;
      var TL = 128;
      rows.forEach(function (r) {
        if (r === "rule") { K.fc(RED); doc.rect(TL - 3, K.y - 4, RIGHT - TL + 3, 0.5, "F"); K.y += 2; return; }
        var bold = r[2];
        doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(bold ? 10.5 : 9);
        K.tc(bold ? INK : GREY); doc.text(r[0], TL, K.y);
        K.tc(r[3] || INK); doc.text(r[1], RIGHT - 2, K.y, { align: "right" });
        K.y += bold ? 7 : 5.5;
      });
    };

    // plain paragraph(s) of small print
    K.small = function (title, lines) {
      var all = []; lines.forEach(function (t) { doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.splitTextToSize(String(t), W).forEach(function (s) { all.push(s); }); });
      K.need(8 + all.length * 3.6); K.y += 4;
      K.font("bold", 8); doc.text(title, MX, K.y); K.y += 4;
      K.font("normal", 7.5, GREY); all.forEach(function (s) { doc.text(s, MX, K.y); K.y += 3.6; });
    };

    // blank-or-filled fields in a grid: [[label, value], ...]
    K.fields = function (title, items, cols) {
      cols = cols || 2; var cw = (W - (cols - 1) * 6) / cols, rows = Math.ceil(items.length / cols);
      K.need(12 + rows * 9); K.y += 4; K.heading(title);
      items.forEach(function (it, i) {
        var cx = MX + (i % cols) * (cw + 6), cy = K.y + Math.floor(i / cols) * 9 + 4;
        K.font("normal", 7, GREY); doc.text(it[0], cx + 1, cy - 4.2);
        if (it[1]) { K.font("bold", 8.5); doc.text(doc.splitTextToSize(String(it[1]), cw - 3)[0], cx + 1, cy - 0.8); }
        doc.setDrawColor(150); doc.setLineWidth(0.2); doc.line(cx, cy, cx + cw, cy);
      });
      K.y += rows * 9 + 2;
    };

    // sign-off: three boxes, each { title, fields: [[label, value], ...] }
    K.sign = function (boxes, footnote) {
      var rows = Math.max.apply(null, boxes.map(function (b) { return b.fields.length; })), H = 13 + rows * 9 + 6;
      K.need(H + 8); K.y += 6;
      K.font("bold", 9); doc.text("Sign-off", MX, K.y); K.y += 2;
      doc.setDrawColor(190); doc.setLineWidth(0.2); doc.line(MX, K.y, RIGHT, K.y); K.y += 5;
      var colW = (W - 8) / 3;
      boxes.forEach(function (b, i) {
        var bx = MX + i * (colW + 4);
        K.fc(LIGHT); doc.rect(bx, K.y, colW, 7, "F");
        K.font("bold", 8, RED); doc.text(b.title, bx + 2.5, K.y + 4.7);
        var ly = K.y + 13;
        b.fields.forEach(function (f) {
          K.font("normal", 7, GREY); doc.text(f[0], bx + 1, ly - 4.2);
          if (f[1]) { K.font("bold", 8.5); doc.text(doc.splitTextToSize(String(f[1]), colW - 4)[0], bx + 1, ly - 0.8); }
          doc.setDrawColor(120); doc.setLineWidth(0.25); doc.line(bx, ly, bx + colW, ly); ly += 9;
        });
      });
      K.y += H - 6;
      if (footnote) { K.font("italic", 7, GREY); doc.setFont("helvetica", "italic"); doc.text(footnote, MX, K.y); K.y += 4; }
    };

    // letterhead, barcode and footer on every page, then hand back the document
    K.finish = function () {
      var n = doc.getNumberOfPages();
      for (var p = 1; p <= n; p++) {
        doc.setPage(p);
        if (logo) {
          var lh = co.logoHeight || 15, lw = lh * logo.w / logo.h;
          if (co.logoMaxW && lw > co.logoMaxW) { lw = co.logoMaxW; lh = lw * logo.h / logo.w; }   // a very wide logo is shrunk to fit the header
          var lt = lh > 15 ? 28 - lh - 1 : 9 + (15 - lh) / 2; doc.addImage(logo.d, logo.type || "JPEG", MX, lt, lw, lh);
        }
        else {
          var big = String(co.short || "DedSilva").toUpperCase(), rest = String(co.name || "DedSilva International Limited"), small = (rest.toLowerCase().indexOf(big.toLowerCase()) === 0 ? rest.slice(big.length) : rest).trim().toUpperCase();
          K.tc(RED); doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.text(big, MX, 16); doc.setFontSize(7); K.tc(GREY); doc.text(small, MX, 20);
        }
        K.tc(INK); doc.setFont("times", "bold"); doc.setFontSize(meta.titleSize || 20); doc.text(meta.title, RIGHT, 16, { align: "right" });
        K.font("normal", 8, GREY); doc.text(meta.subtitle || "", RIGHT, 22, { align: "right" });
        if (JB && meta.number) {
          var bits = code128(JB, meta.number), mw = Math.min(0.4, 56 / bits.length), bw = bits.length * mw, bx0 = 105 - bw / 2, i = 0;
          doc.setFillColor(0, 0, 0);
          while (i < bits.length) { if (bits[i] === "1") { var j = i; while (j < bits.length && bits[j] === "1") j++; doc.rect(bx0 + i * mw, 9, (j - i) * mw, 11, "F"); i = j; } else i++; }
          K.font("normal", 7.5); doc.text(String(meta.number), 105, 23.6, { align: "center" });
        }
        K.fc(RED); doc.rect(MX, 27.5, W, 0.7, "F");
        var LN = co.accent || INK; doc.setDrawColor(LN[0], LN[1], LN[2]); doc.setLineWidth(co.accent ? 0.5 : 0.2); doc.line(MX, 29.2, RIGHT, 29.2);
        doc.setDrawColor(190); doc.setLineWidth(0.2); doc.line(MX, 284, RIGHT, 284);
        if (TAG) { doc.setFont("times", "italic"); doc.setFontSize(8.5); K.tc(INK); doc.text(TAG, MX, 288.5); }
        K.font("normal", 8, GREY); doc.text("Page " + p + " of " + n, RIGHT, 288.5, { align: "right" });
        doc.setFontSize(6.5); doc.splitTextToSize(FOOT, W).slice(0, 2).forEach(function (ln, li) { doc.text(ln, MX, 292.6 + li * 3); });
      }
      return doc;
    };
    return K;
  }

  function payLines(K) { var p = (K.co.payment || []).filter(Boolean); return p.length ? p : null; }
  function authText(o) { return o.auth_type ? (o.auth_type === "LPO" ? o.lpo_no : o.auth_type + ": " + o.authorized_by) : ""; }
  function customerLines(o) { return [o.phone, o.address]; }

  /* ---------- tax invoice ---------- */
  function invoice(jsPDF, o, ctx) {
    var sign = ctx.sign || {}, T = totalsOf(o.items, o.vat_rate), date = longDate(o.inv_at || o.updated || Date.now());
    var paid = r2(+o.paid || 0), balance = r2(T.total - paid), K = kit(jsPDF, ctx, { title: "INVOICE", subtitle: String(o.inv_no || "") + "   |   " + date, number: o.inv_no }), doc = K.doc;
    K.parties("BILL TO", o.customer, customerLines(o), [["Invoice no.", o.inv_no], ["Date", date], ["Due date", o.due_at ? longDate(o.due_at) : ""], ["Order ref.", o.ref], ["Quotation no.", o.quote_no],
      ["LPO / authorisation", authText(o)], ["Delivery note no.", o.dn_no]]);
    K.priced(T.lines.map(function (l) { return l; }));
    var rows = [["Subtotal", "KES " + money(T.subtotal)], vatRow(T), "rule", ["TOTAL", "KES " + money(T.total), true]];
    if (paid > 0) { rows.push(["Less payments received", "- KES " + money(paid)]); rows.push("rule"); rows.push([balance <= 0.004 ? "BALANCE" : "BALANCE DUE", "KES " + money(Math.max(balance, 0)), true, balance <= 0.004 ? GREEN : INK]); }
    else { rows[3] = ["TOTAL DUE", "KES " + money(T.total), true]; }
    K.totals(rows);
    if (paid > 0 && balance <= 0.004) { // paid-in-full stamp, left of the totals
      var sy = K.y - 14; doc.setDrawColor(GREEN[0], GREEN[1], GREEN[2]); doc.setLineWidth(0.8); doc.roundedRect(MX, sy, 46, 12, 2, 2);
      K.font("bold", 14, GREEN); doc.text("PAID IN FULL", MX + 23, sy + 8, { align: "center" });
    }
    var pl = payLines(K);
    if (balance > 0.004 && pl) K.small("How to pay", pl.concat(["Please quote " + (o.inv_no || "the invoice number") + " as the payment reference."]));

    // barcode numbers of the items on this invoice, grouped by product
    var byPid = {};
    (o.codes || []).forEach(function (c) { var rec = (ctx.codes || []).filter(function (x) { return x.code === c.code; })[0], pid = rec ? rec.pid : 0; (byPid[pid] = byPid[pid] || []).push(c.code); });
    var pids = Object.keys(byPid);
    if (pids.length) {
      K.y += 6; K.need(20); K.heading("Item barcode numbers (for delivery check)"); K.y -= 0.5;
      pids.forEach(function (pid) {
        var p = K.prod(+pid), list = byPid[pid].sort(); K.need(10);
        K.font("bold", 8); doc.text(p.name + (p.sku ? " (" + p.sku + ")" : "") + " - " + list.length + " unit" + (list.length > 1 ? "s" : ""), MX, K.y); K.y += 4;
        K.font("normal", 7, GREY);
        doc.splitTextToSize(list.join(",  "), W).forEach(function (ln) { K.need(3.6); doc.text(ln, MX, K.y); K.y += 3.4; });
        K.y += 2.5;
      });
    }
    K.sign([
      { title: "PREPARED BY", fields: [["Name", sign.preparedBy], ["Date and time", shortStamp(sign.preparedAt)], ["Signature", ""]] },
      { title: "AUTHORISED BY", fields: [["Name", sign.authorizedBy], ["Date and time", shortStamp(sign.authorizedAt)], ["Signature", ""]] },
      { title: "RECEIVED BY", fields: [["Name", o.receiver_name], ["Phone / ID no.", o.receiver_phone], ["Signature", ""], ["Date received", ""]] }
    ], "Received in good order and condition. Quote the invoice number or scan the barcode above to verify this document.");
    return K.finish();
  }

  /* ---------- proforma invoice / quotation ---------- */
  function proforma(jsPDF, o, ctx) {
    var sign = ctx.sign || {}, T = totalsOf(o.items, o.vat_rate), when = o.quote_at || o.updated || Date.now(), days = +o.quote_valid_days || 14;
    var K = kit(jsPDF, ctx, { title: "PROFORMA INVOICE", titleSize: 16, subtitle: "Quotation " + (o.quote_no || "") + "   |   " + longDate(when), number: o.quote_no }), doc = K.doc;
    K.parties("PREPARED FOR", o.customer, customerLines(o), [["Quotation no.", o.quote_no], ["Date", longDate(when)], ["Valid until", longDate(when + days * 86400e3)], ["Order ref.", o.ref],
      ["Payment terms", (o.terms_days != null ? o.terms_days : (ctx.termsDays != null ? ctx.termsDays : 30)) + " days from invoice"], ["LPO / authorisation", authText(o)]]);
    K.priced(T.lines);
    K.totals([["Subtotal", "KES " + money(T.subtotal)], vatRow(T), "rule", ["TOTAL QUOTED", "KES " + money(T.total), true]]);
    K.small("Terms", ["This is a proforma invoice / quotation and is not a tax invoice. A tax invoice is issued when the goods are ready for delivery.",
      "Prices are in Kenya shillings and valid for " + days + " days from the date above. Goods are subject to availability until the order is confirmed.",
      "To accept, sign below or send your LPO quoting " + (o.quote_no || "the quotation number") + "."]);
    var pl = payLines(K); if (pl) K.small("Payment details", pl);
    K.sign([
      { title: "PREPARED BY", fields: [["Name", sign.preparedBy], ["Date and time", shortStamp(sign.preparedAt || when)], ["Signature", ""]] },
      { title: "APPROVED BY", fields: [["Name", ""], ["Date", ""], ["Signature", ""]] },
      { title: "ACCEPTED BY (CUSTOMER)", fields: [["Name and title", ""], ["LPO no.", o.lpo_no], ["Signature and stamp", ""], ["Date", ""]] }
    ], "Quote the quotation number or scan the barcode above to verify this document.");
    return K.finish();
  }

  /* ---------- delivery note ---------- */
  function deliveryNote(jsPDF, o, ctx) {
    var sign = ctx.sign || {}, when = o.inv_at || o.updated || Date.now(), doc;
    var K = kit(jsPDF, ctx, { title: "DELIVERY NOTE", titleSize: 18, subtitle: String(o.dn_no || "") + "   |   " + longDate(when), number: o.dn_no }); doc = K.doc;
    K.parties("DELIVER TO", o.customer, customerLines(o), [["Delivery note no.", o.dn_no], ["Date", longDate(when)], ["Order ref.", o.ref], ["Invoice no.", o.inv_no], ["LPO / authorisation", authText(o)]]);

    // items (no prices on a delivery note)
    var X = { num: MX + 2, desc: MX + 10, qty: MX + 118, rec: MX + 128 };
    function head() {
      K.fc(K.RED); doc.rect(MX, K.y, W, 7, "F"); doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(255, 255, 255);
      doc.text("#", X.num, K.y + 4.7); doc.text("Description", X.desc, K.y + 4.7); doc.text("Qty sent", X.qty, K.y + 4.7, { align: "right" }); doc.text("Qty received / remarks", X.rec, K.y + 4.7);
      K.y += 7;
    }
    head();
    (o.items || []).forEach(function (it, i) {
      var p = K.prod(it.pid); doc.setFont("helvetica", "bold"); doc.setFontSize(9);
      var d = doc.splitTextToSize(p.name, 100), h = Math.max(10, d.length * 4.2 + 5.2);
      if (K.need(h)) head();
      if (i % 2) { K.fc(LIGHT); doc.rect(MX, K.y, W, h, "F"); }
      K.font("normal", 9); doc.text(String(i + 1), X.num, K.y + 5.4);
      doc.setFont("helvetica", "bold"); doc.text(d, X.desc, K.y + 5.4);
      if (p.sku) { K.font("normal", 7, GREY); doc.text(p.sku, X.desc, K.y + 5.4 + d.length * 4.2 - 0.6); }
      K.font("bold", 10); doc.text(String(it.qty), X.qty, K.y + 5.4, { align: "right" });
      doc.setDrawColor(150); doc.setLineWidth(0.2); doc.line(X.rec, K.y + h - 2.5, RIGHT - 2, K.y + h - 2.5);
      K.y += h;
    });
    doc.setDrawColor(190); doc.setLineWidth(0.2); doc.line(MX, K.y, RIGHT, K.y);
    var totalQty = (o.items || []).reduce(function (s, i) { return s + i.qty; }, 0);
    K.y += 5; K.font("bold", 9); doc.text("Total units: " + totalQty, RIGHT - 2, K.y, { align: "right" }); K.y += 2;

    // barcode checklist, 4 columns with a tick box each, grouped by product
    var byPid = {};
    (o.codes || []).forEach(function (c) { var rec = (ctx.codes || []).filter(function (x) { return x.code === c.code; })[0], pid = rec ? rec.pid : 0; (byPid[pid] = byPid[pid] || []).push(c.code); });
    var pids = Object.keys(byPid);
    if (pids.length) {
      K.need(26); K.y += 4; K.heading("Check the items delivered (tick each barcode)");
      var cw = W / 4;
      pids.forEach(function (pid) {
        var p = K.prod(+pid), list = byPid[pid].sort();
        K.need(14); K.font("bold", 8); doc.text(p.name + (p.sku ? " (" + p.sku + ")" : "") + " - " + list.length + " unit" + (list.length > 1 ? "s" : ""), MX, K.y); K.y += 4.5;
        list.forEach(function (code, i) {
          if (i % 4 === 0 && i) K.y += 4.6;
          if (i % 4 === 0) K.need(6);
          var cx = MX + (i % 4) * cw;
          doc.setDrawColor(90); doc.setLineWidth(0.25); doc.rect(cx, K.y - 2.7, 2.8, 2.8);
          K.font("normal", 7.5); doc.text(code, cx + 4.2, K.y);
        });
        K.y += 7;
      });
    }

    K.fields("Delivery details", [["Receiver name", o.receiver_name], ["Receiver phone", o.receiver_phone], ["Carrier / route", o.carrier], ["Driver / rider", o.rider], ["Driver phone", o.rider_phone],
      ["Vehicle registration", o.vehicle], ["Authorised by", o.rider_auth_by], ["Dispatched on", ""]], 3);
    K.need(28); K.y += 3; K.heading("Remarks (shortages, damage or other notes)");
    for (var i = 0; i < 2; i++) { doc.setDrawColor(150); doc.setLineWidth(0.2); doc.line(MX, K.y + 3, RIGHT, K.y + 3); K.y += 7.5; }
    K.sign([
      { title: "PREPARED BY", fields: [["Name", sign.preparedBy], ["Date and time", shortStamp(sign.preparedAt || when)], ["Signature", ""]] },
      { title: "DRIVER / RIDER", fields: [["Name", o.rider], ["Phone / ID no.", o.rider_phone], ["Signature", ""], ["Date and time", ""]] },
      { title: "RECEIVED BY (CUSTOMER)", fields: [["Name", o.receiver_name], ["ID no.", ""], ["Signature and stamp", ""], ["Date and time received", ""]] }
    ], "Goods received in good order and condition unless noted above. Quote the delivery note number or scan the barcode above to verify this document.");
    return K.finish();
  }

  /* ---------- customer statement ----------
     data = { customer:{name,phone,email,address,acc_no}, asOf, from, to, opening, rows:[{at,ref,desc,debit,credit,balance}],
              closing, ageing:{current,d30,d60,d90,over90}, overdueTotal, openCount, preparedBy } */
  function statement(jsPDF, d, ctx) {
    var c = d.customer || {}, sign = ctx.sign || {};
    var period = d.from ? shortDate(d.from) + " to " + shortDate(d.to || d.asOf) : "All activity to " + shortDate(d.asOf);
    var K = kit(jsPDF, ctx, { title: "STATEMENT", titleSize: 20, subtitle: "Account " + (c.acc_no || "") + "   |   " + longDate(d.asOf), number: c.acc_no }), doc = K.doc;
    K.parties("ACCOUNT", c.name, [c.phone, c.email, c.address], [["Account no.", c.acc_no], ["Statement date", longDate(d.asOf)], ["Period", period], ["Closing balance", "KES " + money(d.closing)]]);

    // summary strip
    K.need(24); var bw = W / 3 - 2;
    [["BALANCE DUE", "KES " + money(d.closing), INK], ["OF WHICH OVERDUE", "KES " + money(d.overdueTotal || 0), (d.overdueTotal || 0) > 0 ? [179, 38, 30] : INK], ["OPEN INVOICES", String(d.openCount || 0), INK]].forEach(function (b, i) {
      var bx = MX + i * (bw + 3); K.fc(LIGHT); doc.rect(bx, K.y, bw, 15, "F"); K.fc(K.RED); doc.rect(bx, K.y, 1.2, 15, "F");
      K.font("bold", 7, GREY); doc.text(b[0], bx + 4, K.y + 5); K.font("bold", 13, b[2]); doc.text(b[1], bx + 4, K.y + 12);
    });
    K.y += 21;

    // ledger
    var X = { date: MX + 2, ref: MX + 26, desc: MX + 56, debit: MX + 128, credit: MX + 154, bal: RIGHT - 2 };
    function head() {
      K.fc(K.RED); doc.rect(MX, K.y, W, 7, "F"); doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(255, 255, 255);
      doc.text("Date", X.date, K.y + 4.7); doc.text("Reference", X.ref, K.y + 4.7); doc.text("Description", X.desc, K.y + 4.7);
      doc.text("Invoiced", X.debit, K.y + 4.7, { align: "right" }); doc.text("Paid", X.credit, K.y + 4.7, { align: "right" }); doc.text("Balance", X.bal, K.y + 4.7, { align: "right" });
      K.y += 7;
    }
    head();
    var n = 0;
    function line(cells, bold) {
      var h = 7; if (K.need(h)) head();
      if (n++ % 2) { K.fc(LIGHT); doc.rect(MX, K.y, W, h, "F"); }
      K.font(bold ? "bold" : "normal", 8.5);
      doc.text(cells[0] || "", X.date, K.y + 4.8); doc.text(String(cells[1] || "").slice(0, 16), X.ref, K.y + 4.8);
      doc.text(doc.splitTextToSize(String(cells[2] || ""), 70)[0], X.desc, K.y + 4.8);
      if (cells[3] != null && cells[3] !== "") doc.text(money(cells[3]), X.debit, K.y + 4.8, { align: "right" });
      if (cells[4] != null && cells[4] !== "") doc.text(money(cells[4]), X.credit, K.y + 4.8, { align: "right" });
      if (cells[5] != null) doc.text(money(cells[5]), X.bal, K.y + 4.8, { align: "right" });
      K.y += h;
    }
    if (d.from) line([shortDate(d.from), "", "Balance brought forward", "", "", d.opening || 0], true);
    if (!d.rows.length && !d.from) { K.font("normal", 9, GREY); doc.text("No invoices or payments yet.", MX + 2, K.y + 6); K.y += 10; }
    d.rows.forEach(function (r) { line([shortDate(r.at), r.ref, r.desc, r.debit, r.credit, r.balance]); });
    doc.setDrawColor(190); doc.setLineWidth(0.2); doc.line(MX, K.y, RIGHT, K.y);
    K.totals([["CLOSING BALANCE", "KES " + money(d.closing), true]]);

    // ageing of what is still unpaid
    var A = d.ageing || {}; K.need(34); K.y += 4; K.heading("Ageing of unpaid invoices (days past due date, as at " + shortDate(d.asOf) + ")");
    var cols = [["Not yet due", A.current], ["1-30 days", A.d30], ["31-60 days", A.d60], ["61-90 days", A.d90], ["Over 90 days", A.over90]], aw = W / 5;
    cols.forEach(function (cc, i) {
      var ax = MX + i * aw; K.fc(LIGHT); doc.rect(ax, K.y, aw - 2, 13, "F");
      K.font("normal", 7, GREY); doc.text(cc[0], ax + 2, K.y + 4.6); K.font("bold", 10, i >= 2 && (cc[1] || 0) > 0 ? [179, 38, 30] : INK); doc.text(money(cc[1] || 0), ax + 2, K.y + 10.6);
    });
    K.y += 17;
    var pl = payLines(K); if (pl && d.closing > 0.004) K.small("How to pay", pl.concat(["Please quote your account number " + (c.acc_no || "") + " and the invoice number as the payment reference."]));
    K.small("Notes", ["Payments received after the statement date are not shown. If you think anything on this statement is wrong, contact us with the invoice number within 7 days.",
      "Invoiced amounts include VAT where it applies. All amounts are in Kenya shillings (KES)."]);
    K.sign([
      { title: "PREPARED BY", fields: [["Name", sign.preparedBy], ["Date and time", shortStamp(sign.preparedAt)], ["Signature", ""]] },
      { title: "AUTHORISED BY", fields: [["Name", ""], ["Date", ""], ["Signature", ""]] },
      { title: "CUSTOMER CONFIRMS BALANCE", fields: [["Name", ""], ["Signature and stamp", ""], ["Date", ""]] }
    ]);
    return K.finish();
  }

  var api = { invoice: invoice, proforma: proforma, deliveryNote: deliveryNote, statement: statement, totalsOf: totalsOf, money: money, shortDate: shortDate };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.WmsDocs = api;
})(typeof window !== "undefined" ? window : this);
