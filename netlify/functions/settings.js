// netlify/functions/settings.js
// Налаштування сайту, керовані з адмінки — наразі реквізити картки для оплати
// замовлень ("Повна оплата на картку").
//
// GET  — публічний. Повертає збережені реквізити (щоб показати покупцю блок
//        з номером картки одразу після оформлення замовлення).
// PUT  — лише для залогінених адмінів (перевірка сесії з lib/session.js).
//        Зберігає реквізити в Netlify Blobs.

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

const CARD_KEY = 'paymentCard';

function sanitizeCard(body) {
  return {
    cardNumber: String((body && body.cardNumber) || '').slice(0, 40),
    holderName: String((body && body.holderName) || '').slice(0, 200),
    bank: String((body && body.bank) || '').slice(0, 100),
    comment: String((body && body.comment) || '').slice(0, 500),
  };
}

exports.handler = async (event) => {
  try {
    const store = getSettingsStore();

    if (event.httpMethod === 'GET') {
      const rec = await store.get(CARD_KEY, { type: 'json' });
      const card = rec && rec.data ? rec.data : { cardNumber: '', holderName: '', bank: '', comment: '' };
      return json(200, { card });
    }

    if (event.httpMethod === 'PUT' || event.httpMethod === 'POST') {
      if (!isSessionValid(event)) {
        return json(401, { error: 'Сесія недійсна або закінчилась — увійдіть в адмінку знову' });
      }
      let body;
      try {
        body = JSON.parse(event.body || '{}');
      } catch (e) {
        return json(400, { error: 'Некоректний JSON' });
      }
      const card = sanitizeCard(body.card || body);
      await store.setJSON(CARD_KEY, { data: card, updatedAt: new Date().toISOString() });
      return json(200, { ok: true, card });
    }

    return json(405, { error: 'Метод не підтримується' });
  } catch (err) {
    return json(500, { error: 'Внутрішня помилка сервера', details: String((err && err.message) || err) });
  }
};
