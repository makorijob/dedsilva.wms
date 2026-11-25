'use strict';
// Reads a .env file next to the app (KEY=value per line) into process.env. Real environment variables win over the file.
// If a key appears more than once in the file, the LAST one is used (so a line added at the bottom overrides an earlier one).
// No extra package needed. Lines starting with # are comments. Quotes around a value are removed.
const fs = require('fs'), path = require('path');
const file = process.env.ENV_FILE || path.join(__dirname, '.env');
try {
  const vals = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if (/^([\'"]).*\1$/.test(v)) v = v.slice(1, -1); else v = v.replace(/\s+#.*$/, '');
    vals[m[1]] = v;
  }
  for (const k of Object.keys(vals)) if (!(k in process.env)) process.env[k] = vals[k];
} catch (e) { /* no .env file: use the normal environment */ }
