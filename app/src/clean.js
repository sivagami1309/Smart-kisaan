// Turns raw data.gov.in mandi records into clean rows for the pilot crops and mandis.
import { CROPS, MANDIS } from './config.js';

export function parseDate(s) {
  if (!s) return null;
  let y, m, d;
  const dmy = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const iso = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dmy) [, d, m, y] = dmy.map(Number);
  else if (iso) [, y, m, d] = iso.map(Number);
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

const num = v => (v === '' || v == null ? NaN : Number(v));

// The API has served both "modal_price" and "Modal_x0020_Price" style keys
export function normalise(rec) {
  const r = {};
  for (const [k, v] of Object.entries(rec)) r[k.toLowerCase().replace(/_x0020_/g, '_')] = v;
  return {
    state: r.state, district: r.district, market: r.market, commodity: r.commodity, variety: r.variety,
    date: parseDate(r.arrival_date),
    minQ: num(r.min_price), maxQ: num(r.max_price), modalQ: num(r.modal_price),
  };
}

export function mapMandi(market) {
  const name = String(market || '').toLowerCase();
  for (const [id, m] of Object.entries(MANDIS)) if (m.feedNames.some(f => name.includes(f))) return id;
  return null;
}

export function mapCrop(commodity) {
  const name = String(commodity || '').toLowerCase();
  for (const [id, c] of Object.entries(CROPS)) if (c.feed.toLowerCase() === name) return id;
  return null;
}

const median = xs => {
  const s = [...xs].sort((a, b) => a - b), mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const round2 = x => Math.round(x * 100) / 100;

export function cleanRecords(records) {
  const dropped = [];
  const valid = [];
  for (const raw of records) {
    const r = normalise(raw);
    if (!(r.modalQ > 0) || !r.date) { dropped.push({ market: r.market, reason: 'no price' }); continue; }
    valid.push(r);
  }

  // Outliers: modal more than 3× above or below that commodity's median for the day
  const groups = new Map();
  for (const r of valid) {
    const k = `${r.commodity}|${r.date}`;
    groups.set(k, [...(groups.get(k) || []), r.modalQ]);
  }
  const medians = new Map([...groups].map(([k, xs]) => [k, median(xs)]));

  const unmapped = new Set();
  const agg = new Map();
  for (const r of valid) {
    const med = medians.get(`${r.commodity}|${r.date}`);
    if (r.modalQ > med * 3 || r.modalQ < med / 3) { dropped.push({ market: r.market, reason: 'outlier' }); continue; }
    const crop = mapCrop(r.commodity);
    if (!crop) continue;
    const mandi = mapMandi(r.market);
    if (!mandi) { unmapped.add(r.market); continue; }
    const k = `${r.date}|${mandi}|${crop}`;
    const a = agg.get(k) || { date: r.date, mandi, crop, n: 0, min: 0, max: 0, modal: 0 };
    a.n++; a.modal += r.modalQ;
    a.min += Number.isFinite(r.minQ) ? r.minQ : r.modalQ;
    a.max += Number.isFinite(r.maxQ) ? r.maxQ : r.modalQ;
    agg.set(k, a);
  }

  const rows = [...agg.values()].map(a => ({
    date: a.date, mandi: a.mandi, crop: a.crop,
    minQ: round2(a.min / a.n), maxQ: round2(a.max / a.n), modalQ: round2(a.modal / a.n),
  }));
  return { rows, unmapped: [...unmapped], dropped };
}
