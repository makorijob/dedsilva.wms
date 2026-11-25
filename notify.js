'use strict';
// Sends one-time codes (and other short messages) by email, SMS and WhatsApp.
//   email     Nodemailer over SMTP                          SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM
//   SMS       Africa's Talking (default) or Twilio          SMS_PROVIDER = africastalking | twilio
//   WhatsApp  Meta WhatsApp Cloud API (default) or Twilio   WHATSAPP_PROVIDER = meta | twilio
// Every send returns { ok, channel, to, error? } and never throws, so one broken channel cannot stop the others.
// Message bodies (which contain codes) are NEVER written to the server log unless NOTIFY_DEBUG_LOG=true (testing only).
const E = process.env;
const TIMEOUT = 15000;

/* ---------- phone numbers ---------- */
// Accepts 0712 345 678, 712345678, +254 712 345 678, 254712345678, 00254712345678 and returns +254712345678 (or '' if it is not a phone number)
function toE164(raw) {
  let d = String(raw || '').replace(/[^\d+]/g, '');
  if (!d) return '';
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = (E.DEFAULT_COUNTRY_CODE || '254') + d.slice(1);
  else if (d.length === 9) d = (E.DEFAULT_COUNTRY_CODE || '254') + d;
  return /^\d{10,15}$/.test(d) ? '+' + d : '';
}
const maskPhone = p => { const n = toE164(p) || String(p || ''); return n.length > 7 ? n.slice(0, 5) + '*'.repeat(n.length - 8) + n.slice(-3) : n; };
const maskEmail = e => String(e || '').replace(/^(.).*(@.*)$/, (m, a, d) => a + '***' + d);

/* ---------- which channels are set up ---------- */
const smsProvider = () => (E.SMS_PROVIDER || 'africastalking').toLowerCase();
const waProvider = () => (E.WHATSAPP_PROVIDER || 'meta').toLowerCase();
const emailConfigured = () => !!E.SMTP_HOST;
const smsConfigured = () => smsProvider() === 'twilio'
  ? !!(E.TWILIO_ACCOUNT_SID && E.TWILIO_AUTH_TOKEN && (E.TWILIO_SMS_FROM || E.TWILIO_MESSAGING_SERVICE_SID))
  : !!(E.AT_USERNAME && E.AT_API_KEY);
const whatsappConfigured = () => waProvider() === 'twilio'
  ? !!(E.TWILIO_ACCOUNT_SID && E.TWILIO_AUTH_TOKEN && E.TWILIO_WHATSAPP_FROM)
  : !!(E.WA_PHONE_NUMBER_ID && E.WA_ACCESS_TOKEN);
const status = () => ({
  email: { configured: emailConfigured(), provider: 'smtp' },
  sms: { configured: smsConfigured(), provider: smsProvider() },
  whatsapp: { configured: whatsappConfigured(), provider: waProvider(), template: !!(E.WA_TEMPLATE || E.TWILIO_WA_CONTENT_SID) }
});

const skipped = (channel, to, why, text) => {
  console.log(`[${channel.toUpperCase()} not configured] message to ${to} was not sent` + (E.NOTIFY_DEBUG_LOG === 'true' ? `\n  ${String(text).split('\n').join('\n  ')}` : ''));
  return { ok: false, channel, to, error: why };
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
// one quick retry for network trouble and 5xx answers (not for "wrong number" style failures)
async function withRetry(fn) {
  let r = await fn();
  if (!r.ok && r.retry) { await sleep(800); r = await fn(); }
  delete r.retry;
  return r;
}
async function http(url, opts) {
  try {
    const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(TIMEOUT) });
    let body = null; try { body = await res.json(); } catch (e) { /* not JSON */ }
    return { res, body };
  } catch (e) { return { err: e.name === 'TimeoutError' ? 'Timed out' : e.message }; }
}

/* ---------- email (Nodemailer) ---------- */
let mailer = null;
function transporter() {
  if (!mailer) mailer = require('nodemailer').createTransport({
    host: E.SMTP_HOST, port: +E.SMTP_PORT || 587, secure: E.SMTP_SECURE === 'true' || +E.SMTP_PORT === 465,
    auth: E.SMTP_USER ? { user: E.SMTP_USER, pass: E.SMTP_PASS } : undefined,
    pool: true, maxConnections: 3, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000
  });
  return mailer;
}
async function email({ to, subject, text, html, fromName }) {
  if (!to) return { ok: false, channel: 'email', to: '', error: 'No email address set for this company.' };
  if (!emailConfigured()) return skipped('email', to, 'Email (SMTP) is not set up on the server.', subject + '\n' + text);
  return withRetry(async () => {
    try {
      const addr = E.SMTP_FROM || E.SMTP_USER || E.COMPANY_EMAIL;
      const from = fromName && !/</.test(addr) ? `"${String(fromName).replace(/"/g, '')}" <${addr}>` : addr;
      await transporter().sendMail({ from, to, subject, text, html });
      return { ok: true, channel: 'email', to };
    } catch (e) {
      mailer = null; // rebuild the connection next time
      console.error('Email failed:', e.message);
      return { ok: false, channel: 'email', to, error: e.message, retry: !(e.responseCode >= 500 && e.responseCode < 600) };
    }
  });
}

