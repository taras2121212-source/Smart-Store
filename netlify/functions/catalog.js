// netlify/functions/catalog.js
// Дані каталогу (товари/категорії/відгуки), керовані з адмінки, без ручного
// завантаження й заміни файлів на хостингу.
//
// GET  — публічний. Повертає {seeded, data}. seeded=false означає, що з адмінки
//        ще нічого не публікували — у такому разі сайт/build.py й далі
//        користуються файлом, який лежить у репозиторії.
// PUT  — лише для залогінених адмінів (перевірка сесії з lib/session.js).
//        Записує дані в Netlify Blobs і одразу запускає пересборку сайту
//        через Build Hook (змінна середовища BUILD_HOOK_URL), щоб build.py
//        перегенерував статичні сторінки товарів/категорій з новими даними.

const { getStore } = require('@netlify/blobs');
const { isSessionValid } = require('./lib/session');

const ALLOWED_TYPES = ['products', 'categories', 'reviews'];

function getCatalogStore() {
  const siteID = process.env.BLOBS_SITE_ID;
  const token = process.env.BLOBS_TOKEN;
  // consistency: 'strong' — важливо! Без цього Netlify Blobs за замовчуванням
  // eventual consistency (оновлення/видалення можуть доходити до 60 секунд).
  // Публікація з адмінки одразу тригерить build.py, який тут-таки читає ці
  // самі дані назад — без strong consistency build міг встигнути прочитати
  // ще СТАРУ (кешовану) версію і "повернути" щойно видалені товари/категорії
  // на сайт. Strong-читання трохи повільніше, але тут це вкрай рідкісні
  // виклики (по кліку адміна), тож затримка непомітна.
  const opts = { name: 'catalog', consistency: 'strong' };
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

async function triggerBuild() {
  const hook = process.env.BUILD_HOOK_URL;
  if (!hook) return false;
  try {
    const res = await fetch(hook, { method: 'POST' });
    return res.ok;
  } catch (e) {
    return false;
  }
}

exports.handler = async (event) => {
  try {
    const store = getCatalogStore();
    const type = (event.queryStringParameters && event.queryStringParameters.type) || '';

    if (event.httpMethod === 'GET') {
      if (!ALLOWED_TYPES.includes(type)) {
        return json(400, { error: 'Невідомий тип даних (products / categories / reviews)' });
      }
      const rec = await store.get(type, { type: 'json' });
      if (!rec) return json(200, { seeded: false, data: null });
      return json(200, { seeded: true, data: rec.data, updatedAt: rec.updatedAt });
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

      if (!ALLOWED_TYPES.includes(body.type)) {
        return json(400, { error: 'Невідомий тип даних (products / categories / reviews)' });
      }
      if (!Array.isArray(body.data)) {
        return json(400, { error: 'Дані мають бути масивом' });
      }

      await store.setJSON(body.type, { data: body.data, updatedAt: new Date().toISOString() });
      const published = await triggerBuild();
      return json(200, { ok: true, published });
    }

    return json(405, { error: 'Метод не підтримується' });
  } catch (err) {
    return json(500, { error: 'Внутрішня помилка сервера', details: String((err && err.message) || err) });
  }
};
