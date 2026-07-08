#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Генерує окремі HTML-сторінки для кожного товару (product/) та кожної категорії (category/),
а також sitemap.xml і robots.txt — для запуску реклами Google (Search / Shopping / PMax)
з унікальними посадковими сторінками на кожен товар і розділ каталогу.

Запуск: python3 build.py
Вхід:   products.json (в цій же папці)
Вихід:  product/*.html, category/*.html, sitemap.xml, robots.txt
"""
import json
import os
import re
import html

SITE_URL = "https://smartstoreua.com"

CAT_ICONS = {
    "Чохли iPhone": "📱", "Чохли iPad": "📲", "Чохли AirPods": "🎧", "Ремінці Apple Watch": "⌚",
    "Захисне скло": "🛡️", "Кабелі": "🔌", "Адаптери": "⚡", "Павербанки": "🔋",
    "Навушники": "🎧", "Бездротова зарядка": "🔋", "Автоаксесуари": "🚗", "Інше": "📦",
}

UA_MAP = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'h', 'ґ': 'g', 'д': 'd', 'е': 'e', 'є': 'ie',
    'ж': 'zh', 'з': 'z', 'и': 'y', 'і': 'i', 'ї': 'i', 'й': 'i', 'к': 'k', 'л': 'l',
    'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
    'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ь': '',
    'ю': 'iu', 'я': 'ia',
}


def slugify(s: str) -> str:
    s = (s or "").lower()
    s = "".join(UA_MAP.get(ch, ch) for ch in s)
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"-{2,}", "-", s).strip("-")
    return s[:80] or "item"


def esc(s):
    return html.escape(s or "", quote=True)


def fmt_price(n):
    return f"{n:,}".replace(",", " ") + " ₴"


def load_products():
    with open("products.json", encoding="utf-8") as f:
        data = json.load(f)
    return data


def category_counts(products):
    counts = {}
    for p in products:
        counts[p["cat"]] = counts.get(p["cat"], 0) + 1
    return counts


HEAD_FONTS = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
    '<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700'
    '&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">'
)

HEADER_HTML = """<header>
  <div class="logo"><a href="{root}index.html" style="display:flex;align-items:center;gap:10px;"><img src="{root}logo.jpg" alt="SMART STORE логотип">SMART STORE</a></div>
  <nav class="links">
    <a href="{root}index.html#categories">Категорії</a>
    <a href="{root}index.html#products">Товари</a>
    <a href="{root}index.html#why">Чому ми</a>
    <a href="{root}index.html#contacts">Контакти</a>
  </nav>
  <div class="header-actions">
    <div class="cart-btn" role="button" tabindex="0" onclick="location.href='{root}index.html#cart'" onkeydown="if(event.key==='Enter')location.href='{root}index.html#cart'">Кошик <span class="cart-count" id="cartCount">0</span></div>
    <button class="burger" aria-label="Меню" onclick="toggleMobileNav()"><span></span></button>
  </div>
</header>
<div class="mobile-nav" id="mobileNav">
  <div class="panel">
    <a href="{root}index.html#categories" onclick="toggleMobileNav()">Категорії</a>
    <a href="{root}index.html#products" onclick="toggleMobileNav()">Товари</a>
    <a href="{root}index.html#why" onclick="toggleMobileNav()">Чому ми</a>
    <a href="{root}index.html#contacts" onclick="toggleMobileNav()">Контакти</a>
  </div>
</div>"""

FOOTER_HTML = """<footer>
  <div class="logo"><img src="{root}logo.jpg" alt="SMART STORE логотип">SMART STORE</div>
  <div class="cols">
    <div>
      <h4>Каталог</h4>
      {cat_links}
    </div>
    <div>
      <h4>Компанія</h4>
      <a href="{root}index.html#why">Про нас</a>
      <a href="{root}index.html#contacts">Контакти</a>
    </div>
    <div>
      <h4>Контакти</h4>
      <a href="tel:+380739435741">+380 73 943 57 41</a>
      <a href="mailto:taraskabala4@gmail.com">taraskabala4@gmail.com</a>
      <a href="javascript:void(0)">Telegram / Instagram</a>
    </div>
  </div>
</footer>"""

CART_BADGE_JS = """
<script>
  (function(){
    function cartCount(){
      try{
        var c = JSON.parse(localStorage.getItem('smartstore_cart') || '{}');
        return Object.values(c).reduce(function(a,b){ return a + b; }, 0);
      }catch(e){ return 0; }
    }
    document.addEventListener('DOMContentLoaded', function(){
      var el = document.getElementById('cartCount');
      if(el) el.textContent = cartCount();
    });
  })();
  function toggleMobileNav(){
    var m = document.getElementById('mobileNav');
    if(m) m.classList.toggle('open');
  }
  document.addEventListener('click', function(e){
    var m = document.getElementById('mobileNav');
    if(m && m.classList.contains('open') && e.target.id === 'mobileNav') m.classList.remove('open');
  });
  window.addEventListener('scroll', function(){
    var h = document.documentElement;
    var pct = Math.min(100, Math.round((h.scrollTop) / (h.scrollHeight - h.clientHeight) * 100)) || 0;
    var fill = document.getElementById('batteryFill');
    if(fill) fill.style.width = pct + '%';
  });
</script>"""

TOAST_HTML = '<div class="toast" id="pageToast"></div>'
TOAST_JS = """
<script>
  function pageAddToCart(id){
    try{
      var c = JSON.parse(localStorage.getItem('smartstore_cart') || '{}');
      c[id] = (c[id] || 0) + 1;
      localStorage.setItem('smartstore_cart', JSON.stringify(c));
      var el = document.getElementById('cartCount');
      if(el) el.textContent = Object.values(c).reduce(function(a,b){ return a+b; }, 0);
      var t = document.getElementById('pageToast');
      if(t){ t.textContent = 'Додано в кошик'; t.classList.add('show'); setTimeout(function(){ t.classList.remove('show'); }, 1800); }
    }catch(e){}
  }
  function pageBuyNow(id){
    pageAddToCart(id);
    location.href = '__ROOT__index.html?add=' + id + '#cart';
  }
</script>"""


def category_slug_map(counts):
    return {cat: slugify(cat) for cat in counts}


def render_product_page(p, products, cat_slugs):
    root = "../"
    related = [x for x in products if x["cat"] == p["cat"] and x["id"] != p["id"]][:4]
    in_stock = p.get("available", True)
    models_row = ""
    price_txt = fmt_price(p["price"])
    desc = (p.get("spec") or "").strip()
    meta_desc = (desc[:157] + "…") if len(desc) > 160 else desc
    if not meta_desc:
        meta_desc = f"{p['name']} — купити в SMART STORE. Ціна {price_txt}. Доставка по Україні."
    title = f"{p['name']} — купити за {price_txt} | SMART STORE"
    canonical = f"{SITE_URL}/product/{p['id']}-{slugify(p['name'])}.html"
    cat_link = f'<a href="{root}category/{cat_slugs[p["cat"]]}.html">{esc(p["cat"])}</a>'

    ld = {
        "@context": "https://schema.org/",
        "@type": "Product",
        "name": p["name"],
        "image": [p["img"]],
        "description": desc or p["name"],
        "sku": str(p["id"]),
        "category": p["cat"],
        "offers": {
            "@type": "Offer",
            "url": canonical,
            "priceCurrency": p.get("cur", "UAH"),
            "price": str(p["price"]),
            "availability": "https://schema.org/InStock" if in_stock else "https://schema.org/OutOfStock",
        },
    }
    ld_json = json.dumps(ld, ensure_ascii=False)

    related_html = ""
    if related:
        cards = []
        for r in related:
            r_in = r.get("available", True)
            cards.append(f"""
        <a class="prod-card" href="{r['id']}-{slugify(r['name'])}.html">
          <div class="prod-media">
            <span class="prod-badge {'' if r_in else 'out'}">{'В наявності' if r_in else 'Немає в наявності'}</span>
            <img src="{esc(r['img'])}" alt="{esc(r['name'])}" loading="lazy"
                 onerror="this.style.display='none'; this.parentNode.insertAdjacentHTML('beforeend','<div style=&quot;font-size:40px&quot;>{CAT_ICONS.get(r['cat'],'📦')}</div>')">
          </div>
          <div class="prod-body">
            <div class="prod-cat">{esc(r['cat'])}</div>
            <div class="prod-name">{esc(r['name'])}</div>
            <div class="prod-spec">{esc((r.get('spec') or '')[:90])}</div>
            <div class="prod-foot">
              <div class="prod-price">{fmt_price(r['price'])}</div>
              <button class="add-btn" onclick="event.preventDefault(); event.stopPropagation(); pageAddToCart({r['id']})">Купити +</button>
            </div>
          </div>
        </a>""")
        related_html = f"""
<section class="block" style="padding-top:0;">
  <h2 class="related-head">Схожі товари</h2>
  <div class="prod-grid">{''.join(cards)}</div>
</section>"""

    stock_badge = f'<span class="pdp-badge {"" if in_stock else "out"}">{"В наявності" if in_stock else "Немає в наявності"}</span>'
    stock_note = "" if in_stock else '<div class="pdp-note">Цього товару зараз немає на складі. Додайте в кошик — менеджер уточнить термін надходження після оформлення замовлення.</div>'

    html_out = f"""<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{esc(title)}</title>
<meta name="description" content="{esc(meta_desc)}">
<link rel="canonical" href="{canonical}">
<meta property="og:type" content="product">
<meta property="og:title" content="{esc(p['name'])}">
<meta property="og:description" content="{esc(meta_desc)}">
<meta property="og:image" content="{esc(p['img'])}">
<meta property="og:url" content="{canonical}">
<meta property="product:price:amount" content="{p['price']}">
<meta property="product:price:currency" content="{p.get('cur','UAH')}">
<link rel="icon" type="image/jpeg" href="{root}logo.jpg">
{HEAD_FONTS}
<link rel="stylesheet" href="{root}assets/style.css">
<script type="application/ld+json">{ld_json}</script>
</head>
<body>

<div class="battery-track"><div class="battery-fill" id="batteryFill" style="width:0%"></div></div>

{HEADER_HTML.format(root=root)}

<nav class="crumbs">
  <a href="{root}index.html">Головна</a><span class="sep">/</span>
  {cat_link}<span class="sep">/</span>
  <span class="cur">{esc(p['name'])}</span>
</nav>

<section class="pdp">
  <div class="pdp-media">
    {stock_badge}
    <img src="{esc(p['img'])}" alt="{esc(p['name'])}"
         onerror="this.style.display='none'; this.parentNode.insertAdjacentHTML('beforeend','<div style=&quot;font-size:64px&quot;>{CAT_ICONS.get(p['cat'],'📦')}</div>')">
  </div>
  <div>
    <div class="pdp-cat">{cat_link}</div>
    <h1>{esc(p['name'])}</h1>
    <div class="pdp-meta"><div>Категорія: <b>{esc(p['cat'])}</b></div><div>Артикул: <b>SS-{p['id']}</b></div></div>
    <div class="pdp-price">{price_txt}</div>
    <div class="pdp-spec">{esc(desc) if desc else 'Опис уточнюйте у менеджера.'}</div>
    <div class="pdp-cta">
      <button class="btn btn-primary" onclick="pageBuyNow({p['id']})">Купити зараз</button>
      <button class="btn btn-ghost" onclick="pageAddToCart({p['id']})">Додати в кошик</button>
    </div>
    {stock_note}
    <div class="pdp-trust">
      <div>🚚 Доставка по Україні Новою Поштою — 2–3 дні</div>
      <div>↩️ Повернення протягом 14 днів</div>
      <div>🛡️ Гарантія 12 місяців на техніку</div>
    </div>
  </div>
</section>
{related_html}

{FOOTER_HTML.format(root=root, cat_links=footer_cat_links(root, cat_slugs))}

{TOAST_HTML}
{CART_BADGE_JS}
{TOAST_JS.replace('__ROOT__', root)}
</body>
</html>
"""
    return html_out


def footer_cat_links(root, cat_slugs, limit=None):
    items = list(cat_slugs.items())
    if limit:
        items = items[:limit]
    links = "\n      ".join(f'<a href="{root}category/{slug}.html">{esc(cat)}</a>' for cat, slug in items)
    return links


def render_category_page(cat, products_in_cat, all_counts, cat_slugs):
    root = "../"
    slug = cat_slugs[cat]
    n = len(products_in_cat)
    canonical = f"{SITE_URL}/category/{slug}.html"
    title = f"{cat} купити в Україні — {n} товарів | SMART STORE"
    meta_desc = f"{cat}: {n} товарів в наявності. Оригінальні аксесуари, доставка Новою Поштою по Україні 2-3 дні, гарантія 12 міс. Замовляйте в SMART STORE."

    cat_nav = "\n  ".join(
        f'<a href="{root}category/{s}.html" class="{"active" if c == cat else ""}">{esc(c)} <span class="mono" style="opacity:.6">({all_counts[c]})</span></a>'
        for c, s in cat_slugs.items()
    )

    cards = []
    for r in products_in_cat:
        r_in = r.get("available", True)
        cards.append(f"""
        <a class="prod-card" href="../product/{r['id']}-{slugify(r['name'])}.html">
          <div class="prod-media">
            <span class="prod-badge {'' if r_in else 'out'}">{'В наявності' if r_in else 'Немає в наявності'}</span>
            <img src="{esc(r['img'])}" alt="{esc(r['name'])}" loading="lazy"
                 onerror="this.style.display='none'; this.parentNode.insertAdjacentHTML('beforeend','<div style=&quot;font-size:40px&quot;>{CAT_ICONS.get(r['cat'],'📦')}</div>')">
          </div>
          <div class="prod-body">
            <div class="prod-cat">{esc(r['cat'])}</div>
            <div class="prod-name">{esc(r['name'])}</div>
            <div class="prod-spec">{esc((r.get('spec') or '')[:90])}</div>
            <div class="prod-foot">
              <div class="prod-price">{fmt_price(r['price'])}</div>
              <button class="add-btn" onclick="event.preventDefault(); event.stopPropagation(); pageAddToCart({r['id']})">Купити +</button>
            </div>
          </div>
        </a>""")

    ld = {
        "@context": "https://schema.org/",
        "@type": "CollectionPage",
        "name": title,
        "url": canonical,
        "numberOfItems": n,
    }
    ld_json = json.dumps(ld, ensure_ascii=False)

    html_out = f"""<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{esc(title)}</title>
<meta name="description" content="{esc(meta_desc)}">
<link rel="canonical" href="{canonical}">
<meta property="og:type" content="website">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(meta_desc)}">
<meta property="og:url" content="{canonical}">
<link rel="icon" type="image/jpeg" href="{root}logo.jpg">
{HEAD_FONTS}
<link rel="stylesheet" href="{root}assets/style.css">
<script type="application/ld+json">{ld_json}</script>
</head>
<body>

<div class="battery-track"><div class="battery-fill" id="batteryFill" style="width:0%"></div></div>

{HEADER_HTML.format(root=root)}

<nav class="crumbs">
  <a href="{root}index.html">Головна</a><span class="sep">/</span>
  <span class="cur">{esc(cat)}</span>
</nav>

<section class="cat-hero">
  <div class="eyebrow tag-mono">Каталог · {n} товарів</div>
  <h1>{esc(cat)}</h1>
  <p>Оригінальні аксесуари категорії «{esc(cat)}» з наявністю на складі. Доставка Новою Поштою по всій Україні, оплата при отриманні.</p>
</section>

<div class="cat-links-row">
  {cat_nav}
</div>

<section class="block" style="padding-top:0;">
  <div class="prod-grid">{''.join(cards)}</div>
</section>

{FOOTER_HTML.format(root=root, cat_links=footer_cat_links(root, cat_slugs))}

{TOAST_HTML}
{CART_BADGE_JS}
{TOAST_JS.replace('__ROOT__', root)}
</body>
</html>
"""
    return html_out


def main():
    products = load_products()
    counts = category_counts(products)
    cat_slugs = category_slug_map(counts)

    os.makedirs("product", exist_ok=True)
    os.makedirs("category", exist_ok=True)

    urls = [f"{SITE_URL}/", f"{SITE_URL}/index.html"]

    # product pages
    seen_slugs = set()
    for p in products:
        slug = slugify(p["name"])
        fname = f"{p['id']}-{slug}.html"
        out = render_product_page(p, products, cat_slugs)
        with open(f"product/{fname}", "w", encoding="utf-8") as f:
            f.write(out)
        urls.append(f"{SITE_URL}/product/{fname}")

    # category pages
    for cat, slug in cat_slugs.items():
        items = [p for p in products if p["cat"] == cat]
        out = render_category_page(cat, items, counts, cat_slugs)
        with open(f"category/{slug}.html", "w", encoding="utf-8") as f:
            f.write(out)
        urls.append(f"{SITE_URL}/category/{slug}.html")

    # sitemap.xml
    parts = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for u in urls:
        parts.append(f"  <url><loc>{u}</loc></url>")
    parts.append("</urlset>")
    with open("sitemap.xml", "w", encoding="utf-8") as f:
        f.write("\n".join(parts) + "\n")

    # robots.txt
    with open("robots.txt", "w", encoding="utf-8") as f:
        f.write(f"User-agent: *\nAllow: /\nDisallow: /admin.html\n\nSitemap: {SITE_URL}/sitemap.xml\n")

    print(f"Generated {len(products)} product pages, {len(cat_slugs)} category pages.")
    print("Category slugs:")
    for cat, slug in cat_slugs.items():
        print(f"  {cat} -> {slug}")


if __name__ == "__main__":
    main()
