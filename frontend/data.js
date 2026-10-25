// Smart Kisaan – browser client for the prototype API (app/src/server.js).
// Prices and rules come from the server; this file keeps only per-device settings.
const SK = (() => {
  const CROPS = {
    tomato: { ico: '🍅', ta: 'தக்காளி', en: 'Tomato', code: 'TOM' },
    onion: { ico: '🧅', ta: 'வெங்காயம்', en: 'Onion', code: 'ONI' },
    paddy: { ico: '🌾', ta: 'நெல்', en: 'Paddy', code: 'PAD' },
    banana: { ico: '🍌', ta: 'வாழை', en: 'Banana', code: 'BAN' },
    groundnut: { ico: '🥜', ta: 'நிலக்கடலை', en: 'Groundnut', code: 'GNT' },
  };
  const PLACES = {
    manapparai: { ta: 'மணப்பாறை', en: 'Manapparai' },
    trichy: { ta: 'திருச்சி', en: 'Trichy' },
    dindigul: { ta: 'திண்டுக்கல்', en: 'Dindigul' },
    karur: { ta: 'கரூர்', en: 'Karur' },
  };
  const DEFAULT_COST = { rate: 25, load: 500, comm: 8 };

  const store = {
    get: k => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
    del: k => { try { localStorage.removeItem(k); } catch {} },
  };

  function loadCost() {
    try { return Object.assign({}, DEFAULT_COST, JSON.parse(store.get('sk-cost') || '{}')); } catch { return { ...DEFAULT_COST }; }
  }
  const saveCost = c => store.set('sk-cost', JSON.stringify(c));
  const radius = () => Number(store.get('sk-radius')) || 100;
  const place = () => { const p = store.get('sk-place'); return Object.hasOwn(PLACES, p ?? '') ? p : 'manapparai'; };
  const placeName = lang => PLACES[place()][lang === 'en' ? 'en' : 'ta'];

  // Prototype identity for sell-together: a random id kept on this phone (not a login)
  function farmerId() {
    let id = store.get('sk-farmer');
    if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
      id = 'f-' + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36) + 'abcdefgh');
      store.set('sk-farmer', id);
    }
    return id;
  }

  async function api(path, body, extraHeaders = {}) {
    const headers = { 'x-farmer-id': farmerId(), ...extraHeaders };
    if (body) headers['content-type'] = 'application/json';
    const res = await fetch(path, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || `HTTP ${res.status}`); e.code = data.code; e.status = res.status; throw e; }
    return data;
  }
  const options = crop => ({ crop, place: place(), radius: radius(), ...loadCost() });
  const qs = o => new URLSearchParams(Object.entries(o).map(([k, v]) => [k, String(v)])).toString();

  const prices = crop => api('/api/prices?' + qs(options(crop)));
  const trend = (crop, mandi, days = 7) => api('/api/trend?' + qs({ crop, mandi, days }));
  const offerCheck = (crop, offer, qty) => api('/api/offer-check', { ...options(crop), offer, qty });
  const sms = (text, lang) => api('/api/sms/simulate', { text, lang, place: place(), radius: radius(), ...loadCost() });
  const health = () => api('/api/health');
  const sales = {
    list: () => api('/api/sales'),
    add: s => api('/api/sales', s),
  };
  const notifications = {
    list: () => api('/api/notifications'),
    read: ids => api('/api/notifications/read', ids ? { ids } : {}),
  };
  const profit = q => api('/api/profit?' + qs({ place: place(), ...q }));
  const voice = text => api('/api/voice?' + qs({ text }));
  const markets = () => api('/api/markets?' + qs({ place: place() }));
  const board = () => api('/api/board?' + qs({ place: place(), radius: radius(), ...loadCost() }));
  const weather = () => api('/api/weather?' + qs({ place: place() }));
  // Admin password is kept for this browser tab only
  const adminToken = { get: () => { try { return sessionStorage.getItem('sk-admin') || ''; } catch { return ''; } }, set: v => { try { sessionStorage.setItem('sk-admin', v); } catch {} } };
  const admin = {
    get: path => api('/api/admin/' + path, undefined, { 'x-admin-token': adminToken.get() }),
    price: p => api('/api/admin/prices', p, { 'x-admin-token': adminToken.get() }),
  };
  const together = {
    create: listing => api('/api/listings', listing),
    mine: () => api('/api/listings/mine'),
    matches: listingId => api('/api/matches?' + qs({ listing: listingId })),
    propose: (mine, theirs) => api('/api/pools', { listings: [mine, theirs] }),
    pool: id => api(`/api/pools/${encodeURIComponent(id)}`),
    act: (id, action, extra = {}) => api(`/api/pools/${encodeURIComponent(id)}/action`, { action, ...extra }),
  };

  const MONTHS = {
    ta: ['ஜன', 'பிப்', 'மார்', 'ஏப்', 'மே', 'ஜூன்', 'ஜூலை', 'ஆக', 'செப்', 'அக்', 'நவ', 'டிச'],
    en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  };
  const day = (d, lang) => d ? `${Number(d.slice(8))} ${MONTHS[lang === 'en' ? 'en' : 'ta'].at(Number(d.slice(5, 7)) - 1)}` : '';

  // The banner always says where prices come from (PRD FR10): demo, cached (not live) or live
  function banner(ds, lang) {
    const el = document.querySelector('.demo-banner');
    if (!el || !ds) return;
    const text = el.querySelector('[data-sk-banner]');
    el.classList.remove('live', 'cached');
    if (ds.state === 'live') {
      el.classList.add('live');
      text.textContent = lang === 'en' ? `LIVE · Agmarknet · ${day(ds.asOf, 'en')}` : `நேரடி விலை · Agmarknet · ${day(ds.asOf, 'ta')}`;
    } else if (ds.state === 'cached') {
      el.classList.add('cached');
      text.textContent = lang === 'en' ? `NOT LIVE · last prices from ${day(ds.asOf, 'en')}` : `நேரடி இல்லை · கடைசி விலை ${day(ds.asOf, 'ta')}`;
    } else {
      text.textContent = lang === 'en' ? 'DEMO DATA – NOT LIVE MARKET PRICES' : 'DEMO DATA – NOT LIVE MARKET PRICES · மாதிரி தரவு';
    }
  }

  return { CROPS, PLACES, DEFAULT_COST, store, loadCost, saveCost, radius, place, placeName, prices, trend, offerCheck, sms, health, together, sales, notifications, profit, voice, markets, board, weather, admin, adminToken, farmerId, day, banner };
})();
