// netlify/functions/orders.js
// Приймає замовлення з сайту (POST, публічно) і віддає/оновлює/видаляє їх для адмінки
// (GET / PATCH / DELETE, захищено сесією). Дані зберігаються у Netlify Blobs —
// окремому сховищі, яке автоматично доступне на Netlify, без сторонніх сервісів.
//
// Авторизація: клієнт спершу логіниться через /.netlify/functions/auth (POST з паролем),
// отримує HttpOnly підписаний cookie-токен, і браузер сам додає його до цих запитів —
// пароль тут ніколи не порівнюється і не передається.
//
// Якщо клієнт вказав email — після збереження замовлення йому надсилається лист-
// підтвердження через Resend (https://resend.com). Потрібні змінні середовища
// RESEND_API_KEY і NOTIFY_FROM_EMAIL (див. EMAIL-SETUP.md). Якщо їх не задано,
// або надсилання листа не вдалось — замовлення все одно зберігається як завжди,
// це ніяк не впливає на основний потік.

const { getStore } = require('@netlify/blobs');
const { isSessionValid } = require('./lib/session');

// На деяких сайтах Netlify не підключає Blobs автоматично (помилка
// "The environment has not been configured to use Netlify Blobs").
// У такому разі сховище підключається вручну через BLOBS_SITE_ID та
// BLOBS_TOKEN (Site settings → Environment variables на Netlify).
function getOrdersStore() {
  const siteID = process.env.BLOBS_SITE_ID;
  const token = process.env.BLOBS_TOKEN;
  if (siteID && token) {
    return getStore({ name: 'orders', siteID, token });
  }
  return getStore('orders');
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

function isAuthorized(event) {
  return isSessionValid(event);
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Перевіряє, що фото — це http(s)-посилання (щоб не підсунути щось на кшталт
// javascript:/data: в атрибут src листа).
function isSafeImageUrl(u) {
  return typeof u === 'string' && /^https?:\/\//i.test(u);
}

// Приводить масив товарів кошика (з фото) до безпечного вигляду для збереження й листа.
// Обмежуємо кількість позицій і довжину полів, щоб не роздувати сховище/листи.
function sanitizeItemsDetailed(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 60).map((it) => ({
    name: String((it && it.name) || '').slice(0, 200),
    qty: Math.max(1, Math.min(9999, parseInt((it && it.qty), 10) || 1)),
    price: String((it && it.price) || '').slice(0, 40),
    img: isSafeImageUrl(it && it.img) ? String(it.img).slice(0, 500) : '',
  }));
}

function orderItemsPhotosHtml(order) {
  const items = Array.isArray(order.itemsDetailed) ? order.itemsDetailed : [];
  if (items.length === 0) return '';
  const rows = items.map((it) => `
    <tr>
      <td style="padding:8px 0; width:64px;">
        ${it.img
          ? `<img src="${escapeHtml(it.img)}" alt="${escapeHtml(it.name)}" width="56" height="56" style="width:56px; height:56px; object-fit:cover; border-radius:8px; display:block; border:1px solid #eee;">`
          : `<div style="width:56px; height:56px; border-radius:8px; background:#f4f4f2;"></div>`}
      </td>
      <td style="padding:8px 0 8px 12px; font-size:14px; vertical-align:middle;">
        <div>${escapeHtml(it.name)}</div>
        <div style="color:#777;">${it.qty} шт × ${escapeHtml(it.price)}</div>
      </td>
    </tr>`).join('');
  return `<table role="presentation" style="width:100%; border-collapse:collapse; margin:8px 0 4px;">${rows}</table>`;
}

function orderConfirmationHtml(order) {
  const photos = orderItemsPhotosHtml(order);
  const itemsHtml = photos ? '' : escapeHtml(order.items).replace(/\n/g, '<br>');
  const branchLine = order.branch ? `<br>${escapeHtml(order.branch)}` : '';
  return `
    <div style="font-family:Arial,sans-serif; max-width:520px; margin:0 auto; color:#17181c;">
      <h2 style="margin-bottom:4px;">Замовлення №${escapeHtml(order.id)} прийнято</h2>
      <p style="color:#555;">Дякуємо за замовлення в SMART STORE! Менеджер зв'яжеться з вами найближчим часом для підтвердження та деталей доставки.</p>
      <h3 style="margin-bottom:6px;">Товари</h3>
      ${photos || `<p style="white-space:pre-wrap; font-size:14px;">${itemsHtml}</p>`}
      <p style="font-size:16px;"><b>Разом: ${escapeHtml(order.total)}</b></p>
      <h3 style="margin-bottom:6px;">Доставка</h3>
      <p style="font-size:14px;">${escapeHtml(order.delivery)}${branchLine}<br>м. ${escapeHtml(order.city)}</p>
      <h3 style="margin-bottom:6px;">Оплата</h3>
      <p style="font-size:14px;">${escapeHtml(order.payment)}</p>
      ${order.comment ? `<h3 style="margin-bottom:6px;">Коментар</h3><p style="font-size:14px;">${escapeHtml(order.comment)}</p>` : ''}
      <p style="color:#999; font-size:12px; margin-top:24px;">SMART STORE</p>
    </div>`;
}

function trackingEmailHtml(order) {
  return `
    <div style="font-family:Arial,sans-serif; max-width:520px; margin:0 auto; color:#17181c;">
      <h2 style="margin-bottom:4px;">Замовлення №${escapeHtml(order.id)} відправлено</h2>
      <p style="color:#555;">Ваше замовлення передано у службу доставки. Номер ТТН для відстеження:</p>
      <p style="font-size:22px; font-weight:700; letter-spacing:.02em; background:#f4f4f2; padding:12px 16px; border-radius:10px; display:inline-block;">${escapeHtml(order.trackingNumber)}</p>
      <p style="font-size:14px; color:#555; margin-top:16px;">${escapeHtml(order.delivery)}${order.branch ? `<br>${escapeHtml(order.branch)}` : ''}<br>м. ${escapeHtml(order.city)}</p>
      <p style="color:#999; font-size:12px; margin-top:24px;">SMART STORE</p>
    </div>`;
}

// Best-effort, аналогічно sendConfirmationEmail: якщо не вдалось — не ламає збереження ТТН.
async function sendTrackingEmail(order) {
  if (!order.email) return false;
  const apiKey = process.env.RESEND_API_KEY;
  const fromAddr = process.env.NOTIFY_FROM_EMAIL;
  if (!apiKey || !fromAddr) return false;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddr,
        to: order.email,
        subject: `Замовлення №${order.id} відправлено — ТТН ${order.trackingNumber} — SMART STORE`,
        html: trackingEmailHtml(order),
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok;
  } catch (e) {
    return false;
  }
}

// Best-effort: якщо RESEND_API_KEY/NOTIFY_FROM_EMAIL не задані, або запит не вдався
// (немає мережі, невірний ключ тощо) — просто повертаємо false, замовлення це не ламає.
async function sendConfirmationEmail(order) {
  if (!order.email) return false;
  const apiKey = process.env.RESEND_API_KEY;
  const fromAddr = process.env.NOTIFY_FROM_EMAIL;
  if (!apiKey || !fromAddr) return false;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddr,
        to: order.email,
        subject: `Замовлення №${order.id} прийнято — SMART STORE`,
        html: orderConfirmationHtml(order),
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok;
  } catch (e) {
    return false;
  }
}

