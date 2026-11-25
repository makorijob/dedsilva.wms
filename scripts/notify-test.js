'use strict';
// Checks your email / SMS / WhatsApp settings.
//   npm run check                              shows what is set up
//   npm run notify-test -- email    you@yourdomain.com
//   npm run notify-test -- sms      +254712345678
//   npm run notify-test -- whatsapp +254712345678
require('../loadenv');
const notify = require('../notify'), companies = require('../companies');
(async () => {
  const [kind, to] = process.argv.slice(2);
  const st = notify.status(), yn = b => (b ? 'ready' : 'NOT set up');
  if (!kind) {
    console.log('\nNotification settings');
    console.log('  Email     (SMTP)                  : ' + yn(st.email.configured));
    console.log(`  SMS       (${st.sms.provider.padEnd(13)})      : ` + yn(st.sms.configured) + '   [receiver delivery code]');
    console.log(`  WhatsApp  (${st.whatsapp.provider.padEnd(13)})      : ` + yn(st.whatsapp.configured) + (st.whatsapp.configured && !st.whatsapp.template ? '   (no template: only works inside the 24-hour window)' : '') + '   [company invoice code]');
    console.log('\nCompany contacts that receive invoice codes');
    for (const c of companies.COMPANIES) console.log(`  ${c.short.padEnd(10)} email: ${c.otpEmail || '(none)'}   WhatsApp: ${c.otpWhatsapp || '(none)'}`);
    console.log('\nProduction checks');
    console.log('  SECRET set                 : ' + (process.env.SECRET ? 'yes' : 'no (a stored secret is used)'));
    console.log('  NODE_ENV=production        : ' + (process.env.NODE_ENV === 'production' ? 'yes' : 'NO'));
    console.log('  OTP_SHOW_ON_SCREEN off     : ' + (process.env.OTP_SHOW_ON_SCREEN === 'true' ? 'NO, turn it off' : 'yes'));
    console.log('  HOST                       : ' + (process.env.HOST || '0.0.0.0 (set 127.0.0.1 behind Nginx)'));
    console.log('\nSend a test:  npm run notify-test -- email|sms|whatsapp <address or number>\n');
    return;
  }
  if (!to) { console.log('Add the address or phone number to send to.'); process.exit(1); }
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const r = kind === 'email' ? await notify.email({ to, subject: 'Warehouse system test', text: 'This is a test message from the warehouse system. If you can read it, email works.\nTest code: ' + code })
    : kind === 'sms' ? await notify.sms(to, 'Warehouse system test. Your test code is ' + code)
    : kind === 'whatsapp' ? await notify.whatsapp(to, { code, text: 'Warehouse system test. Your test code is ' + code })
    : { ok: false, error: 'Use email, sms or whatsapp.' };
  console.log(r.ok ? `\nSent (${kind}) to ${r.to}. Test code ${code}.\n` : `\nFAILED (${kind}): ${r.error}\n`);
  process.exit(r.ok ? 0 : 1);
})();
