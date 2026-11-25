'use strict';
// Makes a safe, compressed copy of the database (works while the system is running).
//   node scripts/backup.js          run by cron every night (see deploy/setup-vps.sh)
// Settings (.env): DATA_DIR, BACKUP_DIR (default /var/backups/dedsilva-wms), BACKUP_KEEP_DAYS (default 30),
//                  BACKUP_RSYNC_TARGET (optional off-server copy, like backup@other-server:/backups/wms/)
require('../loadenv');
const fs = require('fs'), path = require('path'), zlib = require('zlib'), { execFileSync } = require('child_process');
const Database = require('better-sqlite3');
const DATA = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DIR = process.env.BACKUP_DIR || '/var/backups/dedsilva-wms';
const KEEP = Math.max(1, +process.env.BACKUP_KEEP_DAYS || 30);
const src = path.join(DATA, 'wms.db');
if (!fs.existsSync(src)) { console.error('Backup failed: no database at ' + src); process.exit(1); }
fs.mkdirSync(DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);   // 2026-11-01-02-30
const tmp = path.join(DIR, `.wms-${stamp}.db`), out = path.join(DIR, `wms-${stamp}.db.gz`);
try {
  const db = new Database(src, { readonly: true });
  try { fs.rmSync(tmp, { force: true }); db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`); } finally { db.close(); }
  const chk = new Database(tmp, { readonly: true });
  const ok = chk.prepare('pragma integrity_check').get();
  chk.close();
  if (!ok || Object.values(ok)[0] !== 'ok') throw new Error('the copy failed its integrity check');
  fs.writeFileSync(out, zlib.gzipSync(fs.readFileSync(tmp), { level: 9 }), { mode: 0o600 });
  fs.rmSync(tmp, { force: true });
  const cutoff = Date.now() - KEEP * 864e5;
  for (const f of fs.readdirSync(DIR)) if (/^wms-.*\.db\.gz$/.test(f) && fs.statSync(path.join(DIR, f)).mtimeMs < cutoff) fs.unlinkSync(path.join(DIR, f));
  console.log(`Backup saved: ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
  if (process.env.BACKUP_RSYNC_TARGET) { execFileSync('rsync', ['-az', out, process.env.BACKUP_RSYNC_TARGET], { stdio: 'inherit' }); console.log('Copied to ' + process.env.BACKUP_RSYNC_TARGET); }
} catch (e) { fs.rmSync(tmp, { force: true }); console.error('Backup failed: ' + e.message); process.exit(1); }
