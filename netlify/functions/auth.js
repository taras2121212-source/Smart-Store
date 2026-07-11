// netlify/functions/auth.js
// Вхід в адмінку. Пароль порівнюється ЛИШЕ на сервері (env var ADMIN_PASSWORD)
// і ніколи не потрапляє в HTML/JS чи в мережеві запити після входу.
// Успішний вхід видає підписаний (HMAC) сесійний токен у HttpOnly cookie —
// JavaScript у браузері не може його прочитати чи вкрасти через XSS,
// і браузер сам додає його до кожного наступного запиту.

const { createSessionCookie, clearSessionCookie, isSessionValid, safeEqual } = require('./lib/session');
const { checkAndRegister } = require('./lib/rateLimit');

function json(statusCode, data, extraHeaders) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(extraHeaders || {}),
    },
    body: JSON.stringify(data),
  };
}

exports.handler = async (event) => {
  try {
    // GET: перевірити, чи діюча сесія (викликається при завантаженні admin.html)
    if (event.httpMethod === 'GET') {
      return json(200, { ok: isSessionValid(event) });
    }

    // POST: спроба входу за паролем
    if (event.httpMethod === 'POST') {
      const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
      if (!ADMIN_PASSWORD) {
        return json(500, {
          error: 'ADMIN_PASSWORD не задано на сервері. Задайте у Netlify: ' +
                 'Site settings → Environment variables → ADMIN_PASSWORD, потім задеплойте сайт заново.',
        });
      }

      const limit = await checkAndRegister(event, false /* peek only, no register yet */);
      if (limit.blocked) {
        const mins = Math.ceil(limit.retryAfterMs / 60000);
        return json(429, { error: `Забагато невдалих спроб. Спробуйте ще раз через ~${mins} хв.` });
      }

      let body;
      try {
        body = JSON.parse(event.body || '{}');
      } catch (e) {
        return json(400, { error: 'Некоректний запит' });
      }

      const password = String(body.password || '');
      const ok = password.length > 0 && safeEqual(password, ADMIN_PASSWORD);

      if (!ok) {
        await checkAndRegister(event, true);
        return json(401, { error: 'Невірний пароль' });
      }

      await checkAndRegister(event, false);
      return json(200, { ok: true }, { 'Set-Cookie': createSessionCookie() });
    }

    // DELETE: вихід (очистити сесію)
    if (event.httpMethod === 'DELETE') {
      return json(200, { ok: true }, { 'Set-Cookie': clearSessionCookie() });
    }

    return json(405, { error: 'Метод не підтримується' });
  } catch (err) {
    return json(500, { error: 'Внутрішня помилка сервера', details: String((err && err.message) || err) });
  }
};
