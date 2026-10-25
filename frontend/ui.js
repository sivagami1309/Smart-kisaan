// Shared helpers for the inner screens: language, safe text, money, names and price origin.
const UI = (() => {
  const lang = SK.store.get('sk-lang') === 'en' ? 'en' : 'ta';
  const en = lang === 'en';
  const MANDIS = { trichy: ['திருச்சி', 'Trichy'], manapparai: ['மணப்பாறை', 'Manapparai'], dindigul: ['திண்டுக்கல்', 'Dindigul'], oddanchatram: ['ஒட்டன்சத்திரம்', 'Oddanchatram'], karur: ['கரூர்', 'Karur'] };
  const ORIGIN = { demo: ['மாதிரி தரவு', 'demo data'], agmarknet: ['Agmarknet', 'Agmarknet'], manual: ['கைமுறை பதிவு', 'entered by admin'] };

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Whole rupees as-is, otherwise 2 decimals
  const rs = v => { const n = Number(v); return Number.isInteger(n) ? n.toLocaleString('en-IN') : n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  const mandi = k => MANDIS[k]?.[en ? 1 : 0] ?? k;
  const crop = k => SK.CROPS[k]?.[en ? 'en' : 'ta'] ?? k;
  const origin = k => ORIGIN[k]?.[en ? 1 : 0] ?? (en ? 'unknown source' : 'ஆதாரம் தெரியவில்லை');
  const day = d => SK.day(d, lang);
  const time = iso => new Date(iso).toLocaleString(en ? 'en-IN' : 'ta-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  function apply(T) {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach(el => { const v = T[el.dataset.i18n]; if (typeof v === 'string') el.textContent = v; });
    document.querySelectorAll('[data-i18n-ph]').forEach(el => { const v = T[el.dataset.i18nPh]; if (typeof v === 'string') el.placeholder = v; });
    document.querySelectorAll('select[data-mandis] option').forEach(o => { o.textContent = mandi(o.value); });
    document.querySelectorAll('select[data-crops] option').forEach(o => { o.textContent = crop(o.value); });
  }

  let tId;
  function toast(msg) {
    let el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg; el.classList.add('show'); clearTimeout(tId); tId = setTimeout(() => el.classList.remove('show'), 2800);
  }

  const offline = en ? 'No connection to the server.' : 'சர்வர் இணைப்பு இல்லை.';
  // Server messages are English; Tamil screens show a plain Tamil message for each kind of error.
  // raw = true keeps the exact server message (used on the English-only admin screen).
  const TA_ERR = {
    400: 'விவரம் சரியில்லை: எண்களையும் தேதியையும் சரிபார்க்கவும்.', 401: 'அனுமதி இல்லை.', 403: 'இதைச் செய்ய அனுமதி இல்லை.',
    404: 'கிடைக்கவில்லை.', 409: 'ஏற்கனவே பதிவாகியுள்ளது, அல்லது இந்த நிலையில் முடியாது.', 503: 'சேவை இப்போது கிடைக்கவில்லை. சிறிது நேரம் கழித்து முயலுங்கள்.',
  };
  const errText = (e, raw = false) => {
    if (!e || !e.status) return offline;
    if (raw || en) return e.message;
    return TA_ERR[e.status] ?? 'ஏதோ தவறு. மீண்டும் முயலுங்கள்.';
  };

  return { lang, en, esc, rs, mandi, crop, origin, day, time, apply, toast, errText, MANDIS };
})();
