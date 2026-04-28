'use strict';

/* ======================================================
   Данные меню (до подключения к API)
   ====================================================== */

const MENU_PHOTOS_DIR = 'menu-photos/';
const FALLBACK_IMG    = MENU_PHOTOS_DIR + 'syto_cat.jpg';
const MENU_API_BASE   = 'https://menu.syto-kitchen.workers.dev';

/* ======================================================
   Вспомогательные функции
   ====================================================== */

function escHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/* Map id -> product заполняется после загрузки с API */
window.SYTO_PRODUCTS = new Map();

/* ======================================================
   Карточка товара
   ====================================================== */

function productCardHtml(p) {
  const name      = escHtml(p.name);
  const desc      = escHtml(p.description || '');
  const available = !!p.is_available;

  const priceBlock = p.price
    ? `<div class="product-price-info">
         <span class="product-price">${p.price} ₽</span>
         ${p.price_unit ? `<span class="product-unit">/ ${escHtml(p.price_unit)}</span>` : ''}
       </div>`
    : '<div></div>';

  let nutritionHtml = '';
  if (p.nutrition) {
    const parts = p.nutrition.split(/\s+/);
    if (parts.length === 4) {
      nutritionHtml = `<div class="product-nutrition">
        <span>🔥 ${parts[0]} ккал</span>
        <span>Б ${parts[1]}</span>
        <span>Ж ${parts[2]}</span>
        <span>У ${parts[3]}</span>
      </div>`;
    }
  }

  const availBadge = available
    ? `<span class="avail-badge avail-badge--yes"><span class="avail-dot avail-dot--green"></span>В наличии</span>`
    : `<span class="avail-badge avail-badge--no"><span class="avail-dot avail-dot--red"></span>Нет в наличии</span>`;

  const actionBlock = available
    ? `<button class="btn-add" data-product-id="${p.id}">+ Добавить</button>`
    : '';

  return `
    <article class="product-card">
      <img class="product-img" src="${FALLBACK_IMG}" alt="${name}" loading="lazy"
           onerror="this.onerror=null;this.src='${FALLBACK_IMG}'">
      <div class="product-body">
        <h4 class="product-title">${name}</h4>
        ${desc
          ? `<p class="product-desc">${desc}</p>`
          : `<p class="product-desc" style="opacity:.5">Описание скоро добавим.</p>`}
        ${nutritionHtml}
        <div class="product-footer">
          <div class="product-footer-left">
            ${priceBlock}
            ${availBadge}
          </div>
          ${actionBlock}
        </div>
      </div>
    </article>`;
}

/* ======================================================
   Отрисовка меню
   ====================================================== */

