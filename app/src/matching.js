// Finds nearby farmers to sell together with (design rule 5).
import { poolPlan, roadKmBetween } from './pooling.js';

export const MAX_PICKUP_KM = 10;

// listing: { id, farmer, crop, mandi, qtyKg, kmToMandi, lat, lon, willing, status }
export function findMatches(mine, others, maxKm = MAX_PICKUP_KM) {
  if (!mine.willing || mine.status !== 'open') return [];
  const out = [];
  for (const o of others) {
    if (o.id === mine.id || o.farmer === mine.farmer) continue;
    if (o.crop !== mine.crop || o.mandi !== mine.mandi || !o.willing || o.status !== 'open') continue;
    const distanceKm = roadKmBetween(mine, o);
    if (distanceKm > maxKm) continue;
    const plan = poolPlan([mine, o]);
    if (!plan.everyoneGains) continue; // never suggest a pool where either farmer pays more than alone
    const [me, them] = plan.members;
    out.push({ listing: o, distanceKm, plan, myBenefit: me.benefit, theirBenefit: them.benefit });
  }
  return out.sort((a, b) => b.myBenefit - a.myBenefit);
}
