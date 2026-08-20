// netlify/functions/rozetka-sync.js
//
// Запускається кнопкою «Синхронізувати з Rozetka» в адмінці (POST-запит із
// дійсною сесією адміна). Забирає токен, збережений через
// netlify/functions/rozetka-settings.js, тягне товари з Rozetka Marketplace
// API і оновлює каталог сайту (той самий Netlify Blobs store, який читає
// build.py / catalog.js), після чого запускає пересборку сайту.
//
// ‼️ ЩО ТРЕБА ЗВІРИТИ ПЕРЕД ПЕРШИМ ЗАПУСКОМ (позначено TODO нижче):
// сам ендпоінт для отримання СПИСКУ товарів і точні назви полів у відповіді.
// Токен уже готовий (Безпека API → Згенерувати API токен), автентифікація
// через логін/пароль тут більше не потрібна — токен використовується
// напряму як Bearer.

const { getStore } = require('@netlify/blobs');
const { isSessionValid } = require('./lib/session');

const ROZETKA_API_BASE = 'https://api-seller.rozetka.com.ua';

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

async function getSavedRozetkaToken() {
  const store = getSettingsStore();
  const rec = await store.get('rozetkaToken', { type: 'json' });
  const raw = rec && rec.data && rec.data.token;
  if (!raw) {
    throw new Error('Токен Rozetka не збережено — вставте його на вкладці «Rozetka» в адмінці й натисніть «Зберегти».');
  }
  // Захисне очищення: навіть якщо токен зберігли до цього виправлення і в
  // ньому лишився прихований символ (переніс рядка, пробіл), заголовок
  // Authorization все одно сформується коректно.
  const token = String(raw).replace(/[\s\u0000-\u001F\u007F]+/g, '');
  if (!token) {
    throw new Error('Збережений токен виявився порожнім після очищення — збережіть токен наново.');
  }
  return token;
}

// ---------------------------------------------------------------------------
// Отримання списку товарів продавця
// ⚠️ Ендпоінт нижче НЕ підтверджений напряму з документацією (вона рендериться
// через JS і вимагає входу в кабінет продавця). Звірте з
// https://api-seller.rozetka.com.ua/apidoc/ (розділ "Items") точний шлях і
// параметри пагінації, якщо цей варіант поверне помилку.
// ---------------------------------------------------------------------------
async function fetchAllRozetkaItems(token) {
  const items = [];
  let page = 1;
  const pageSize = 100;

  while (true) {
    let res;
    try {
      res = await fetch(
        `${ROZETKA_API_BASE}/items/search?page=${page}&page_size=${pageSize}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
    } catch (e) {
      // Помилки на цьому рівні (напр. "The string did not match the
      // expected pattern") означають проблему з САМИМ запитом — найчастіше
      // невалідний символ у токені або неправильний URL/шлях ендпоінта.
      throw new Error(`[items:request] Не вдалось виконати запит до Rozetka (сторінка ${page}): ${(e && e.message) || e}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`[items:response ${res.status}] ${text || 'Rozetka повернула помилку без тексту'}`);
    }
    let data;
    try {
      data = await res.json();
    } catch (e) {
      throw new Error(`[items:parse] Відповідь Rozetka не є коректним JSON: ${(e && e.message) || e}`);
    }
    // TODO: перевірте реальну назву поля-масиву у відповіді (тут — здогад).
    const batch = data.content || data.items || data.data || [];
    items.push(...batch);

    if (batch.length < pageSize) break;
    page += 1;
    if (page > 200) break; // запобіжник
  }

  return items;
}

// ---------------------------------------------------------------------------
// Перетворення товару Rozetka у формат вашого сайту.
// TODO: звірте реальні назви полів item.* з фактичною відповіддю API.
// ---------------------------------------------------------------------------
function mapRozetkaItemToProduct(item, existingById) {
  const id = item.id || item.item_id;
  const existing = existingById.get(id);

  return {
    id,
    name: item.name || item.title || (existing && existing.name) || '',
    price: Number(item.price) || 0,
    cur: 'UAH',
    cat: item.category_name || (existing && existing.cat) || '',
    group: item.group_name || (existing && existing.group) || '',
    img: (Array.isArray(item.images) && item.images[0]) || item.image || (existing && existing.img) || '',
    available: item.stock > 0 || item.is_available === true,
    spec: item.description || (existing && existing.spec) || '',
    brand: item.vendor || item.brand || (existing && existing.brand) || '',
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
    // Ручний запуск — тільки з адмінки, тільки з дійсною сесією.
    if (event.httpMethod !== 'POST') {
      return json(405, { error: 'Метод не підтримується' });
    }
    if (!isSessionValid(event)) {
      return json(401, { error: 'Сесія недійсна або закінчилась — увійдіть в адмінку знову' });
    }

    const catalogStore = getCatalogStore();
    const currentRec = await catalogStore.get('products', { type: 'json' });
    const currentProducts = (currentRec && currentRec.data) || [];
    const existingById = new Map(currentProducts.map((p) => [p.id, p]));

    const currentCategoriesRec = await catalogStore.get('categories', { type: 'json' });
    const currentCategories = (currentCategoriesRec && currentCategoriesRec.data) || [];
    const iconByName = new Map(currentCategories.map((c) => [c.name, c.icon]));

    const token = await getSavedRozetkaToken();
    const rozetkaItems = await fetchAllRozetkaItems(token);
    const merged = rozetkaItems.map((item) => mapRozetkaItemToProduct(item, existingById));

    // Категорії повністю перебудовуються зі списку товарів Rozetka — це і
    // прибирає дублікати/застарілі категорії, яких уже немає серед товарів.
    // Порядок з'яви — за першим входженням у список товарів. Іконку лишаємо
    // ту саму, якщо категорія з такою назвою вже існувала на сайті, інакше —
    // нейтральна іконка за замовчуванням.
    const seenCategoryNames = [];
    for (const p of merged) {
      if (p.cat && !seenCategoryNames.includes(p.cat)) seenCategoryNames.push(p.cat);
    }
    const categories = seenCategoryNames.map((name) => ({
      name,
      icon: iconByName.get(name) || '📦',
    }));

    // Повна заміна (не додавання) — товари й категорії, яких немає в
    // поточному вивантаженні з Rozetka, зі списку зникають, щоб уникнути
    // дублікатів.
    await catalogStore.setJSON('products', { data: merged, updatedAt: new Date().toISOString() });
    await catalogStore.setJSON('categories', { data: categories, updatedAt: new Date().toISOString() });

    // Записуємо час останньої синхронізації, щоб показати в адмінці.
    const settingsStore = getSettingsStore();
    const tokenRec = await settingsStore.get('rozetkaToken', { type: 'json' });
    await settingsStore.setJSON('rozetkaToken', {
      ...(tokenRec && tokenRec.data),
      lastSyncAt: new Date().toISOString(),
      lastSyncCount: merged.length,
    });

    const published = await triggerBuild();

    return json(200, { ok: true, count: merged.length, categoryCount: categories.length, published });
  } catch (err) {
    return json(500, { error: String((err && err.message) || err) });
  }
};