/* ---------- SMS ---------- */
async function sms(to, text) {
  const num = toE164(to);
  if (!num) return { ok: false, channel: 'sms', to: String(to || ''), error: 'That does not look like a phone number.' };
  if (!smsConfigured()) return skipped('sms', num, 'SMS is not set up on the server.', text);
  return withRetry(() => smsProvider() === 'twilio' ? smsTwilio(num, text) : smsAfricasTalking(num, text));
}
async function smsAfricasTalking(num, text) {
  const sandbox = E.AT_SANDBOX === 'true' || E.AT_USERNAME === 'sandbox';
  const base = E.AT_BASE_URL || (sandbox ? 'https://api.sandbox.africastalking.com' : 'https://api.africastalking.com');
  const form = { username: E.AT_USERNAME, to: num, message: text };
  if (E.AT_SENDER_ID) form.from = E.AT_SENDER_ID;
  const { res, body, err } = await http(base + '/version1/messaging', { method: 'POST',
    headers: { apiKey: E.AT_API_KEY, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) });
  if (err) return { ok: false, channel: 'sms', to: num, error: err, retry: true };
  const rec = body && body.SMSMessageData && body.SMSMessageData.Recipients && body.SMSMessageData.Recipients[0];
  // statusCode 100 processed, 101 sent, 102 queued; anything else is a failure (the HTTP call itself can still be 201)
  if (res.ok && rec && [100, 101, 102].includes(+rec.statusCode)) return { ok: true, channel: 'sms', to: num, id: rec.messageId };
  const why = rec ? rec.status : (body && body.SMSMessageData && body.SMSMessageData.Message) || ('HTTP ' + res.status);
  console.error('SMS failed (Africa\'s Talking):', why);
  return { ok: false, channel: 'sms', to: num, error: String(why), retry: res.status >= 500 };
}
async function smsTwilio(num, text) {
  const base = E.TWILIO_BASE_URL || 'https://api.twilio.com';
  const form = { To: num, Body: text };
  if (E.TWILIO_MESSAGING_SERVICE_SID) form.MessagingServiceSid = E.TWILIO_MESSAGING_SERVICE_SID; else form.From = E.TWILIO_SMS_FROM;
  return twilioSend(base, num, form, 'sms');
}
async function twilioSend(base, num, form, channel) {
  const { res, body, err } = await http(`${base}/2010-04-01/Accounts/${E.TWILIO_ACCOUNT_SID}/Messages.json`, { method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(E.TWILIO_ACCOUNT_SID + ':' + E.TWILIO_AUTH_TOKEN).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form) });
  if (err) return { ok: false, channel, to: num, error: err, retry: true };
  if (res.ok && body && body.sid && !body.error_code) return { ok: true, channel, to: num, id: body.sid };
  const why = (body && (body.message || body.error_message)) || ('HTTP ' + res.status);
  console.error(`${channel} failed (Twilio):`, why);
  return { ok: false, channel, to: num, error: String(why), retry: res.status >= 500 };
}

/* ---------- WhatsApp ---------- */
// text = the message for a plain WhatsApp message; code = the one-time code for an approved template.
// Meta only allows plain text to a person who messaged you in the last 24 hours. For codes sent to the company at any time
// you need an approved TEMPLATE (authentication category): set WA_TEMPLATE (Meta) or TWILIO_WA_CONTENT_SID (Twilio).
async function whatsapp(to, { text, code, textOnly }) {
  const num = toE164(to);
  if (!num) return { ok: false, channel: 'whatsapp', to: String(to || ''), error: 'No WhatsApp number set for this company.' };
  if (!whatsappConfigured()) return skipped('whatsapp', num, 'WhatsApp is not set up on the server.', text);
  return withRetry(() => waProvider() === 'twilio' ? waTwilio(num, text, code, textOnly) : waMeta(num, text, code, textOnly));
}
async function waMeta(num, text, code, textOnly) {
  const base = E.WA_BASE_URL || 'https://graph.facebook.com';
  const payload = { messaging_product: 'whatsapp', to: num.slice(1) };
  if (E.WA_TEMPLATE && !textOnly) {
    const comps = [{ type: 'body', parameters: [{ type: 'text', text: String(code) }] }];
    if (E.WA_TEMPLATE_BUTTON !== 'false') comps.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: String(code) }] }); // authentication templates have a copy-code button
    payload.type = 'template';
    payload.template = { name: E.WA_TEMPLATE, language: { code: E.WA_TEMPLATE_LANG || 'en' }, components: comps };
  } else { payload.type = 'text'; payload.text = { body: text, preview_url: false }; }
  const { res, body, err } = await http(`${base}/${E.WA_API_VERSION || 'v21.0'}/${E.WA_PHONE_NUMBER_ID}/messages`, { method: 'POST',
    headers: { Authorization: 'Bearer ' + E.WA_ACCESS_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (err) return { ok: false, channel: 'whatsapp', to: num, error: err, retry: true };
  if (res.ok && body && body.messages && body.messages[0]) return { ok: true, channel: 'whatsapp', to: num, id: body.messages[0].id };
  const why = (body && body.error && body.error.message) || ('HTTP ' + res.status);
  console.error('WhatsApp failed (Meta):', why);
  return { ok: false, channel: 'whatsapp', to: num, error: String(why), retry: res.status >= 500 };
}
async function waTwilio(num, text, code, textOnly) {
  const base = E.TWILIO_BASE_URL || 'https://api.twilio.com';
  const form = { To: 'whatsapp:' + num, From: 'whatsapp:' + toE164(E.TWILIO_WHATSAPP_FROM) };
  if (E.TWILIO_WA_CONTENT_SID && !textOnly) { form.ContentSid = E.TWILIO_WA_CONTENT_SID; form.ContentVariables = JSON.stringify({ 1: String(code) }); } else form.Body = text;
  return twilioSend(base, num, form, 'whatsapp');
}

module.exports = { email, sms, whatsapp, status, toE164, maskPhone, maskEmail, smsConfigured, whatsappConfigured, emailConfigured };
