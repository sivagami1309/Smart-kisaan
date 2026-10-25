// My sales (earlier project's MySalesPage): record what was actually sold, its profit,
// and how it compares with that mandi's modal price on the same day.
import { randomUUID } from 'node:crypto';
import { CROPS, MANDIS } from './config.js';
import { profitFor } from './profit.js';
import { priceOn } from './db.js';
import { parseDate } from './clean.js';
import { ApiError } from './errors.js';

const own = (table, key) => typeof key === 'string' && Object.hasOwn(table, key);
const text = (v, max) => (String(v ?? '').trim().slice(0, max) || null);
const round2 = x => Math.round(x * 100) / 100;

export function insertSale(db, s) {
  db.prepare(`INSERT INTO sales (id, farmer, crop, mandi, qty_kg, price_per_kg, sold_on, buyer, receipt, transport, commission_pct, loading, other, pool_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(randomUUID(), s.farmer, s.crop, s.mandi, s.qtyKg, s.pricePerKg, s.soldOn, s.buyer ?? null, s.receipt ?? null,
      s.transport ?? 0, s.commissionPct ?? 0, s.loading ?? 0, s.other ?? 0, s.poolId ?? null, s.createdAt);
}

export function recordSale(db, farmer, input, today, at) {
  if (!own(CROPS, input.crop)) throw new ApiError(400, 'bad_crop', `unknown crop: ${input.crop}`);
  if (!own(MANDIS, input.mandi)) throw new ApiError(400, 'bad_mandi', `unknown mandi: ${input.mandi}`);
  const soldOn = input.soldOn == null ? today : parseDate(input.soldOn);
  if (!soldOn || !/^\d{4}-\d{2}-\d{2}$/.test(String(input.soldOn ?? soldOn))) throw new ApiError(400, 'bad_date', 'date must be YYYY-MM-DD');
  if (soldOn > today) throw new ApiError(400, 'future_date', 'a sale cannot be in the future');
  const qtyKg = Number(input.qtyKg), pricePerKg = Number(input.pricePerKg);
  if (!(qtyKg >= 10 && qtyKg <= 20000)) throw new ApiError(400, 'bad_qty', 'quantity must be between 10 and 20,000 kg');
  if (!(pricePerKg > 0 && pricePerKg <= 10000)) throw new ApiError(400, 'bad_price', 'price must be above ₹0 per kg');
  const costs = { transport: Number(input.transport ?? 0), commissionPct: Number(input.commissionPct ?? 0), loading: Number(input.loading ?? 0), other: Number(input.other ?? 0) };
  try { profitFor({ qtyKg, pricePerKg, ...costs }); } catch (e) { throw new ApiError(400, 'bad_costs', e.message); }
  insertSale(db, { farmer, crop: input.crop, mandi: input.mandi, qtyKg, pricePerKg, soldOn, buyer: text(input.buyer, 60), receipt: text(input.receipt, 40), ...costs, createdAt: at });
}

export function salesOf(db, farmer) {
  const rows = db.prepare('SELECT * FROM sales WHERE farmer = ? ORDER BY sold_on DESC, created_at DESC, rowid DESC').all(farmer);
  const sales = rows.map(r => {
    const profit = profitFor({ qtyKg: r.qty_kg, pricePerKg: r.price_per_kg, transport: r.transport, commissionPct: r.commission_pct, loading: r.loading, other: r.other });
    const m = priceOn(db, r.crop, r.mandi, r.sold_on);
    const vsMandi = m ? { modal: m.modalQ / 100, date: r.sold_on, diffPerKg: round2(r.price_per_kg - m.modalQ / 100), origin: m.origin } : null;
    return {
      id: r.id, crop: r.crop, mandi: r.mandi, qtyKg: r.qty_kg, pricePerKg: r.price_per_kg, soldOn: r.sold_on, buyer: r.buyer, receipt: r.receipt,
      transport: r.transport, commissionPct: r.commission_pct, loading: r.loading, other: r.other, poolId: r.pool_id, profit, vsMandi,
    };
  });
  const totals = {
    count: sales.length,
    kg: sales.reduce((a, s) => a + s.qtyKg, 0),
    gross: round2(sales.reduce((a, s) => a + s.profit.gross, 0)),
    net: round2(sales.reduce((a, s) => a + s.profit.net, 0)),
  };
  return { sales, totals };
}
