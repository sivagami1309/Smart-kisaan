// Sell together (கூட்டு விற்பனை): one shared trip to the mandi, split fairly by quantity.
// Vehicle rates are estimates carried over from the earlier Smart Kisaan project.

const VEHICLES = [
  { key: 'three-wheeler', maxKg: 500, base: 250, perKm: 18, min: 300, ta: 'மூன்று சக்கர வண்டி', en: 'Three-wheeler' },
  { key: 'pickup', maxKg: 1500, base: 450, perKm: 24, min: 500, ta: 'பிக்கப் வண்டி', en: 'Pickup truck' },
  { key: 'lorry', maxKg: Infinity, base: 800, perKm: 32, min: 900, ta: 'சிறிய லாரி', en: 'Small lorry' },
];

const round1 = x => Math.round(x * 10) / 10;
const round2 = x => Math.round(x * 100) / 100;

export const vehicleFor = kg => VEHICLES.find(v => kg <= v.maxKg);

export function tripCost(km, kg) {
  const v = vehicleFor(kg);
  return Math.max(v.min, Math.round(v.base + v.perKm * km));
}

// Pickup-to-pickup road distance: straight line × 1.3
export function roadKmBetween(a, b) {
  const rad = x => (x * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return round1(2 * 6371 * Math.asin(Math.sqrt(h)) * 1.3);
}

// Split an amount by quantity in whole paise; leftover paise go to the largest remainders,
// so the parts always add up exactly to the amount.
export function splitByQuantity(amount, quantities) {
  const total = quantities.reduce((a, b) => a + b, 0);
  if (!(total > 0)) throw new RangeError('total quantity must be more than 0');
  const paise = Math.round(amount * 100);
  const exact = quantities.map(q => (q / total) * paise);
  const parts = exact.map(Math.floor);
  let left = paise - parts.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) { if (left-- <= 0) break; parts[i]++; }
  return parts.map(p => p / 100);
}

// members: [{ id, qtyKg, kmToMandi, lat, lon }]
export function poolPlan(members) {
  if (members.length < 2) throw new RangeError('a pool needs at least two farmers');
  // The vehicle starts at the farthest farmer and picks up the others on the way
  const route = [...members].sort((a, b) => b.kmToMandi - a.kmToMandi);
  let detour = 0;
  for (let i = 1; i < route.length; i++) detour += roadKmBetween(route[i - 1], route[i]);
  const tripKm = round1(route[0].kmToMandi + detour);

  const totalKg = members.reduce((a, m) => a + m.qtyKg, 0);
  const vehicle = vehicleFor(totalKg);
  const sharedCost = tripCost(tripKm, totalKg);
  const parts = splitByQuantity(sharedCost, members.map(m => m.qtyKg));

  const out = members.map((m, i) => {
    const soloCost = tripCost(m.kmToMandi, m.qtyKg);
    return { id: m.id, qtyKg: m.qtyKg, sharePct: round1((m.qtyKg / totalKg) * 100), sharedPart: parts[i], soloCost, benefit: round2(soloCost - parts[i]) };
  });
  return {
    totalKg, tripKm, detourKm: round1(detour), sharedCost,
    vehicle: { key: vehicle.key, ta: vehicle.ta, en: vehicle.en },
    members: out,
    everyoneGains: out.every(m => m.benefit > 0),
    totalSaving: round2(out.reduce((a, m) => a + m.soloCost, 0) - sharedCost),
  };
}
