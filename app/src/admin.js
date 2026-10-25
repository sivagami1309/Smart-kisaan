// Admin console (earlier project's /admin pages): data sources, totals, farmers, pools and manual prices.
// Protected by SK_ADMIN_TOKEN in .env; switched off when it is not set.
import { timingSafeEqual, createHash } from 'node:crypto';
import { CROPS, MANDIS } from './config.js';
import { insertRows, dataState, logIngestion, shift } from './db.js';
import { parseDate } from './clean.js';
import { ApiError } from './errors.js';

const own = (table, key) => typeof key === 'string' && Object.hasOwn(table, key);

export function checkAdmin(req, token) {
  if (!token) throw new ApiError(403, 'admin_disabled', 'admin is switched off: set SK_ADMIN_TOKEN in .env');
  const given = String(req.headers['x-admin-token'] ?? '');
  // Hash both sides so the comparison takes the same time whatever the length
  const h = s => createHash('sha256').update(s).digest();
  if (!given || !timingSafeEqual(h(given), h(token))) throw new ApiError(401, 'bad_token', 'wrong admin password');
}

export function adminSummary(db, today) {
  const one = sql => db.prepare(sql).get().n;
  const pools = {};
  for (const r of db.prepare('SELECT data FROM pools').all()) { const s = JSON.parse(r.data).state; pools[s] = (pools[s] ?? 0) + 1; }
  return {
    today,
    dataState: dataState(db, today),
    counts: {
      listings: one('SELECT COUNT(*) AS n FROM listings WHERE demo = 0'),
      sales: one('SELECT COUNT(*) AS n FROM sales'),
      farmers: one(`SELECT COUNT(*) AS n FROM (SELECT farmer FROM listings WHERE demo = 0 UNION SELECT farmer FROM sales)`),
      prices: one('SELECT COUNT(*) AS n FROM price_daily'),
      pools,
    },
    ingestion: db.prepare('SELECT at, source, ok, inserted, message FROM ingestion_log ORDER BY id DESC LIMIT 10').all()
      .map(r => ({ at: r.at, source: r.source, ok: r.ok === 1, inserted: r.inserted, message: r.message })),
  };
}

// Real farmers only, by name; their ids never leave the server
export function adminFarmers(db) {
  const rows = db.prepare(`
    SELECT f.farmer,
      (SELECT name FROM listings WHERE farmer = f.farmer AND name IS NOT NULL ORDER BY created_at DESC LIMIT 1) AS name,
      (SELECT COUNT(*) FROM listings WHERE farmer = f.farmer) AS listings,
      (SELECT COUNT(*) FROM sales WHERE farmer = f.farmer) AS sales,
      (SELECT MAX(created_at) FROM listings WHERE farmer = f.farmer) AS lastSeen
    FROM (SELECT farmer FROM listings WHERE demo = 0 UNION SELECT farmer FROM sales) f`).all();
  return rows.map(r => ({ name: r.name, listings: r.listings, sales: r.sales, lastSeen: r.lastSeen }))
    .sort((a, b) => String(b.lastSeen).localeCompare(String(a.lastSeen)));
}

export function adminPools(db) {
  return db.prepare('SELECT data, updated_at FROM pools ORDER BY updated_at DESC LIMIT 100').all().map(r => {
    const p = JSON.parse(r.data);
    return { id: p.id, crop: p.crop, mandi: p.mandi, state: p.state, totalKg: p.plan.totalKg, saving: p.plan.totalSaving, names: p.people.map(x => x.name), updatedAt: r.updated_at };
  });
}

// A dated price an admin saw at a mandi (e.g. from the market committee board), stored as real data
export function addManualPrice(db, input, today, at) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(input.date)) ? parseDate(input.date) : null;
  if (!date) throw new ApiError(400, 'bad_date', 'date must be YYYY-MM-DD');
  if (date > today) throw new ApiError(400, 'future_date', 'a price cannot be in the future');
  if (date < shift(today, -30)) throw new ApiError(400, 'old_date', 'only the last 30 days can be entered');
  if (!own(MANDIS, input.mandi)) throw new ApiError(400, 'bad_mandi', `unknown mandi: ${input.mandi}`);
  if (!own(CROPS, input.crop)) throw new ApiError(400, 'bad_crop', `unknown crop: ${input.crop}`);
  const modal = Number(input.modalPerKg);
  const min = input.minPerKg == null || input.minPerKg === '' ? modal : Number(input.minPerKg);
  const max = input.maxPerKg == null || input.maxPerKg === '' ? modal : Number(input.maxPerKg);
  if (!(modal > 0 && modal <= 10000) || !(min > 0) || !(max > 0)) throw new ApiError(400, 'bad_price', 'prices must be above ₹0 per kg');
  if (!(min <= modal && modal <= max)) throw new ApiError(400, 'bad_range', 'minimum ≤ modal ≤ maximum');
  const q = v => Math.round(v * 100 * 100) / 100; // ₹/kg → ₹/quintal
  const added = insertRows(db, [{ date, mandi: input.mandi, crop: input.crop, minQ: q(min), maxQ: q(max), modalQ: q(modal) }], 'live', at, 'manual');
  if (!added) throw new ApiError(409, 'exists', 'a real price for this mandi, crop and date is already stored');
  logIngestion(db, { at, source: 'manual', ok: true, inserted: 1, message: `manual price: ${input.crop} at ${input.mandi} on ${date}` });
}