function renderMenu(categories, products) {
  const menuGrid  = document.getElementById('menu-grid');
  const catStrip  = document.getElementById('cat-strip');
  const menuStatus = document.getElementById('menu-status');
  if (!menuGrid) return;

  /* Сортировка */
  const cats = categories.slice().sort((a, b) =>
    (Number(a.display_order ?? 0) - Number(b.display_order ?? 0)) || (a.id - b.id)
  );
  const prods = products.slice().sort((a, b) =>
    (Number(a.display_order ?? 0) - Number(b.display_order ?? 0)) || (a.id - b.id)
  );

  /* Группировка по категориям */
  const byCat = new Map();
  for (const p of prods) {
    if (!p.show_on_site) continue;
    const cid = p.category_id ?? null;
    if (!byCat.has(cid)) byCat.set(cid, []);
    byCat.get(cid).push(p);
  }

  const htmlParts = [];
  const catLinks  = [];

  for (const cat of cats) {
    const list = byCat.get(cat.id);
    if (!list || list.length === 0) continue;
    const anchor = `cat-${cat.id}`;

    htmlParts.push(`
      <div class="menu-category" id="${anchor}">
        <h3 class="category-title">${escHtml(cat.name)}</h3>
        <div class="category-products">
          ${list.map(productCardHtml).join('')}
        </div>
      </div>`);

    catLinks.push({ id: cat.id, name: cat.name, anchor });
  }

  if (htmlParts.length === 0) {
    if (menuStatus) menuStatus.textContent = 'Меню пока пустое.';
    return;
  }

  if (menuStatus) menuStatus.textContent = '';
  menuGrid.innerHTML = htmlParts.join('');

  /* Плашка категорий */
  if (catStrip) {
    catStrip.innerHTML = catLinks.map(c =>
      `<button class="cat-strip-item" data-anchor="${escHtml(c.anchor)}">${escHtml(c.name)}</button>`
    ).join('');

    // Обновляем CSS-переменную высоты стрипа
    requestAnimationFrame(() => {
      document.documentElement.style.setProperty('--strip-h', catStrip.offsetHeight + 'px');
    });

    catStrip.addEventListener('click', e => {
      const btn = e.target.closest('.cat-strip-item');
      if (!btn) return;
      const el = document.getElementById(btn.dataset.anchor);
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    });
  }

  /* Делегирование «Добавить в корзину» */
  menuGrid.addEventListener('click', e => {
    const btn = e.target.closest('.btn-add');
    if (!btn) return;
    const product = window.SYTO_PRODUCTS?.get(Number(btn.dataset.productId));
    if (product && window.Cart) window.Cart.add(product);
  });

  /* Подсветка активной категории при скролле */
  setupCatObserver(catLinks, catStrip);
}

/* ======================================================
   IntersectionObserver для категорий
   ====================================================== */

function setupCatObserver(catLinks, catStrip) {
  if (!catStrip || !window.IntersectionObserver) return;

  const headerH = () =>
    parseInt(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 72;
  const stripH  = () => catStrip.offsetHeight || 46;

  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const anchor = entry.target.id;
      catStrip.querySelectorAll('.cat-strip-item').forEach(btn => {
        const active = btn.dataset.anchor === anchor;
        btn.classList.toggle('active', active);
        if (active) {
          // Скролим только внутри стрипа, не трогаем страницу
          const btnLeft  = btn.offsetLeft;
          const btnRight = btnLeft + btn.offsetWidth;
          const stripScroll = catStrip.scrollLeft;
          const stripWidth  = catStrip.offsetWidth;
          if (btnLeft < stripScroll) {
            catStrip.scrollLeft = btnLeft - 16;
          } else if (btnRight > stripScroll + stripWidth) {
            catStrip.scrollLeft = btnRight - stripWidth + 16;
          }
        }
      });
    }
  }, {
    rootMargin: `-${headerH() + stripH() + 8}px 0px -50% 0px`,
    threshold: 0
  });

  for (const c of catLinks) {
    const el = document.getElementById(c.anchor);
    if (el) observer.observe(el);
  }
}

/* ======================================================
   Инициализация
   ====================================================== */

document.addEventListener('DOMContentLoaded', async () => {
  const menuStatus = document.getElementById('menu-status');

  try {
    const res = await fetch(`${MENU_API_BASE}/api/menu-full`);
    if (!res.ok) throw new Error('server');

    const { categories, products } = await res.json();

    // Добавляем путь к папке с фото
    const prodsWithImg = products.map(p => ({
      ...p,
      photo_url: p.photo_url ? MENU_PHOTOS_DIR + p.photo_url : FALLBACK_IMG,
    }));

    // Заполняем Map для корзины
    window.SYTO_PRODUCTS = new Map(prodsWithImg.map(p => [p.id, p]));

    renderMenu(categories, prodsWithImg);

    // Восстанавливаем состояние корзины на карточках после рендера
    if (window.Cart?.refreshMenuCards) window.Cart.refreshMenuCards();

  } catch (err) {
    console.error('Ошибка загрузки меню:', err);
    if (menuStatus) menuStatus.textContent = 'Не удалось загрузить меню. Попробуйте обновить страницу.';
  }
});
