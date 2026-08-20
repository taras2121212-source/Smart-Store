// netlify/functions/rozetka-sync.js
//
// Планова (scheduled) Netlify Function: раз на певний час забирає ваші товари
// з Rozetka Seller API і оновлює каталог сайту (Netlify Blobs) — так само,
// як це робить адмінка через netlify/functions/catalog.js, але автоматично.
//
// ‼️ ВАЖЛИВО ПЕРЕД ЗАПУСКОМ — прочитайте розділ "ЩО ТРЕБА ПЕРЕВІРИТИ" внизу
// файлу. Автентифікацію (крок 1) я підтвердив по офіційній документації
// Rozetka. Але сам ендпоінт списку товарів (крок 2) Rozetka показує лише
// всередині інтерактивної документації (https://api-seller.rozetka.com.ua/apidoc/),
// яка рендериться через JS і я не зміг її "прочитати" програмно — тому там
// нижче стоїть максимально ймовірний варіант за патерном інших методів API,
// але його треба звірити з документацією вручну, залогінившись у кабінет
// продавця, перш ніж покладатися на автоматичний запуск.

const { getStore } = require('@netlify/blobs');

const ROZETKA_API_BASE = 'https://api-seller.rozetka.com.ua';

// ---------------------------------------------------------------------------
// 1. Автентифікація в Rozetka Seller API
//    Підтверджено документацією: логін + пароль (пароль у base64), токен
//    живе 24 години, далі використовується як Bearer token.
// ---------------------------------------------------------------------------
async function getRozetkaToken() {
  const login = process.env.ROZETKA_LOGIN;
  const password = process.env.ROZETKA_PASSWORD;
  if (!login || !password) {
    throw new Error('Не задано ROZETKA_LOGIN / ROZETKA_PASSWORD у змінних середовища Netlify');
  }

  // TODO: перевірте точний шлях ендпоінта авторизації в апі-доці
  // (розділ "Authorization" → "PostSites" або аналогічний).
  const res = await fetch(`${ROZETKA_API_BASE}/sites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      login,
      password: Buffer.from(password, 'utf8').toString('base64'),
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Rozetka auth failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  // TODO: перевірте реальну назву поля з токеном у відповіді (тут — здогад).
  const token = data.token || data.access_token || (data.content && data.content.token);
  if (!token) {
    throw new Error('Rozetka auth: токен не знайдено у відповіді: ' + JSON.stringify(data));
  }
  return token;
}

// ---------------------------------------------------------------------------
// 2. Отримання списку товарів продавця
//    ⚠️ Ендпоінт нижче НЕ підтверджений напряму — звірте з
//    https://api-seller.rozetka.com.ua/apidoc/ (розділ "Items"), увійшовши
//    у ваш кабінет продавця. Судячи з інших відомих методів (наприклад,
//    /items/{id} для одного товару, /items-commissions/search для комісій),
//    список товарів імовірно віддається через /items/search або /items
//    з пагінацією (page / page_size чи offset / limit).
// ---------------------------------------------------------------------------
async function fetchAllRozetkaItems(token) {
  const items = [];
  let page = 1;
  const pageSize = 100;

  while (true) {
    const res = await fetch(
      `${ROZETKA_API_BASE}/items/search?page=${page}&page_size=${pageSize}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Rozetka items fetch failed: ${res.status} ${text}`);
    }
    const data = await res.json();
    // TODO: перевірте реальну структуру відповіді — тут здогад про поле "content".
    const batch = data.content || data.items || data.data || [];
    items.push(...batch);

    if (batch.length < pageSize) break; // остання сторінка
    page += 1;
    if (page > 200) break; // запобіжник від нескінченного циклу
  }

  return items;
}

// ---------------------------------------------------------------------------
// 3. Перетворення товару Rozetka у формат вашого сайту
//    Поля нижче (name / price / stock / images / description / category /
//    vendor) — типові назви для такого роду API, але ЗВІРТЕ з реальною
//    відповіддю /items/{id}, яку легко подивитись вручну (є приклад запиту
//    в документації: GET /items/{id}).
// ---------------------------------------------------------------------------
function mapRozetkaItemToProduct(item, existingById) {
  const id = item.id || item.item_id;
  const existing = existingById.get(id);

  return {
    id,
    name: item.name || item.title || (existing && existing.name) || '',
    price: Number(item.price) || 0,
    cur: 'UAH',
    // Категорію/групу Rozetka називає інакше, ніж ваш сайт (Павербанки/
    // Адаптери/Кабелі) — тут просто переносимо назву категорії Rozetka.
    // Якщо потрібне точне узгодження з існуючими 3 категоріями сайту,
    // варто зробити ручну карту відповідності category_id → cat/group.
    cat: item.category_name || (existing && existing.cat) || '',
    group: item.group_name || (existing && existing.group) || '',
    img: (Array.isArray(item.images) && item.images[0]) || item.image || (existing && existing.img) || '',
    available: item.stock > 0 || item.is_available === true,
    spec: item.description || (existing && existing.spec) || '',
    brand: item.vendor || item.brand || (existing && existing.brand) || '',
  };
}

// ---------------------------------------------------------------------------
// 4. Запис у Netlify Blobs (той самий стор, що читає build.py / catalog.js)
// ---------------------------------------------------------------------------
function getCatalogStore() {
  const siteID = process.env.BLOBS_SITE_ID;
  const token = process.env.BLOBS_TOKEN;
  const opts = { name: 'catalog', consistency: 'strong' };
  if (siteID && token) {
    opts.siteID = siteID;
    opts.token = token;
  }
  return getStore(opts);
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

// ---------------------------------------------------------------------------
// Головна функція
// ---------------------------------------------------------------------------
exports.handler = async () => {
  try {
    const store = getCatalogStore();

    // Читаємо поточні товари сайту, щоб не втратити поля, яких немає в Rozetka
    // (наприклад, розлогий "spec"-опис, якщо на Rozetka він коротший).
    const currentRec = await store.get('products', { type: 'json' });
    const currentProducts = (currentRec && currentRec.data) || [];
    const existingById = new Map(currentProducts.map((p) => [p.id, p]));

    const token = await getRozetkaToken();
    const rozetkaItems = await fetchAllRozetkaItems(token);

    const merged = rozetkaItems.map((item) => mapRozetkaItemToProduct(item, existingById));

    await store.setJSON('products', { data: merged, updatedAt: new Date().toISOString() });
    const published = await triggerBuild();

    console.log(`Rozetka sync: оновлено ${merged.length} товарів, build запущено: ${published}`);

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, count: merged.length, published }),
    };
  } catch (err) {
    console.error('Rozetka sync error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: String((err && err.message) || err) }),
    };
  }
};

// Автоматичний запуск за розкладом (Netlify Scheduled Functions).
// Приклад: щогодини. Синтаксис — звичайний cron.
exports.config = {
  schedule: '0 * * * *',
};

// =================================================================================
// ЩО ТРЕБА ПЕРЕВІРИТИ / НАЛАШТУВАТИ ПЕРЕД ЗАПУСКОМ
// =================================================================================
//
// 1. Покладіть цей файл у netlify/functions/rozetka-sync.js вашого репозиторію.
//
// 2. У Netlify -> Site settings -> Environment variables додайте:
//    - ROZETKA_LOGIN        — логін від кабінету продавця Rozetka
//    - ROZETKA_PASSWORD     — пароль від кабінету продавця Rozetka
//    - BLOBS_SITE_ID        — той самий, що вже використовує catalog.js
//    - BLOBS_TOKEN          — той самий, що вже використовує catalog.js
//    - BUILD_HOOK_URL       — той самий, що вже використовує catalog.js
//
// 3. Обов'язково звірте з живою документацією https://api-seller.rozetka.com.ua/apidoc/
//    (потрібен вхід у кабінет продавця, документація рендериться через JS,
//    тому я не зміг прочитати її автоматично):
//    - Точний шлях і назву полів для авторизації (крок 1: getRozetkaToken).
//    - Точний ендпоінт для отримання СПИСКУ товарів, не одного товару
//      (крок 2: fetchAllRozetkaItems) — можливо, це /items/search,
//      /items/list, або щось інше з пагінацією.
//    - Точні назви полів товару у відповіді (крок 3: mapRozetkaItemToProduct) —
//      назва, ціна, залишок, фото, опис, категорія, бренд.
//
// 4. Після виправлення TODO — задеплойте і перевірте вручну, викликавши функцію
//    напряму (наприклад, через Netlify CLI: netlify functions:invoke rozetka-sync),
//    перш ніж покладатись на розклад.
//
// 5. Розклад '0 * * * *' (у exports.config вище) = щогодини. Можна рідше,
//    наприклад раз на 6 годин, якщо оновлення цін/наявності не потребує
//    великої частоти — подивіться синтаксис cron-виразів для потрібного вам
//    інтервалу.
// =================================================================================
