// netlify/functions/lib/session.js
// Спільна логіка підписаних сесійних токенів (HMAC-SHA256).
// Пароль ніколи не зберігається і не передається після входу — лише
// підписаний токен з терміном дії, який неможливо підробити без SESSION_SECRET.

const crypto = require('crypto');

const COOKIE_NAME = 'ss_admin_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 годин

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      'SESSION_SECRET не задано (або закороткий). Задайте довільний довгий рядок у ' +
      'Netlify: Site settings → Environment variables → SESSION_SECRET (мінімум 16 символів).'
    );
  }
  return secret;
}

function sign(payloadObj) {
  const secret = getSecret();
  const payload = base64url(JSON.stringify(payloadObj));
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verify(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  try {
    const secret = getSecret();
    const [payload, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    const sigBuf = Buffer.from(sig || '', 'utf8');
    const expBuf = Buffer.from(expected, 'utf8');
    if (sigBuf.length !== expBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || Date.now() > data.exp) return null;
    return data;
  } catch (e) {
    return null;
  }
}

function createSessionCookie() {
  const token = sign({ exp: Date.now() + SESSION_TTL_MS, iat: Date.now() });
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function parseCookies(event) {
  const header = (event.headers && (event.headers.cookie || event.headers.Cookie)) || '';
  const out = {};
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function isSessionValid(event) {
  const cookies = parseCookies(event);
  const token = cookies[COOKIE_NAME];
  return !!verify(token);
}

// timing-safe password comparison (handles different-length inputs safely)
function safeEqual(a, b) {
  const aBuf = Buffer.from(String(a || ''), 'utf8');
  const bBuf = Buffer.from(String(b || ''), 'utf8');
  if (aBuf.length !== bBuf.length) {
    // still run a comparison of equal-length buffers to avoid an obvious
    // early-exit timing difference on length mismatch
    crypto.timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

module.exports = {
  COOKIE_NAME,
  createSessionCookie,
  clearSessionCookie,
  isSessionValid,
  safeEqual,
};
