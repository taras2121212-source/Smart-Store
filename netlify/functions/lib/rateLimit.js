// netlify/functions/lib/rateLimit.js
// Проста абонплата за спроби входу: після 5 невдалих спроб з однієї IP —
// блокування на 10 хвилин. Зберігається в Netlify Blobs (без сторонніх сервісів).

const { getStore } = require('@netlify/blobs');

const MAX_ATTEMPTS = 5;
const LOCK_MS = 10 * 60 * 1000;

function getStoreSafe() {
  const siteID = process.env.BLOBS_SITE_ID;
  const token = process.env.BLOBS_TOKEN;
  if (siteID && token) {
    return getStore({ name: 'auth-attempts', siteID, token });
  }
  return getStore('auth-attempts');
}

function clientIp(event) {
  const h = event.headers || {};
  return (
    h['x-nf-client-connection-ip'] ||
    h['client-ip'] ||
    (h['x-forwarded-for'] || '').split(',')[0].trim() ||
    'unknown'
  );
}

async function checkAndRegister(event, failed) {
  let store;
  try {
    store = getStoreSafe();
  } catch (e) {
    // Якщо Blobs недоступний — не блокуємо вхід через цю опційну функцію,
    // основний захист (пароль + підписаний токен) працює незалежно від неї.
    return { blocked: false };
  }
  const ip = clientIp(event);
  const key = `ip:${ip}`;
  const now = Date.now();
  let rec = null;
  try {
    rec = await store.get(key, { type: 'json' });
  } catch (e) {
    rec = null;
  }
  if (!rec || now > rec.lockedUntil && now - rec.first > LOCK_MS) {
    rec = { count: 0, first: now, lockedUntil: 0 };
  }
  if (rec.lockedUntil && now < rec.lockedUntil) {
    return { blocked: true, retryAfterMs: rec.lockedUntil - now };
  }
  if (failed) {
    rec.count += 1;
    if (rec.count >= MAX_ATTEMPTS) {
      rec.lockedUntil = now + LOCK_MS;
      rec.count = 0;
    }
    await store.setJSON(key, rec);
    return { blocked: false };
  }
  // successful login: reset counter
  await store.setJSON(key, { count: 0, first: now, lockedUntil: 0 });
  return { blocked: false };
}

module.exports = { checkAndRegister };
