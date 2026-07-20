// netlify/functions/upload-image.js
// Приймає фото з адмінки (base64 data-URL) і завантажує його на ImgBB,
// повертаючи звичайне посилання (URL). Це потрібно, щоб products.json не
// розбухав до мегабайтів через вбудовані base64-фото — саме через це
// публікація (PUT /catalog) впиралась у ліміт розміру тіла запиту Netlify
// Functions (6 MB) і падала ще ДО виклику catalog.js (тому в його логах
// нічого не було видно).
//
// POST /.netlify/functions/upload-image
// body: { dataUrl: "data:image/jpeg;base64,....", name?: "product-name" }
// відповідь: { ok:true, url, display_url, thumb, delete_url }
//
// Потребує змінну середовища IMGBB_API_KEY (Site configuration →
// Environment variables). Безкоштовний ключ можна отримати на
// https://api.imgbb.com/ (Sign up → отримаєте API key).

const { isSessionValid } = require('./lib/session');

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

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return json(405, { error: 'Метод не підтримується' });
    }

    if (!isSessionValid(event)) {
      return json(401, { error: 'Сесія недійсна або закінчилась — увійдіть в адмінку знову' });
    }

    const apiKey = process.env.IMGBB_API_KEY;
    if (!apiKey) {
      return json(500, {
        error:
          'IMGBB_API_KEY не налаштований у Netlify. Зайдіть на api.imgbb.com, отримайте безкоштовний ' +
          'API-ключ і додайте його в Site configuration → Environment variables → IMGBB_API_KEY.',
      });
    }

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (e) {
      return json(400, { error: 'Некоректний JSON' });
    }

    const rawInput = String(body.dataUrl || '');
    const match = /^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/.exec(rawInput);
    const base64 = match ? match[1] : rawInput; // дозволяємо і "голий" base64 без префіксу

    if (!base64) {
      return json(400, { error: 'Немає даних зображення (поле dataUrl порожнє)' });
    }

    // Дуже приблизна перевірка розміру (base64 ~ на 33% більший за оригінал),
    // щоб не ганяти на ImgBB щось зовсім не те.
    if (base64.length > 15 * 1024 * 1024) {
      return json(413, { error: 'Файл завеликий' });
    }

    const params = new URLSearchParams();
    params.set('key', apiKey);
    params.set('image', base64);
    if (body.name) {
      // ImgBB дозволяє задати ім'я картинки — суто для зручності в самому ImgBB
      params.set('name', String(body.name).slice(0, 60).replace(/[^a-zA-Z0-9-_ ]/g, '_'));
    }

    const res = await fetch('https://api.imgbb.com/1/upload', {
      method: 'POST',
      body: params,
    });
    const result = await res.json().catch(() => null);

    if (!res.ok || !result || !result.success) {
      const msg = (result && result.error && result.error.message) || `ImgBB відповів HTTP ${res.status}`;
      return json(502, { error: 'Не вдалось завантажити фото на хостинг: ' + msg });
    }

    return json(200, {
      ok: true,
      url: result.data.url,
      display_url: result.data.display_url || result.data.url,
      thumb: (result.data.thumb && result.data.thumb.url) || null,
      delete_url: result.data.delete_url || null,
    });
  } catch (err) {
    return json(500, { error: 'Внутрішня помилка сервера', details: String((err && err.message) || err) });
  }
};
