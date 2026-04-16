'use strict';

/* ======================================================
   Корзина и оформление доставки
   ====================================================== */

const Cart = (function () {

  const STORAGE_KEY = 'syto_cart_v1';
  const CONTACT_KEY = 'syto_contact_v1';
  const WORKER_URL  = 'https://syto-preorder.syto-kitchen.workers.dev'; // тот же воркер, что и предзаказы

  // ---- Настройки доставки ----
  const ORDER_MIN          = 600;   // минимальная сумма заказа, ₽
  const DELIVERY_FREE_FROM = 1500;  // от этой суммы доставка бесплатна, ₽
  const DELIVERY_FEE       = 170;   // стоимость доставки, ₽


  let items      = [];   // [{id, name, price, price_unit, qty}]
  let view       = 'items';  // 'items' | 'checkout'
  let toastTimer = null;
  let contact    = {};   // сохранённые поля формы (в памяти + localStorage)

  /* ---- Хранилище товаров ---- */

  function loadFromStorage() {
    try { items = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch { items = []; }
  }

  function saveToStorage() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }

  /* ---- Хранилище контактных данных ---- */

  function loadContact() {
    try { contact = JSON.parse(localStorage.getItem(CONTACT_KEY) || '{}'); }
    catch { contact = {}; }
  }

  function saveContact(panel) {
    const form = panel.querySelector('#checkout-form');
    if (!form) return;
    contact = {
      name:       form.querySelector('[name="name"]')?.value.trim()     || '',
      phone:      form.querySelector('[name="phone"]')?.value.trim()    || '',
      street:     form.querySelector('[name="street"]')?.value.trim()   || '',
      house:      form.querySelector('[name="house"]')?.value.trim()    || '',
      entrance:   form.querySelector('[name="entrance"]')?.value.trim() || '',
      apt:        form.querySelector('[name="apt"]')?.value.trim()      || '',
      floor:      form.querySelector('[name="floor"]')?.value.trim()    || '',
      time_window: form.querySelector('[name="time_window"]:checked')?.value || '',
      cutlery:     form.querySelector('[name="cutlery"]')?.checked || false,
    };
    localStorage.setItem(CONTACT_KEY, JSON.stringify(contact));
  }

  /* ---- Определение типа товара ---- */

  function isPer100g(item) {
    return String(item.price_unit || '').trim() === '100 г';
  }

  /* ---- Форматирование веса ---- */

  function formatWeight(qty) {
    const g = qty * 100;
    if (g < 1000) return g + ' г';
    if (g % 1000 === 0) return (g / 1000) + ' кг';
    return (g / 1000).toFixed(1).replace('.', '.') + ' кг';
  }

  /* ---- Операции с корзиной ---- */

  function add(product) {
    const existing = items.find(i => i.id === product.id);
    const is100g   = String(product.price_unit || '').trim() === '100 г';
    const defaultQ = is100g ? 2 : 1;   // 200 г по умолчанию для весовых

    if (existing) {
      existing.qty += defaultQ;
    } else {
      items.push({
        id:         product.id,
        name:       product.name,
        price:      product.price || 0,
        price_unit: product.price_unit || '',
        qty:        defaultQ
      });
    }
    saveToStorage();
    updateBadge();
    updateMenuCard(product.id);
  }

  function remove(id) {
    items = items.filter(i => i.id !== id);
    saveToStorage();
    updateBadge();
    updateMenuCard(id);
    if (isPanelOpen()) renderPanel();
  }

  function setQty(id, qty) {
    if (qty <= 0) { remove(id); return; }
    const item = items.find(i => i.id === id);
    if (item) {
      item.qty = qty;
      saveToStorage();
      updateBadge();
      updateMenuCard(id);
      if (isPanelOpen()) renderPanel();
    }
  }

  function getItem(id) { return items.find(i => i.id === id) || null; }

  // Для бейджа — количество уникальных блюд
  function totalItems() { return items.length; }
  function totalPrice() { return items.reduce((s, i) => s + i.price * i.qty, 0); }

  // Стоимость доставки по сумме товаров
  function deliveryCost(subtotal) {
    if (subtotal >= DELIVERY_FREE_FROM) return 0;
    return DELIVERY_FEE;
  }

  /* ---- Бейдж ---- */

  function updateBadge() {
    const badge = document.getElementById('cart-badge');
    if (!badge) return;
    const n = totalItems();
    badge.textContent = n;
    badge.style.display = n > 0 ? 'flex' : 'none';
    updateStickyBar();
  }

  /* ---- Sticky-плашка ---- */

  function updateStickyBar() {
    const bar = document.getElementById('cart-sticky-bar');
    if (!bar) return;
    const subtotal = totalPrice();
    const n = totalItems();
    if (n === 0) {
      bar.classList.remove('visible');
      document.querySelector('main').style.paddingBottom = '';
      return;
    }
    const delivery = deliveryCost(subtotal);
    const deliveryLabel = delivery === 0 ? 'Доставка бесплатна' : `+ ${delivery} ₽ доставка`;
    bar.querySelector('.sticky-bar-total').textContent = `${subtotal} ₽`;
    bar.querySelector('.sticky-bar-delivery').textContent = deliveryLabel;
    bar.classList.add('visible');
    // Резервируем место под плашку чтобы контент не прятался за ней
    requestAnimationFrame(() => {
      document.querySelector('main').style.paddingBottom = bar.offsetHeight + 'px';
    });
  }

  /* ---- Обновление карточки в меню ---- */

  const TRASH_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
    <path d="M10 11v6"/><path d="M14 11v6"/>
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
  </svg>`;

  function minusButtonHtml(productId, isAtMin) {
    if (isAtMin) {
      return `<button class="qty-btn inline-qty-btn inline-qty-btn--delete" data-action="minus" data-id="${productId}" aria-label="Удалить">${TRASH_SVG}</button>`;
    }
    return `<button class="qty-btn inline-qty-btn" data-action="minus" data-id="${productId}">−</button>`;
  }

  function updateMenuCard(productId) {
    const btn = document.querySelector(`.btn-add[data-product-id="${productId}"]`);
    const inlineQty = document.querySelector(`.inline-qty[data-product-id="${productId}"]`);
    const item = getItem(productId);

    if (item) {
      const qtyDisplay = isPer100g(item) ? formatWeight(item.qty) : item.qty;
      const atMin = isPer100g(item) ? item.qty <= 2 : item.qty <= 1;
      if (inlineQty) {
        inlineQty.querySelector('.inline-qty-val').textContent = qtyDisplay;
        const minusBtn = inlineQty.querySelector('[data-action="minus"]');
        if (minusBtn) minusBtn.outerHTML = minusButtonHtml(productId, atMin);
      } else if (btn) {
        const wrap = document.createElement('div');
        wrap.className = 'inline-qty';
        wrap.dataset.productId = productId;
        wrap.innerHTML = `
          ${minusButtonHtml(productId, atMin)}
          <span class="inline-qty-val">${qtyDisplay}</span>
          <button class="qty-btn inline-qty-btn" data-action="plus" data-id="${productId}">+</button>`;
        btn.replaceWith(wrap);
      }
    } else {
      if (inlineQty) {
        const addBtn = document.createElement('button');
        addBtn.className = 'btn-add';
        addBtn.dataset.productId = productId;
        addBtn.textContent = '+ Добавить';
        inlineQty.replaceWith(addBtn);
      }
    }
  }

  /* ---- Toast ---- */

  function showToast(text) {
    const el = document.getElementById('cart-toast');
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
  }

  /* ---- Панель ---- */

  function isPanelOpen() {
    return document.getElementById('cart-panel')?.classList.contains('open') ?? false;
  }

  function open() {
    view = 'items';
    renderPanel();
    document.getElementById('cart-panel')?.classList.add('open');
    document.getElementById('cart-overlay')?.classList.add('active');
    document.body.classList.add('cart-open');
    document.getElementById('cart-sticky-bar')?.classList.add('hidden');
  }

  function close() {
    document.getElementById('cart-panel')?.classList.remove('open');
    document.getElementById('cart-overlay')?.classList.remove('active');
    document.body.classList.remove('cart-open');
    document.getElementById('cart-sticky-bar')?.classList.remove('hidden');
  }

  function renderPanel() {
    const panel = document.getElementById('cart-panel');
    if (!panel) return;
    panel.innerHTML = view === 'checkout' ? buildCheckoutHtml() : buildItemsHtml();
    view === 'checkout' ? attachCheckoutHandlers(panel) : attachItemsHandlers(panel);
  }

  /* ======================================================
     Вид «Корзина»
     ====================================================== */

  function buildItemRow(i) {
    const qtyDisplay = isPer100g(i) ? formatWeight(i.qty) : i.qty;
    const priceLabel = i.price
      ? (isPer100g(i) ? `${formatWeight(i.qty)} — ${i.price * i.qty} ₽` : `${i.price * i.qty} ₽`)
      : '';

    return `
      <div class="cart-item-wrap" data-item-id="${i.id}">
        <div class="cart-item">
          <div class="cart-item-info">
            <div class="cart-item-name">${escHtml(i.name)}</div>
            ${!isPer100g(i) && i.price_unit ? `<div class="cart-item-unit">${escHtml(i.price_unit)}</div>` : ''}
            ${priceLabel ? `<div class="cart-item-price">${priceLabel}</div>` : ''}
          </div>
          <div class="cart-item-right">
            <div class="qty-controls">
              <button class="qty-btn" data-action="minus" data-id="${i.id}">−</button>
              <span class="qty-val">${qtyDisplay}</span>
              <button class="qty-btn" data-action="plus"  data-id="${i.id}">+</button>
            </div>
            <button class="cart-item-remove" data-id="${i.id}" aria-label="Удалить">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6"/><path d="M14 11v6"/>
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
          </button>
          </div>
        </div>
        <div class="cart-item-minwarn" id="minwarn-${i.id}">Минимальный заказ этого товара — 200 г</div>
      </div>`;
  }

  function buildItemsHtml() {
    const subtotal  = totalPrice();
    const delivery  = deliveryCost(subtotal);
    const grandTotal = subtotal + delivery;

    const bodyHtml = items.length === 0
      ? `<div class="cart-empty">Корзина пуста.<br>Добавьте блюда из меню.</div>`
      : items.map(buildItemRow).join('');

    let footerHtml = '';
    if (items.length > 0) {
      const deliveryLabel = delivery === 0
        ? `<span class="cart-delivery-free">Бесплатно</span>`
        : `<span>${delivery} ₽</span>`;

      footerHtml = `
        <div class="cart-totals">
          <div class="cart-totals-row">
            <span>Сумма заказа</span><span>${subtotal} ₽</span>
          </div>
          <div class="cart-totals-row">
            <span>Доставка</span>${deliveryLabel}
          </div>
          <div class="cart-totals-row cart-totals-row--total">
            <span>Итого</span><span>${grandTotal} ₽</span>
          </div>
        </div>
        ${subtotal < ORDER_MIN ? `<div class="cart-min-warning">Минимальная сумма заказа — ${ORDER_MIN} ₽</div>` : ''}
        <button class="btn-primary" id="to-checkout-btn"${subtotal < ORDER_MIN ? ' disabled' : ''}>
          Оформить заказ →
        </button>`;
    } else {
      footerHtml = `<button class="btn-primary" id="close-cart-btn"
          style="background:var(--olive-metallic)">Закрыть</button>`;
    }

    return `
      <div class="cart-header">
        <h2>Корзина${items.length > 0 ? ` (${items.length})` : ''}</h2>
        <button class="cart-close-btn" id="close-cart-btn">✕</button>
      </div>
      <div class="cart-body">${bodyHtml}</div>
      <div class="cart-footer">${footerHtml}</div>`;
  }

  function attachItemsHandlers(panel) {
    panel.querySelectorAll('#close-cart-btn').forEach(b => b.addEventListener('click', close));

    panel.querySelector('#to-checkout-btn')?.addEventListener('click', () => {
      view = 'checkout';
      renderPanel();
    });

    // Обычные +/−
    let minWarnTimer = null;
    panel.querySelectorAll('.qty-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id   = Number(btn.dataset.id);
        const item = items.find(i => i.id === id);
        if (!item) return;
        if (btn.dataset.action === 'minus' && isPer100g(item) && item.qty <= 2) {
          const warn = panel.querySelector(`#minwarn-${id}`);
          if (warn) {
            warn.classList.add('show');
            clearTimeout(minWarnTimer);
            minWarnTimer = setTimeout(() => warn.classList.remove('show'), 2500);
          }
          return;
        }
        setQty(id, btn.dataset.action === 'plus' ? item.qty + 1 : item.qty - 1);
      });
    });

    // Удаление позиции
    panel.querySelectorAll('.cart-item-remove').forEach(btn => {
      btn.addEventListener('click', () => remove(Number(btn.dataset.id)));
    });

  }

  /* ======================================================
     Окна доставки
     ====================================================== */

  const DELIVERY_TIME_CHECK = true; // true — фильтровать окна по времени, false — показывать все

  const DELIVERY_WINDOWS = [
    { value: '10:00 – 12:00', label: 'с 10:00 до 12:00', endH: 12, endM: 0 },
    { value: '12:00 – 14:00', label: 'с 12:00 до 14:00', endH: 14, endM: 0 },
    { value: '14:00 – 16:00', label: 'с 14:00 до 16:00', endH: 16, endM: 0 },
    { value: '16:00 – 18:00', label: 'с 16:00 до 18:00', endH: 18, endM: 0 },
    { value: '18:00 – 20:00', label: 'с 18:00 до 20:00', endH: 20, endM: 0 },
  ];

  const ASAP_WINDOW = { value: 'как можно быстрее', label: '⚡ Как можно быстрее' };

  function getAvailableWindows() {
    if (!DELIVERY_TIME_CHECK) return DELIVERY_WINDOWS;
    const now  = new Date();
    const spb  = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
    const mins = spb.getHours() * 60 + spb.getMinutes();
    // Показываем интервал если до его конца ещё больше 90 минут
    return DELIVERY_WINDOWS.filter(w => mins < (w.endH * 60 + w.endM) - 90);
  }

  function buildTimeWindowsHtml() {
    const available   = getAvailableWindows();
    const isTomorrow  = DELIVERY_TIME_CHECK && available.length === 0;
    const windows     = isTomorrow ? DELIVERY_WINDOWS : available;
    const savedWindow = contact.time_window || '';

    if (isTomorrow) {
      const optionsHtml = windows.map((w, idx) => {
        const checked = savedWindow ? w.value === savedWindow : idx === 0;
        return `
        <label class="time-option">
          <input type="radio" name="time_window" value="${escHtml(w.value)}"${checked ? ' checked' : ''} required>
          <span>${escHtml(w.label)}</span>
        </label>`;
      }).join('');
      return `
        <div class="form-group">
          <label>Время доставки *</label>
          <div class="time-window-hint">На сегодня приём заказов завершён — принимаем заказы на завтра.</div>
          <div class="time-options">${optionsHtml}</div>
        </div>`;
    }

    const allOptions  = [ASAP_WINDOW, ...windows];
    const optionsHtml = allOptions.map((w, idx) => {
      const checked = savedWindow ? w.value === savedWindow : idx === 0;
      return `
      <label class="time-option">
        <input type="radio" name="time_window" value="${escHtml(w.value)}"${checked ? ' checked' : ''} required>
        <span>${escHtml(w.label)}</span>
      </label>`;
    }).join('');
    return `
      <div class="form-group">
        <label>Время доставки *</label>
        <div class="time-options">${optionsHtml}</div>
      </div>`;
  }

  /* ======================================================
     Вид «Оформление»
     ====================================================== */

  function formatOrderLine(i) {
    const amount = isPer100g(i) ? formatWeight(i.qty) : `× ${i.qty}`;
    const price  = i.price ? ` — ${i.price * i.qty} ₽` : '';
    return `${i.name} ${amount}${price}`;
  }

  function buildCheckoutHtml() {
    const subtotal   = totalPrice();
    const delivery   = deliveryCost(subtotal);
    const grandTotal = subtotal + delivery;
    const summaryLines = items.map(i => escHtml(formatOrderLine(i))).join('\n');
    const deliveryLine = delivery === 0 ? 'Доставка: Бесплатно' : `Доставка: ${delivery} ₽`;

    return `
      <div class="cart-header">
        <h2>Оформление</h2>
        <button class="cart-close-btn" id="close-cart-btn">✕</button>
      </div>
      <div class="cart-body">
        <button class="btn-back" id="btn-back">← Назад к корзине</button>

        <div class="order-summary">
          <strong>Ваш заказ:</strong>
          <pre style="white-space:pre-wrap;margin:8px 0 0;font-family:inherit;font-size:13px;color:var(--muted)">${summaryLines}</pre>
          <div style="margin-top:8px;font-size:13px;color:var(--muted)">${deliveryLine}</div>
          <div class="order-summary-total">Итого: ${grandTotal} ₽</div>
        </div>

        <form class="checkout-form" id="checkout-form" novalidate>

          <div class="form-group">
            <label for="chk-name">ФИО *</label>
            <input id="chk-name" name="name" type="text" autocomplete="name"
                   required placeholder="Иванов Иван Иванович"
                   value="${escHtml(contact.name || '')}">
          </div>

          <div class="form-group">
            <label for="chk-phone">Телефон *</label>
            <input id="chk-phone" name="phone" type="tel" inputmode="tel"
                   autocomplete="tel" required placeholder="+7 (___) ___-__-__"
                   value="${escHtml(contact.phone || '')}">
          </div>

          <div class="form-group">
            <label for="chk-street">Улица *</label>
            <input id="chk-street" name="street" type="text"
                   autocomplete="street-address" required placeholder="ул. Строителей"
                   value="${escHtml(contact.street || '')}">
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="chk-house">Дом *</label>
              <input id="chk-house" name="house" type="text" required placeholder="16"
                     value="${escHtml(contact.house || '')}">
            </div>
            <div class="form-group">
              <label for="chk-entrance">Подъезд</label>
              <input id="chk-entrance" name="entrance" type="text" placeholder="1"
                     value="${escHtml(contact.entrance || '')}">
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="chk-apt">Квартира *</label>
              <input id="chk-apt" name="apt" type="text" required placeholder="42"
                     value="${escHtml(contact.apt || '')}">
            </div>
            <div class="form-group">
              <label for="chk-floor">Этаж</label>
              <input id="chk-floor" name="floor" type="text" placeholder="5"
                     value="${escHtml(contact.floor || '')}">
            </div>
          </div>

          ${buildTimeWindowsHtml()}

          <!--
          <div class="form-group">
            <label class="pet-option">
              <input type="checkbox" name="pet"${contact.pet ? ' checked' : ''}>
              <span>Питомец составит компанию? 🐾</span>
            </label>
          </div>
          -->

          <div class="form-group">
            <label class="pet-option">
              <input type="checkbox" name="cutlery"${contact.cutlery ? ' checked' : ''}>
              <span>Нужны приборы?</span>
            </label>
          </div>

          <div class="form-group">
            <label for="chk-comment">Комментарий к заказу</label>
            <textarea id="chk-comment" name="comment" rows="3"
                      placeholder="Комментарий или пожелание к заказу..."></textarea>
          </div>

          <div class="payment-note">
            💳 Оплата производится онлайн на сайте.
          </div>

        </form>
      </div>
      <div class="cart-footer">
        <button class="btn-primary" id="submit-order-btn">Отправить заказ</button>
      </div>`;
  }

  function attachCheckoutHandlers(panel) {
    panel.querySelector('#close-cart-btn')?.addEventListener('click', close);
    panel.querySelector('#btn-back')?.addEventListener('click', () => {
      saveContact(panel);
      view = 'items';
      renderPanel();
    });

    const phoneInput = panel.querySelector('#chk-phone');
    if (phoneInput) {
      phoneInput.addEventListener('focus', () => {
        if (!phoneInput.value.trim()) phoneInput.value = '+7 ';
      });
      phoneInput.addEventListener('keydown', e => {
        if (e.key === 'Backspace') {
          e.preventDefault();
          const digits = phoneInput.value.replace(/\D/g, '');
          phoneInput.value = formatPhoneDigits(digits.length > 1 ? digits.slice(0, -1) : '7');
        }
      });
      phoneInput.addEventListener('input', () => applyPhoneMask(phoneInput));
    }

    panel.querySelector('#submit-order-btn')?.addEventListener('click', () => submitOrder(panel));

    // Автодополнение адреса
    if (window.initAddressSuggest) {
      window.initAddressSuggest(
        panel.querySelector('#chk-street'),
        panel.querySelector('#chk-house')
      );
    }
  }

  /* ---- Маска телефона ---- */

  function formatPhoneDigits(digits) {
    let d = digits.replace(/\D/g, '');
    if (d.startsWith('8')) d = '7' + d.slice(1);
    if (!d.startsWith('7')) d = '7' + d;
    d = d.slice(0, 11);
    let r = '+7';
    if (d.length > 1) {
      r += ' (' + d.slice(1, 4);
      if (d.length >= 4) r += ')';
      if (d.length > 4) r += ' ' + d.slice(4, 7);
      if (d.length > 7) r += '-' + d.slice(7, 9);
      if (d.length > 9) r += '-' + d.slice(9, 11);
    }
    return r;
  }

  function applyPhoneMask(input) {
    input.value = formatPhoneDigits(input.value);
  }

  /* ---- Отправка заказа ---- */

  async function submitOrder(panel) {
    const form = panel.querySelector('#checkout-form');
    if (!form) return;

    const name       = form.querySelector('[name="name"]').value.trim();
    const phone      = form.querySelector('[name="phone"]').value.trim();
    const street     = form.querySelector('[name="street"]').value.trim();
    const house      = form.querySelector('[name="house"]').value.trim();
    const entrance   = form.querySelector('[name="entrance"]').value.trim();
    const apt        = form.querySelector('[name="apt"]').value.trim();
    const floor      = form.querySelector('[name="floor"]')?.value.trim() || '';
    const timeWindow = form.querySelector('[name="time_window"]:checked')?.value || '';
    const cutlery    = form.querySelector('[name="cutlery"]')?.checked || false;
    const comment    = form.querySelector('[name="comment"]').value.trim();

    if (!name)                                         { alert('Пожалуйста, укажите ФИО.');                    return; }
    if (!phone || phone.replace(/\D/g,'').length < 11) { alert('Пожалуйста, введите полный номер телефона.');  return; }
    if (!street)                                       { alert('Пожалуйста, укажите улицу.');                  return; }
    if (!house)                                        { alert('Пожалуйста, укажите номер дома.');             return; }
    if (!apt)                                          { alert('Пожалуйста, укажите квартиру.');               return; }
    if (!timeWindow)                                   { alert('Пожалуйста, выберите время доставки.');        return; }

    const address    = `ул. ${street}, д. ${house}${entrance ? ', подъезд ' + entrance : ''}${floor ? ', этаж ' + floor : ''}, кв. ${apt}`;
    const subtotal   = totalPrice();
    const delivery   = deliveryCost(subtotal);
    const grandTotal = subtotal + delivery;

    const submitBtn = panel.querySelector('#submit-order-btn');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Отправляем…'; }

    try {
      const fd = new FormData();
      fd.append('order_type',  'cart');
      fd.append('name',        name);
      fd.append('phone',       phone);
      fd.append('address',     address);
      fd.append('time_window', timeWindow);
      fd.append('items',       items.map(formatOrderLine).join('\n'));
      fd.append('subtotal',    subtotal);
      fd.append('delivery',    delivery === 0 ? 'Бесплатно' : `${delivery} ₽`);
      fd.append('total',       grandTotal);
      fd.append('cutlery',     cutlery ? 'yes' : 'no');
      fd.append('comment',     comment);
      fd.append('return_url',  window.location.origin + window.location.pathname);

      const res  = await fetch(WORKER_URL, { method: 'POST', body: fd });
      const data = await res.json();

      if (res.ok && data.ok) {
        saveContact(panel);
        items = [];
        saveToStorage();
        updateBadge();
        close();
        if (data.qrData) {
          showSbpModal(data.qrData, data.paymentId, data.orderId, data.total);
        } else if (data.paymentUrl) {
          window.location.href = data.paymentUrl;
        }
      } else {
        throw new Error(data.error || 'server');
      }
    } catch {
      alert('Не удалось отправить заказ. Попробуйте ещё раз или позвоните нам:\n+7 (950) 037-13-96');
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Отправить заказ'; }
    }
  }

  /* ---- Утилиты ---- */

  function escHtml(s) {
    return String(s ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  /* ---- Инициализация ---- */

  loadFromStorage();
  loadContact();
  document.addEventListener('DOMContentLoaded', () => {
    updateBadge();

    // Делегирование кликов по inline-кнопкам на карточках меню
    document.addEventListener('click', e => {
      const btn = e.target.closest('.inline-qty-btn');
      if (!btn) return;
      const id   = Number(btn.dataset.id);
      const item = getItem(id);
      if (!item) return;
      if (btn.dataset.action === 'plus') {
        setQty(id, item.qty + 1);
      } else {
        const atMin = isPer100g(item) ? item.qty <= 2 : item.qty <= 1;
        if (atMin) {
          remove(id); // иконка корзины — удаляем
        } else {
          setQty(id, item.qty - 1);
        }
      }
    });

    // Sticky-плашка — открывает корзину
    document.getElementById('cart-sticky-bar')?.addEventListener('click', () => open());
  });

  function refreshMenuCards() {
    for (const item of items) updateMenuCard(item.id);
  }

  // ── СБП модалка ─────────────────────────────────────────────────────────

  function showSbpModal(qrData, paymentId, orderId, total) {
    const isMobile = navigator.maxTouchPoints > 0 || window.innerWidth <= 768;
    const qrSrc    = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(qrData)}`;

    // Spin animation
    if (!document.getElementById('sbp-spin-style')) {
      const s = document.createElement('style');
      s.id = 'sbp-spin-style';
      s.textContent = '@keyframes sbp-spin{to{transform:rotate(360deg)}}';
      document.head.appendChild(s);
    }

    const overlay = document.createElement('div');
    overlay.id = 'sbp-modal';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center;padding:20px';

    overlay.innerHTML = `
      <div style="background:#2a2209;border:1px solid rgba(212,175,55,.3);border-radius:18px;
                  padding:32px 28px;max-width:360px;width:100%;text-align:center">
        <div style="color:#888;font-size:13px;margin-bottom:4px">Заказ ${orderId}</div>
        <div style="color:#d4af37;font-size:26px;font-weight:800;margin-bottom:8px">${total} ₽</div>
        <div style="color:#ccc;font-size:14px;margin-bottom:20px">Оплата через СБП</div>

        ${!isMobile ? `
          <img src="${qrSrc}" width="220" height="220" alt="QR СБП"
               style="display:block;margin:0 auto 12px;border-radius:10px;background:#fff;padding:8px">
          <div style="color:#aaa;font-size:13px;margin-bottom:16px">Отсканируйте QR-код приложением банка</div>
        ` : ''}

        <a id="sbp-open-btn" href="${qrData}"
           style="display:block;background:#00b9f2;color:#fff;border-radius:30px;
                  padding:14px 24px;font-size:15px;font-weight:700;text-decoration:none;margin-bottom:8px">
          Открыть банковское приложение
        </a>

        ${!isMobile ? `<div style="color:#666;font-size:12px;margin-bottom:16px">Или нажмите кнопку выше если платите с этого устройства</div>` : ''}

        <div id="sbp-status" style="color:#888;font-size:13px;display:flex;align-items:center;justify-content:center;gap:8px;margin:16px 0">
          <span style="display:inline-block;width:13px;height:13px;border:2px solid #d4af37;
                       border-top-color:transparent;border-radius:50%;animation:sbp-spin .8s linear infinite;flex-shrink:0"></span>
          Ожидаем подтверждение оплаты…
        </div>

        <button id="sbp-cancel-btn"
                style="background:transparent;border:1px solid rgba(255,255,255,.15);color:#666;
                       border-radius:20px;padding:7px 20px;font-size:13px;cursor:pointer">
          Отмена
        </button>
      </div>`;

    document.body.appendChild(overlay);

    const statusEl = overlay.querySelector('#sbp-status');
    const cancelBtn = overlay.querySelector('#sbp-cancel-btn');

    // Polling
    let attempts = 0;
    const pollId = setInterval(async () => {
      if (++attempts > 100) { // ~5 min
        clearInterval(pollId);
        statusEl.innerHTML = '<span style="color:#e74c3c">Время ожидания истекло. Попробуйте ещё раз.</span>';
        return;
      }
      try {
        const r = await fetch(`${WORKER_URL}/status?paymentId=${paymentId}`);
        const d = await r.json();
        if (d.status === 'CONFIRMED') {
          clearInterval(pollId);
          overlay.remove();
          window.location.href = `${location.origin}${location.pathname}?payment=success`;
        } else if (d.status === 'REJECTED' || d.status === 'CANCELED') {
          clearInterval(pollId);
          overlay.remove();
          window.location.href = `${location.origin}${location.pathname}?payment=fail`;
        }
      } catch { /* ignore */ }
    }, 3000);

    cancelBtn.addEventListener('click', () => {
      clearInterval(pollId);
      overlay.remove();
    });
  }

  return { add, remove, setQty, open, close, getItem, refreshMenuCards };

})();

window.Cart = Cart;
