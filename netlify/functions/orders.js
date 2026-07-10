// netlify/functions/orders.js
// Приймає замовлення з сайту (POST, публічно) і віддає/оновлює/видаляє їх для адмінки
// (GET / PATCH / DELETE, захищено паролем). Дані зберігаються у Netlify Blobs —
// окремому сховищі, яке автоматично доступне на Netlify, без сторонніх сервісів і токенів.

const { getStore } = require('@netlify/blobs');

// Пароль для перегляду/зміни замовлень з адмінки.
// Рекомендується задати свій у Netlify: Site settings → Environment variables → ADMIN_PASSWORD.
// Якщо змінну не задано — використовується значення нижче (те саме, що й пароль входу в admin.html за замовчуванням).
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'smartstore2026';

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

function isAuthorized(event) {
  const headers = event.headers || {};
  const pass = headers['x-admin-pass'] || headers['X-Admin-Pass'];
  return pass === ADMIN_PASSWORD;
}

exports.handler = async (event) => {
  try {
    const store = getStore('orders');

    if (event.httpMethod === 'POST') {
      // Публічно: клієнт залишає замовлення з сайту
      let body;
      try {
        body = JSON.parse(event.body || '{}');
      } catch (e) {
        return json(400, { error: 'Некоректний JSON' });
      }

      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const order = {
        id,
        createdAt: new Date().toISOString(),
        status: 'new',
        name: String(body.name || '').slice(0, 200),
        phone: String(body.phone || '').slice(0, 60),
        city: String(body.city || '').slice(0, 200),
        delivery: String(body.delivery || '').slice(0, 200),
        branch: String(body.branch || '').slice(0, 300),
        payment: String(body.payment || '').slice(0, 100),
        comment: String(body.comment || '').slice(0, 1000),
        items: String(body.items || '').slice(0, 4000),
        total: String(body.total || '').slice(0, 100),
      };

      await store.setJSON(id, order);
      return json(200, { ok: true, id });
    }

    if (event.httpMethod === 'GET') {
      if (!isAuthorized(event)) return json(401, { error: 'Невірний пароль' });

      const { blobs } = await store.list();
      const orders = await Promise.all(
        blobs.map((b) => store.get(b.key, { type: 'json' }))
      );
      orders.sort((a, b) => String(b && b.createdAt).localeCompare(String(a && a.createdAt)));
      return json(200, { orders: orders.filter(Boolean) });
    }

    if (event.httpMethod === 'PATCH') {
      if (!isAuthorized(event)) return json(401, { error: 'Невірний пароль' });
      let body;
      try {
        body = JSON.parse(event.body || '{}');
      } catch (e) {
        return json(400, { error: 'Некоректний JSON' });
      }
      if (!body.id) return json(400, { error: 'Немає id' });

      const existing = await store.get(body.id, { type: 'json' });
      if (!existing) return json(404, { error: 'Замовлення не знайдено' });

      if (body.status) existing.status = String(body.status).slice(0, 40);
      await store.setJSON(body.id, existing);
      return json(200, { ok: true });
    }

    if (event.httpMethod === 'DELETE') {
      if (!isAuthorized(event)) return json(401, { error: 'Невірний пароль' });
      const id = event.queryStringParameters && event.queryStringParameters.id;
      if (!id) return json(400, { error: 'Немає id' });
      await store.delete(id);
      return json(200, { ok: true });
    }

    return json(405, { error: 'Метод не підтримується' });
  } catch (err) {
    return json(500, { error: 'Внутрішня помилка сервера', details: String(err && err.message || err) });
  }
};
