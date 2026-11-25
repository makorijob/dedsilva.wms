/* Automatic SKU for a new product, made from its brand and name.
   Used by the Products screen (live, as the name is typed) and by the server (as a safety net).
     Pitwan + "Quick-release vest"        ->  PTW-QRV
     Zavira + "Zavira Regular Sanitary Pads" -> ZVR-RSP
   Brand code: first letter + next consonants of the brand (Pitwan = PTW, Zavira = ZVR), or the initials of a two-word brand.
   Name part: initials of the first 3 words, or the first letters of one or two words. Clashes get a number (PTW-QRV2). */
(function (root) {
  var STOP = /^(AND|THE|OF|FOR|WITH|A|AN|IN|ON|TO)$/;
  function words(s) { return String(s || "").toUpperCase().replace(/[\u2122\u00ae\u00a9]/g, "").split(/[^A-Z0-9]+/).filter(Boolean); }
  function skeleton(w) { var c = w.charAt(0) + w.slice(1).replace(/[AEIOU]/g, ""); return c.length >= 3 ? c.slice(0, 3) : w.slice(0, 3); }
  function brandCode(brand) {
    var w = words(brand);
    if (!w.length) return "";
    return w.length > 1 ? w.map(function (x) { return x.charAt(0); }).join("").slice(0, 3) : skeleton(w[0]);
  }
  function namePart(name, brand, size) {
    // the size is added to the SKU separately, so "290" / "290mm" in the name is not used twice
    var bw = words(brand), w = words(name).filter(function (x) { return !STOP.test(x) && bw.indexOf(x) < 0 && !(+size > 0 && (x === String(+size) || x === (+size) + "MM")); });
    if (!w.length) w = words(name);
    if (!w.length) return "";
    if (w.length >= 3) return w.slice(0, 3).map(function (x) { return x.charAt(0); }).join("");
    if (w.length === 2) return w[0].slice(0, 2) + w[1].charAt(0);
    return skeleton(w[0]);
  }
  // existing = list of SKUs already in use (any company); returns a SKU that is not in the list
  // pad sizes (length in mm) and how many packs go in one carton of that size
  var CARTON_BY_SIZE = { 155: 60, 290: 100, 340: 100 };
  function cartonFor(size) { return CARTON_BY_SIZE[+size] || 0; }
  function suggest(brand, name, existing, size) {
    var n = namePart(name, brand, size);
    if (!n) return "";
    var b = brandCode(brand), base = (b ? b + "-" : "") + n, used = {};
    (existing || []).forEach(function (s) { used[String(s || "").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "")] = 1; });
    base = base.slice(0, 20);
    if (+size > 0) base = base.slice(0, 16) + "-" + (+size);   // different sizes of the same product get different SKUs (ZVR-REG-155, ZVR-REG-290)
    var sku = base, i = 1;
    while (used[sku]) { i++; sku = base + i; }
    return sku;
  }
  var api = { suggest: suggest, brandCode: brandCode, namePart: namePart, cartonFor: cartonFor, SIZES: [155, 290, 340] };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.SKU = api;
})(typeof window !== "undefined" ? window : this);
