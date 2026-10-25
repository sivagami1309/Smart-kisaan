// SMS crop query (PRD FR17): crop code in, top 3 mandis by net ₹/kg out.
import { CROPS, MANDIS } from './config.js';

// Plain text: 160 characters per SMS (153 when split). Tamil needs Unicode: 70 (67 when split).
export function smsSegments(text) {
  const plain = /^[\n\r\x20-\x7E]*$/.test(text);
  const [one, part] = plain ? [160, 153] : [70, 67];
  return text.length <= one ? 1 : Math.ceil(text.length / part);
}

export function parseCode(text) {
  const code = String(text || '').trim().toUpperCase();
  return Object.keys(CROPS).find(k => CROPS[k].code === code) ?? null;
}

const MONTHS = {
  ta: ['ஜன', 'பிப்', 'மார்', 'ஏப்', 'மே', 'ஜூன்', 'ஜூலை', 'ஆக', 'செப்', 'அக்', 'நவ', 'டிச'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

export function formatReply({ crop, ranked, today, lang = 'ta', demo = false }) {
  const c = CROPS[crop];
  const ta = lang === 'ta';
  const day = d => `${Number(d.slice(8))}${MONTHS[ta ? 'ta' : 'en'].at(Number(d.slice(5, 7)) - 1)}`;
  const cropName = ta ? c.ta : c.en.toUpperCase();
  if (!ranked.length) return ta ? `${cropName}: அருகில் இன்று விலை இல்லை.` : `${cropName}: no price nearby today.`;
  const lines = ranked.slice(0, 3).map((r, i) => {
    const name = ta ? MANDIS[r.mandi].ta : MANDIS[r.mandi].en.split(' ')[0];
    return `${i + 1}.${name} ${r.net.toFixed(2)}${r.freshness === 'stale' ? `(${day(r.date)})` : ''}`;
  });
  const head = ta ? `${cropName} ${day(today)} கையில் ₹/கிலோ:` : `${cropName} ${day(today)} in hand Rs/kg:`;
  const tail = demo ? [ta ? '(மாதிரி)' : '(demo)'] : [];
  return [head, ...lines, ...tail].join('\n');
}
