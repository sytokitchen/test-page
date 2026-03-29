'use strict';

/* ======================================================
   Автодополнение адреса через Dadata
   Используется только API-токен (для клиентской стороны).
   Секретный ключ в браузер не передаётся.

   Для безопасности: ограничьте токен доменом syto-kitchen.ru
   в личном кабинете dadata.ru → Настройки → Разрешённые домены.
   ====================================================== */

(function () {

  const DADATA_TOKEN = 'ce01ae65315e4434f76cf30d9e2213ae1958f9a2';

  // Зона поиска — Кудрово и прилегающие районы СПБ
  const DADATA_LOCATIONS = [
    { city: 'Кудрово' },
    { region: 'Санкт-Петербург', city: 'Санкт-Петербург' }
  ];

  /* ---- Debounce ---- */
  function debounce(fn, ms) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  /* ---- Запрос к Dadata ---- */
  async function fetchStreets(query) {
    const res = await fetch(
      'https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address',
      {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Accept':        'application/json',
          'Authorization': `Token ${DADATA_TOKEN}`
        },
        body: JSON.stringify({
          query,
          count:        8,
          locations:    DADATA_LOCATIONS,
          from_bound:   { value: 'street' },
          to_bound:     { value: 'street' },
          restrict_value: false
        })
      }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.suggestions || [];
  }

  async function fetchHouses(street, query) {
    const res = await fetch(
      'https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address',
      {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Accept':        'application/json',
          'Authorization': `Token ${DADATA_TOKEN}`
        },
        body: JSON.stringify({
          query:        `${street} ${query}`.trim(),
          count:        10,
          locations:    DADATA_LOCATIONS,
          from_bound:   { value: 'house' },
          to_bound:     { value: 'house' },
          restrict_value: false
        })
      }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.suggestions || [];
  }

  /* ---- Dropdown UI ---- */
  function createDropdown(anchor) {
    const d = document.createElement('div');
    d.className = 'suggest-dropdown';
    d.style.display = 'none';
    anchor.parentNode.appendChild(d);
    return d;
  }

  function renderItems(dropdown, items, onSelect) {
    if (!items.length) { dropdown.style.display = 'none'; return; }

    dropdown.innerHTML = items.map((s, i) =>
      `<div class="suggest-item" data-index="${i}">${escHtml(s.value)}</div>`
    ).join('');

    dropdown.querySelectorAll('.suggest-item').forEach(el => {
      el.addEventListener('mousedown', e => {
        e.preventDefault();
        onSelect(items[Number(el.dataset.index)]);
      });
    });

    dropdown.style.display = 'block';
  }

  function escHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[c]));
  }

  function attachKeyboard(input, dropdown, getItems, onSelect) {
    let activeIdx = -1;

    function updateActive(items) {
      dropdown.querySelectorAll('.suggest-item').forEach((el, i) => {
        el.classList.toggle('suggest-item--active', i === activeIdx);
      });
    }

    input.addEventListener('keydown', e => {
      if (dropdown.style.display === 'none') return;
      const items = getItems();
      if (!items.length) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIdx = Math.min(activeIdx + 1, items.length - 1);
        updateActive(items);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIdx = Math.max(activeIdx - 1, 0);
        updateActive(items);
      } else if (e.key === 'Enter' && activeIdx >= 0) {
        e.preventDefault();
        onSelect(items[activeIdx]);
        activeIdx = -1;
      } else if (e.key === 'Escape') {
        dropdown.style.display = 'none';
        activeIdx = -1;
      }
    });
  }

  /* ---- Публичная функция инициализации ---- */

  /**
   * @param {HTMLInputElement} streetInput  — поле «Улица»
   * @param {HTMLInputElement} houseInput   — поле «Дом»
   */
  function initAddressSuggest(streetInput, houseInput) {
    if (!streetInput || !houseInput) return;

    let streetSuggestions = [];
    let houseSuggestions  = [];

    const streetDropdown = createDropdown(streetInput);
    const houseDropdown  = createDropdown(houseInput);

    /* --- Улица --- */
    const onStreetInput = debounce(async () => {
      const q = streetInput.value.trim();
      if (q.length < 2) { streetDropdown.style.display = 'none'; return; }

      try {
        streetSuggestions = await fetchStreets(q);
        renderItems(streetDropdown, streetSuggestions, suggestion => {
          // Берём только название улицы без города
          const d = suggestion.data;
          const streetName = d.street_with_type || d.street || suggestion.value;
          streetInput.value = streetName;
          streetDropdown.style.display = 'none';
          houseInput.value = '';
          houseInput.focus();
        });
      } catch { /* silent — пусть вводит вручную */ }
    }, 250);

    streetInput.addEventListener('input', onStreetInput);
    streetInput.addEventListener('focus', () => {
      if (streetInput.value.trim().length >= 2) onStreetInput();
    });
    streetInput.addEventListener('blur', () => {
      setTimeout(() => { streetDropdown.style.display = 'none'; }, 160);
    });
    attachKeyboard(streetInput, streetDropdown, () => streetSuggestions, suggestion => {
      const d = suggestion.data;
      streetInput.value = d.street_with_type || d.street || suggestion.value;
      streetDropdown.style.display = 'none';
      houseInput.value = '';
      houseInput.focus();
    });

    /* --- Дом --- */
    const onHouseInput = debounce(async () => {
      const street = streetInput.value.trim();
      const house  = houseInput.value.trim();
      if (!street || house.length < 1) { houseDropdown.style.display = 'none'; return; }

      try {
        houseSuggestions = await fetchHouses(street, house);
        renderItems(houseDropdown, houseSuggestions, suggestion => {
          houseInput.value = suggestion.data.house || suggestion.value;
          houseDropdown.style.display = 'none';
          // Перейти к следующему полю (подъезд)
          const next = houseInput.closest('form')?.querySelector('#chk-entrance');
          if (next) next.focus();
        });
      } catch { /* silent */ }
    }, 250);

    houseInput.addEventListener('input', onHouseInput);
    houseInput.addEventListener('focus', () => {
      if (houseInput.value.trim().length >= 1) onHouseInput();
    });
    houseInput.addEventListener('blur', () => {
      setTimeout(() => { houseDropdown.style.display = 'none'; }, 160);
    });
    attachKeyboard(houseInput, houseDropdown, () => houseSuggestions, suggestion => {
      houseInput.value = suggestion.data.house || suggestion.value;
      houseDropdown.style.display = 'none';
      const next = houseInput.closest('form')?.querySelector('#chk-entrance');
      if (next) next.focus();
    });
  }

  window.initAddressSuggest = initAddressSuggest;

})();
