// Deterministic 30-day DEMO history (source = 'demo'), clearly labelled wherever it is shown.
import { pathToFileURL } from 'node:url';
import { openDb, insertRows, shift } from './db.js';
import { dbPath, localToday } from './paths.js';

// Base modal ₹/quintal per crop and a fixed price level per mandi
const BASE = { tomato: 2000, onion: 2600, paddy: 2300, banana: 2200, groundnut: 6400 };
const LEVEL = { trichy: 1.05, manapparai: 0.9, dindigul: 1.0, oddanchatram: 1.1, karur: 0.975 };
// Days since each mandi last reported: Dindigul is a day late, Karur three days late
const LAG = { trichy: 0, manapparai: 0, dindigul: 1, oddanchatram: 0, karur: 3 };
const RECENT = [1.0, 0.98, 1.02, 0.99, 0.95, 0.97, 0.94]; // index = days before the last report

const pattern = i => (i < RECENT.length ? RECENT[i] : 0.95 + 0.04 * Math.sin(i));

export function demoRows(today, days = 30) {
  const rows = [];
  for (const [crop, base] of Object.entries(BASE)) {
    for (const [mandi, level] of Object.entries(LEVEL)) {
      const last = shift(today, -LAG[mandi]);
      for (let i = 0; i < days; i++) {
        const modalQ = Math.round(base * level * pattern(i));
        rows.push({ date: shift(last, -i), mandi, crop, minQ: Math.round(modalQ * 0.9), maxQ: Math.round(modalQ * 1.1), modalQ });
      }
    }
  }
  return rows;
}

export const seedDemo = (db, today) => insertRows(db, demoRows(today), 'demo', `${today}T00:00:00Z`);

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const today = localToday();
  const n = seedDemo(openDb(dbPath()), today);
  console.log(`Demo data: ${n} new rows up to ${today} in ${dbPath()}`);
}
