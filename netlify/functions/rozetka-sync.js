// netlify/functions/rozetka-sync.js
//
// Запускається кнопкою «Синхронізувати з Rozetka» в адмінці (POST-запит із
// дійсною сесією адміна). Забирає токен, збережений через
// netlify/functions/rozetka-settings.js, тягне товари з Rozetka Seller API
// (items/search) і оновлює каталог сайту (той самий Netlify Blobs store,
// який читає build.py / catalog.js), після чого запускає пересборку сайту.
//
// Ендпоінт і формат відповіді звірено з офіційною специфікацією
// "ROZETKA Marketplace API" (розділ 6. Products — 6.3 Products search).
// Токен береться з Кабінету продавця (Налаштування → Безпека API →
// Згенерувати API токен) і використовується напряму як Bearer.

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
  // ньому лишився прихований символ (перенос рядка, пробіл, zero-width
  // space, BOM тощо), заголовок Authorization все одно сформується
  // коректно — лишаємо тільки видимі ASCII-символи (0x21–0x7E).
  const token = String(raw).replace(/[^\x21-\x7E]+/g, '');
  if (!token) {
    throw new Error('Збережений токен виявився порожнім після очищення — збережіть токен наново.');
  }
  return token;
}

// ---------------------------------------------------------------------------
// Отримання списку товарів продавця: GET /items/search, з пагінацією за
// _meta.pageCount (сервер сам вирішує, скільки товарів на сторінці — це не
// параметр запиту). item_active=1 — тягнемо лише активні (опубліковані)
// товари, а не заблоковані/на модерації. expand додає опис і промо-ціну,
// які інакше API не повертає.
// ---------------------------------------------------------------------------
async function fetchAllRozetkaItems(token) {
  const items = [];
  let page = 1;
  const MAX_PAGES = 1000; // запобіжник від нескінченного циклу

  while (true) {
    let res;
    try {
      res = await fetch(
        `${ROZETKA_API_BASE}/items/search?item_active=1&expand=description,description_ua,price_promo,group_item&page=${page}`,
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
    if (data.success === false) {
      const msg = (data.errors && (data.errors.description || data.errors.message)) || 'Rozetka повернула помилку';
      throw new Error(`[items:api] ${msg}`);
    }

    const content = data.content || {};
    const batch = Array.isArray(content.items) ? content.items : [];
    items.push(...batch);

    const pageCount = Number(content._meta && content._meta.pageCount) || 0;
    if (batch.length === 0 || page >= pageCount) break;
    page += 1;
    if (page > MAX_PAGES) break;
  }

  return items;
}

// ---------------------------------------------------------------------------
// Перетворення товару Rozetka (Item Object Model з items/search) у формат
// каталогу сайту.
// ---------------------------------------------------------------------------
function mapRozetkaItemToProduct(item, existingById) {
  const id = item.id;
  const existing = existingById.get(id);

  const regularPrice = Number(item.price) || 0;
  const promoPrice = Number(item.price_promo) || 0;
  const hasPromo = promoPrice > 0 && promoPrice < regularPrice;

  const photos = Array.isArray(item.photo) ? item.photo.filter(Boolean) : [];
  const images = photos.length ? photos : (item.photo_preview ? [item.photo_preview] : []);

  const groupTitle = item.group_item && (item.group_item.title_ua || item.group_item.title);
  const catName = (item.catalog_category && item.catalog_category.name) || '';

  return {
    id,
    name: item.name_ua || item.name || (existing && existing.name) || '',
    price: hasPromo ? promoPrice : regularPrice,
    oldPrice: hasPromo ? regularPrice : undefined,
    cur: 'UAH',
    cat: catName || (existing && existing.cat) || '',
    group: groupTitle || (existing && existing.group) || '',
    img: images[0] || (existing && existing.img) || '',
    images,
    available: Number(item.stock_quantity) > 0,
    spec: item.description_ua || item.description || (existing && existing.spec) || '',
    // Rozetka Seller API не повертає бренд/виробника окремим полем у
    // items/search — лишаємо те, що вже було збережено на сайті для цього ID.
    brand: (existing && existing.brand) || '',
    // "Топ продажів" на головній — це ручна відмітка в адмінці, Rozetka
    // такого поля не має, тож лишаємо те, що вже було збережено для цього ID.
    topSale: !!(existing && existing.topSale),
    topOrder: existing && existing.topOrder,
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
    const categoryMetaByName = new Map(
      currentCategories.map((c, idx) => [c.name, { icon: c.icon, hidden: !!c.hidden, order: idx }])
    );

    const token = await getSavedRozetkaToken();
    const rozetkaItems = await fetchAllRozetkaItems(token);
    const merged = rozetkaItems.map((item) => mapRozetkaItemToProduct(item, existingById));

    // Категорії повністю перебудовуються зі списку товарів Rozetka — це і
    // прибирає дублікати/застарілі категорії, яких уже немає серед товарів.
    // Іконку, ознаку "приховати" й порядок показу лишаємо ті самі, що вже
    // були налаштовані в адмінці для категорії з такою назвою — Rozetka цих
    // даних не надає, і без цього кожна синхронізація стирала б ручне
    // налаштування. Нові категорії (яких ще не було на сайті) дописуються в
    // кінець, у порядку першої появи серед товарів.
    const seenCategoryNames = [];
    for (const p of merged) {
      if (p.cat && !seenCategoryNames.includes(p.cat)) seenCategoryNames.push(p.cat);
    }
    const categories = seenCategoryNames
      .map((name, seenIndex) => {
        const meta = categoryMetaByName.get(name);
        return {
          name,
          icon: (meta && meta.icon) || '📦',
          hidden: !!(meta && meta.hidden),
          order: meta ? meta.order : currentCategories.length + seenIndex,
        };
      })
      .sort((a, b) => a.order - b.order)
      .map(({ order, ...rest }) => rest);

    // Повна заміна (не додавання) — товари й категорії, яких немає в
    // поточному вивантаженні з Rozetka, зі списку зникають, щоб уникнути
    // дублікатів.
    await catalogStore.setJSON('products', { data: merged, updatedAt: new Date().toISOString() });
    await catalogStore.setJSON('categories', { data: categories, updatedAt: new Date().toISOString() });

    // Записуємо час останньої синхронізації, щоб показати в адмінці.
    const settingsStore = getSettingsStore();
    const tokenRec = await settingsStore.get('rozetkaToken', { type: 'json' });
    await settingsStore.setJSON('rozetkaToken', {
      data: {
        ...(tokenRec && tokenRec.data),
        lastSyncAt: new Date().toISOString(),
        lastSyncCount: merged.length,
      },
      updatedAt: new Date().toISOString(),
    });

    const published = await triggerBuild();

    return json(200, { ok: true, count: merged.length, categoryCount: categories.length, published });
  } catch (err) {
    return json(500, { error: String((err && err.message) || err) });
  }
};