function reviewRequestEmailHtml(order) {
  return `
    <div style="font-family:Arial,sans-serif; max-width:520px; margin:0 auto; color:#17181c;">
      <h2 style="margin-bottom:4px;">Замовлення №${escapeHtml(order.id)} виконано 🎉</h2>
      <p style="color:#555;">Дякуємо, що обрали SMART STORE! Сподіваємось, покупка вас порадувала.</p>
      <p style="font-size:14px; color:#555;">Нам дуже важлива ваша думка — будемо вдячні за пару хвилин, щоб оцінити
      роботу магазину та залишити відгук. Це допомагає нам ставати кращими, а іншим покупцям — обирати правильно.</p>
      <p style="margin:24px 0;">
        <a href="https://smartstoreua.com/reviews.html?leave=1#reviews" style="background:#17181c; color:#fff; text-decoration:none; padding:12px 22px; border-radius:10px; font-size:15px; display:inline-block;">Залишити відгук</a>
      </p>
      <p style="color:#999; font-size:12px; margin-top:24px;">SMART STORE</p>
    </div>`;
}

// Best-effort: надсилається один раз, коли замовлення переходить у статус "done".
async function sendReviewRequestEmail(order) {
  if (!order.email) return false;
  const apiKey = process.env.RESEND_API_KEY;
  const fromAddr = process.env.NOTIFY_FROM_EMAIL;
  if (!apiKey || !fromAddr) return false;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddr,
        to: order.email,
        subject: `Дякуємо за покупку — залиште відгук про SMART STORE`,
        html: reviewRequestEmailHtml(order),
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok;
  } catch (e) {
    return false;
  }
}

