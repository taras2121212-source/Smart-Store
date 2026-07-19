// netlify/functions/merchant-feed.js
// Динамічно генерує Google Merchant Center XML-фід з АКТУАЛЬНИХ даних каталогу
// (ті самі дані, що редагуються в адмінці й лежать у Netlify Blobs — див.
// netlify/functions/catalog.js). Якщо в Blobs ще нічого не опубліковано,
// підстраховуємось локальним products.json з репозиторію.
//
// Доступний за адресою https://smartstoreua.com/google-merchant-feed.xml
// (редірект налаштований у netlify.toml) — саме це посилання і вставляється
// в Google Merchant Center один раз, назавжди.

const { getStore } = require('@netlify/blobs');
const fs = require('fs');
const path = require('path');

const SITE_URL = 'https://smartstoreua.com';

const UA_MAP = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'h', 'ґ': 'g', 'д': 'd', 'е': 'e', 'є': 'ie',
  'ж': 'zh', 'з': 'z', 'и': 'y', 'і': 'i', 'ї': 'i', 'й': 'i', 'к': 'k', 'л': 'l',
  'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
  'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ь': '',
  'ю': 'iu', 'я': 'ia',
};

// Мапа внутрішньої категорії на таксономію Google.
// Якщо в адмінці зʼявиться нова категорія, додайте її сюди.
const GOOGLE_CATEGORY = {
  'Павербанки': 'Electronics > Electronics Accessories > Power > Batteries & Chargers > Portable Batteries & Power Packs',
  'Адаптери': 'Electronics > Electronics Accessories > Power > Adapters & Chargers',
  'Кабелі': 'Electronics > Electronics Accessories > Cables',
};
const DEFAULT_GOOGLE_CATEGORY = 'Electronics > Electronics Accessories';

function slugify(s) {
  s = String(s || '').toLowerCase();
  s = s.split('').map((ch) => (ch in UA_MAP ? UA_MAP[ch] : ch)).join('');
  s = s.replace(/[^a-z0-9]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
  return (s || 'item').slice(0, 80);
}

function xmlEscape(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
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

function loadFallbackProducts() {
  try {
    const p = path.join(__dirname, '..', '..', 'products.json');
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return [];
  }
}

async function loadProducts() {
  try {
    const store = getCatalogStore();
    const rec = await store.get('products', { type: 'json' });
    if (rec && rec.data && rec.data.length) return rec.data;
  } catch (e) {
    // ігноруємо — підемо на фолбек нижче
  }
  return loadFallbackProducts();
}

function productLink(p) {
  return `${SITE_URL}/product/${p.id}-${slugify(p.name)}.html`;
}

// Google не вміє забирати base64-картинки (data:image/...) — йому потрібне
// публічне посилання. Якщо фото товару ще не завантажене як звичайний URL,
// підставляємо логотип, щоб фід лишався валідним, і товар не "випав" з нього.
function imageLink(p) {
  const img = p.img || '';
  if (img.startsWith('http://') || img.startsWith('https://')) return img;
  return `${SITE_URL}/logo.jpg`;
}

function itemXml(p) {
  const price = `${p.price} ${p.cur || 'UAH'}`;
  const oldPrice = p.oldPrice || p.old_price;
  const hasSale = oldPrice && Number(oldPrice) > Number(p.price);
  const salePriceTag = hasSale
    ? `\n      <g:sale_price>${p.price} ${p.cur || 'UAH'}</g:sale_price>`
    : '';
  const priceTag = hasSale ? `${oldPrice} ${p.cur || 'UAH'}` : price;
  const category = GOOGLE_CATEGORY[p.cat] || DEFAULT_GOOGLE_CATEGORY;

  return `
    <item>
      <g:id>${p.id}</g:id>
      <title>${xmlEscape(p.name)}</title>
      <description>${xmlEscape(p.spec || p.name)}</description>
      <link>${productLink(p)}</link>
      <g:image_link>${xmlEscape(imageLink(p))}</g:image_link>
      <g:availability>${p.available ? 'in stock' : 'out of stock'}</g:availability>
      <g:price>${priceTag}</g:price>${salePriceTag}
      <g:brand>${xmlEscape(p.brand || '')}</g:brand>
      <g:condition>new</g:condition>
      <g:google_product_category>${xmlEscape(category)}</g:google_product_category>
      <g:identifier_exists>no</g:identifier_exists>
    </item>`;
}

exports.handler = async () => {
  const products = await loadProducts();
  const items = products.map(itemXml).join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">
  <channel>
    <title>SmartStore UA - Product Feed</title>
    <link>${SITE_URL}/</link>
    <description>Product data feed for Google Merchant Center</description>${items}
  </channel>
</rss>`;

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
    body: xml,
  };
};
