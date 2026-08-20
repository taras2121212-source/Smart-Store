// netlify/functions/rozetka-settings.js
// Зберігання токена Rozetka Marketplace API, введеного в адмінці.
//
// GET  — лише для залогінених адмінів. НІКОЛИ не повертає повний токен назад
//        у відповіді (тільки чи він взагалі збережений + останні 4 символи,
//        щоб адмін міг впізнати, який токен збережено, не бачачи його цілком).
// PUT  — лише для залогінених адмінів. Зберігає токен у Netlify Blobs.

const { getStore } = require('@netlify/blobs');
const { isSessionValid } = require('./lib/session');

function getSettingsStore() {
  const siteID = process.env.BLOBS_SITE_ID;
  const token = process.env.BLOBS_TOKEN;
  const opts = { name: 'settings', consistency: 'strong' };
  if (siteID && token) {
    opts.siteID = siteID;
    opts.token = token;
  }
  return getStore(opts);
}

function json(statusCode, data) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(data),
  };
}

const TOKEN_KEY = 'rozetkaToken';

exports.handler = async (event) => {
  try {
    if (!isSessionValid(event)) {
      return json(401, { error: 'Сесія недійсна або закінчилась — увійдіть в адмінку знову' });
    }

    const store = getSettingsStore();

    if (event.httpMethod === 'GET') {
      const rec = await store.get(TOKEN_KEY, { type: 'json' });
      const token = rec && rec.data && rec.data.token;
      return json(200, {
        hasToken: Boolean(token),
        tokenPreview: token ? `••••${String(token).slice(-4)}` : '',
        lastSyncAt: (rec && rec.data && rec.data.lastSyncAt) || null,
      });
    }

    if (event.httpMethod === 'PUT' || event.httpMethod === 'POST') {
      let body;
      try {
        body = JSON.parse(event.body || '{}');
      } catch (e) {
        return json(400, { error: 'Некоректний JSON' });
      }
      // Лишаємо ЛИШЕ видимі ASCII-символи (0x21–0x7E: латиниця, цифри,
      // дефіси, крапки тощо) — усе інше (пробіли, переноси рядків, а
      // головне — "невидимі" юнікод-символи на кшталт zero-width space
      // \u200B чи BOM \uFEFF, які \s НЕ ловить) вирізається повністю.
      // Саме такий прихований символ у токені спричиняє помилку "The
      // string did not match the expected pattern" під час формування
      // заголовка Authorization у fetch-запиті до Rozetka.
      const token = String(body.token || '').replace(/[^\x21-\x7E]+/g, '');
      if (!token) {
        return json(400, { error: 'Токен порожній' });
      }
      const rec = await store.get(TOKEN_KEY, { type: 'json' });
      const existing = (rec && rec.data) || {};
      await store.setJSON(TOKEN_KEY, { ...existing, token, updatedAt: new Date().toISOString() });
      return json(200, { ok: true, tokenPreview: `••••${token.slice(-4)}` });
    }

    return json(405, { error: 'Метод не підтримується' });
  } catch (err) {
    return json(500, { error: 'Внутрішня помилка сервера', details: String((err && err.message) || err) });
  }
};