exports.handler = async (event) => {
  try {
    const store = getOrdersStore();

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
        trackingNumber: '',
        reviewEmailSent: false,
        name: String(body.name || '').slice(0, 200),
        phone: String(body.phone || '').slice(0, 60),
        email: String(body.email || '').slice(0, 200),
        city: String(body.city || '').slice(0, 200),
        delivery: String(body.delivery || '').slice(0, 200),
        branch: String(body.branch || '').slice(0, 300),
        payment: String(body.payment || '').slice(0, 100),
        comment: String(body.comment || '').slice(0, 1000),
        items: String(body.items || '').slice(0, 4000),
        total: String(body.total || '').slice(0, 100),
        itemsDetailed: sanitizeItemsDetailed(body.itemsDetailed),
      };

      await store.setJSON(id, order);
      const emailSent = await sendConfirmationEmail(order);
      return json(200, { ok: true, id, emailSent });
    }

    if (event.httpMethod === 'GET') {
      if (!isAuthorized(event)) return json(401, { error: 'Сесія недійсна або закінчилась — увійдіть в адмінку знову' });

      const { blobs } = await store.list();
      const orders = await Promise.all(
        blobs.map((b) => store.get(b.key, { type: 'json' }))
      );
      orders.sort((a, b) => String(b && b.createdAt).localeCompare(String(a && a.createdAt)));
      return json(200, { orders: orders.filter(Boolean) });
    }

    if (event.httpMethod === 'PATCH') {
      if (!isAuthorized(event)) return json(401, { error: 'Сесія недійсна або закінчилась — увійдіть в адмінку знову' });
      let body;
      try {
        body = JSON.parse(event.body || '{}');
      } catch (e) {
        return json(400, { error: 'Некоректний JSON' });
      }
      if (!body.id) return json(400, { error: 'Немає id' });

      const existing = await store.get(body.id, { type: 'json' });
      if (!existing) return json(404, { error: 'Замовлення не знайдено' });

      const statusBefore = existing.status;
      const statusExplicitlySet = typeof body.status === 'string' && body.status;
      if (statusExplicitlySet) existing.status = String(body.status).slice(0, 40);

      let emailSent = false;
      let reviewEmailSent = false;

      if (typeof body.trackingNumber === 'string') {
        const newTracking = body.trackingNumber.trim().slice(0, 100);
        const trackingChanged = newTracking && newTracking !== existing.trackingNumber;
        existing.trackingNumber = newTracking;
        if (trackingChanged) {
          emailSent = await sendTrackingEmail(existing);
          // Прикріплення ТТН автоматично переводить замовлення в статус "В дорозі",
          // якщо адмін в цьому ж запиті не встановив статус вручну і замовлення
          // ще не позначене як виконане/скасоване.
          if (!statusExplicitlySet && statusBefore !== 'done' && statusBefore !== 'cancelled') {
            existing.status = 'in_transit';
          }
        }
      }

      // Коли замовлення переходить у статус "Виконано" — надсилаємо клієнту лист
      // з проханням залишити відгук. Лист надсилається лише один раз на замовлення.
      if (existing.status === 'done' && statusBefore !== 'done' && !existing.reviewEmailSent) {
        reviewEmailSent = await sendReviewRequestEmail(existing);
        existing.reviewEmailSent = reviewEmailSent;
      }

      await store.setJSON(body.id, existing);
      return json(200, { ok: true, emailSent, reviewEmailSent, status: existing.status });
    }

    if (event.httpMethod === 'DELETE') {
      if (!isAuthorized(event)) return json(401, { error: 'Сесія недійсна або закінчилась — увійдіть в адмінку знову' });
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
