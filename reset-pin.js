// LAST RESORT: reset a PIN from the command line when no administrator can sign in.
// Normally an administrator does this on the Staff screen (Reset PIN), with no command line.
//   node reset-pin.js                      -> lists staff (name, username, role)
//   node reset-pin.js username NEWPIN      -> sets a temporary PIN (at least 6 characters); the person must choose their own at next sign-in
// Stop the server first, or restart it afterwards.
const Database = require('better-sqlite3'), crypto = require('crypto'), path = require('path');
const file = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'wms.db');
const db = new Database(file, { fileMustExist: true });
const [who, pin] = process.argv.slice(2);
const users = db.prepare('select id, name, username, role, active from users order by id').all();
if (!who) { console.table(users); console.log('To reset a PIN:  node reset-pin.js username NEWPIN'); process.exit(0); }
if (!pin || pin.length < 6) { console.log('The new PIN must be at least 6 characters.'); process.exit(1); }
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync(String(pin), salt, 32).toString('hex');
// matches the username first, then the full name; also re-activates the account and signs out any open sessions (tv)
const r = db.prepare('update users set salt=?, hash=?, active=1, must_change=1, tv=coalesce(tv,0)+1 where lower(username)=lower(?) or name=?').run(salt, hash, who, who);
if (r.changes) {
  try { db.prepare('create table if not exists audit(id integer primary key, at integer, by text, text text)').run(); db.prepare('insert into audit(at,by,text) values(?,?,?)').run(Date.now(), 'command line', `PIN reset for ${who} with reset-pin.js`); } catch (e) { /* not important */ }
  console.log(`Temporary PIN set for "${who}". They will be asked to choose their own PIN when they sign in. Restart the server if it is running.`);
} else { console.log(`No user "${who}". Usernames are:`); console.table(users); process.exit(1); }
