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
  const errText = e => (e && e.status ? e.message : offline);

  return { lang, en, esc, rs, mandi, crop, origin, day, time, apply, toast, errText, MANDIS };
})();
