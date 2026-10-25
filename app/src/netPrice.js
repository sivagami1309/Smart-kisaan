// Price rules from the PRD, kept in one place: net price (FR7) and freshness (FR8).

export const perKg = perQuintal => perQuintal / 100;

// Net ₹/kg = modal ₹/kg − transport (₹/km × km ÷ load kg) − commission % of modal
export function netPrice(modalQ, km, cost) {
  if (!(cost.load > 0)) throw new RangeError('load must be more than 0 kg');
  const modal = perKg(modalQ);
  const transport = (cost.rate * km) / cost.load;
  const commission = (modal * cost.comm) / 100;
  return { modal, transport, commission, net: modal - transport - commission };
}

export const ageDays = (date, today) => Math.round((Date.parse(today) - Date.parse(date)) / 864e5);

export const freshness = age => (age <= 0 ? 'today' : age === 1 ? 'stale' : 'missing');

// rows: [{ mandi, km, modalQ, minQ, maxQ, date }] – the latest price per mandi for one crop
export function rankMandis(rows, cost, radius, today) {
  const ranked = [];
  const missing = [];
  for (const row of rows) {
    if (row.km > radius) continue;
    const age = row.date ? ageDays(row.date, today) : Infinity;
    const state = row.modalQ == null ? 'missing' : freshness(age);
    if (state === 'missing') {
      missing.push({
        mandi: row.mandi,
        km: row.km,
        lastModal: row.modalQ == null ? null : perKg(row.modalQ),
        lastDate: row.date ?? null,
      });
      continue;
    }
    ranked.push({
      mandi: row.mandi,
      km: row.km,
      date: row.date,
      age,
      freshness: state,
      min: row.minQ == null ? null : perKg(row.minQ),
      max: row.maxQ == null ? null : perKg(row.maxQ),
      ...netPrice(row.modalQ, row.km, cost),
    });
  }
  ranked.sort((a, b) => b.net - a.net);
  missing.sort((a, b) => a.km - b.km);

  // The mandi paying most per kg, named only when distance makes it lose
  const top = ranked.reduce((best, r) => (!best || r.modal > best.modal ? r : best), null);
  const highestGross = top && ranked[0] && top.mandi !== ranked[0].mandi ? top.mandi : null;

  return { ranked, missing, highestGross };
}
