// Sell together: listings, matches and pools, stored in SQLite.
import { randomUUID } from 'node:crypto';
import { CROPS, MANDIS, PLACES } from './config.js';
import { roadKmBetween, poolPlan } from './pooling.js';
import { findMatches, MAX_PICKUP_KM } from './matching.js';
import { newPool, act, ActionError } from './consent.js';

import { ApiError } from './errors.js';
import { notify } from './notifications.js';
import { insertSale } from './sales.js';
export { ApiError };

const own = (table, key) => typeof key === 'string' && Object.hasOwn(table, key);
const round2 = x => Math.round(x * 100) / 100;

const toListing = r => ({
  id: r.id, farmer: r.farmer, name: r.name, crop: r.crop, qtyKg: r.qty_kg, place: r.place, lat: r.lat, lon: r.lon,
  mandi: r.mandi, kmToMandi: r.km_to_mandi, willing: r.willing === 1, status: r.status, demo: r.demo === 1, createdAt: r.created_at,
});
// What other farmers may see of a listing: no farmer id
const publicListing = l => ({ id: l.id, name: l.name, crop: l.crop, qtyKg: l.qtyKg, place: l.place, mandi: l.mandi, kmToMandi: l.kmToMandi, demo: l.demo });

function kmToMandi(place, lat, lon, mandi) {
  return PLACES[place]?.roadKm?.[mandi] ?? roadKmBetween({ lat, lon }, MANDIS[mandi]);
}

function insertListing(db, l) {
  db.prepare(`INSERT OR IGNORE INTO listings (id, farmer, name, crop, qty_kg, place, lat, lon, mandi, km_to_mandi, willing, status, demo, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(l.id, l.farmer, l.name, l.crop, l.qtyKg, l.place, l.lat, l.lon, l.mandi, l.kmToMandi, l.willing ? 1 : 0, l.status, l.demo ? 1 : 0, l.createdAt);
}

export function createListing(db, farmer, input, at) {
  const { crop, mandi, place = 'manapparai' } = input;
  const qtyKg = Number(input.qtyKg);
  if (!own(CROPS, crop)) throw new ApiError(400, 'bad_crop', `unknown crop: ${crop}`);
  if (!own(MANDIS, mandi)) throw new ApiError(400, 'bad_mandi', `unknown mandi: ${mandi}`);
  if (!own(PLACES, place)) throw new ApiError(400, 'bad_place', `unknown place: ${place}`);
  if (!(qtyKg >= 10 && qtyKg <= 20000)) throw new ApiError(400, 'bad_qty', 'quantity must be between 10 and 20,000 kg');
  const { lat, lon } = PLACES[place];
  const name = String(input.name ?? '').trim().slice(0, 40) || null;
  const l = { id: randomUUID(), farmer, name, crop, qtyKg, place, lat, lon, mandi, kmToMandi: kmToMandi(place, lat, lon, mandi), willing: input.willing !== false, status: 'open', demo: false, createdAt: at };
  insertListing(db, l);
  return l;
}

export const listingsOf = (db, farmer) =>
  db.prepare('SELECT * FROM listings WHERE farmer = ? ORDER BY created_at DESC, rowid DESC').all(farmer).map(toListing);

const getListing = (db, id) => { const r = db.prepare('SELECT * FROM listings WHERE id = ?').get(id); return r ? toListing(r) : null; };
const setStatus = (db, ids, status) => { for (const id of ids) db.prepare('UPDATE listings SET status = ? WHERE id = ? AND demo = 0').run(status, id); };

export function matchesFor(db, farmer, listingId) {
  const mine = getListing(db, listingId);
  if (!mine || mine.farmer !== farmer) throw new ApiError(404, 'not_found', 'listing not found');
  const others = db.prepare(`SELECT * FROM listings WHERE crop = ? AND mandi = ? AND status = 'open' AND willing = 1`).all(mine.crop, mine.mandi).map(toListing);
  return findMatches(mine, others).map(m => ({ listing: publicListing(m.listing), distanceKm: m.distanceKm, myBenefit: m.myBenefit, theirBenefit: m.theirBenefit, plan: m.plan }));
}

const loadPool = (db, id) => { const r = db.prepare('SELECT data FROM pools WHERE id = ?').get(id); return r ? JSON.parse(r.data) : null; };
const savePool = (db, p, at, isNew) => {
  if (isNew) db.prepare('INSERT INTO pools (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)').run(p.id, JSON.stringify(p), at, at);
  else db.prepare('UPDATE pools SET data = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(p), at, p.id);
};

// The view a member sees: who is who (isYou), plan per farmer, and money at the sale price once sold.
// Real farmer ids never leave the server; demo ids are shown so a member can answer for them.
function view(p, viewer) {
  const people = Object.fromEntries(p.people.map(x => [x.farmer, x]));
  const members = p.people.map(x => ({ ...x, consented: p.consents.includes(x.farmer), isYou: x.farmer === viewer }));
  const plan = {
    ...p.plan,
    members: p.plan.members.map(m => {
      const who = p.people.find(x => x.listingId === m.id);
      const sale = p.soldPricePerKg ? { gross: round2(m.qtyKg * p.soldPricePerKg), takeHome: round2(m.qtyKg * p.soldPricePerKg - m.sharedPart) } : {};
      return { ...m, id: undefined, name: who.name, demo: who.demo, isYou: who.farmer === viewer, ...sale };
    }),
  };
  const events = p.events.map(e => ({ ...e, name: people[e.actor]?.name ?? null, actor: undefined }));
  return { id: p.id, crop: p.crop, mandi: p.mandi, state: p.state, soldPricePerKg: p.soldPricePerKg, members: members.map(({ farmer, ...rest }) => ({ ...rest, farmer: rest.demo ? farmer : undefined })), plan, events };
}

export function proposePool(db, farmer, listingIds, at) {
  if (!Array.isArray(listingIds) || listingIds.length !== 2 || listingIds[0] === listingIds[1]) throw new ApiError(400, 'bad_listings', 'give your listing and one other listing');
  const [mine, theirs] = listingIds.map(id => getListing(db, id));
  if (!mine || !theirs) throw new ApiError(404, 'not_found', 'listing not found');
  if (mine.farmer !== farmer) throw new ApiError(403, 'not_yours', 'the first listing must be yours');
  if (theirs.farmer === farmer) throw new ApiError(400, 'same_farmer', 'pick another farmer’s listing');
  if (mine.status !== 'open' || theirs.status !== 'open') throw new ApiError(409, 'not_open', 'a listing is already in a pool');
  if (mine.crop !== theirs.crop || mine.mandi !== theirs.mandi || !mine.willing || !theirs.willing) throw new ApiError(400, 'not_compatible', 'listings must be the same crop and mandi, and both willing');
  if (roadKmBetween(mine, theirs) > MAX_PICKUP_KM) throw new ApiError(400, 'too_far', `pickups must be within ${MAX_PICKUP_KM} km`);
  const plan = poolPlan([mine, theirs]);
  if (!plan.everyoneGains) throw new ApiError(400, 'no_gain', 'sharing would cost one of you more than going alone');

  const p = {
    id: randomUUID(), crop: mine.crop, mandi: mine.mandi, plan,
    people: [mine, theirs].map(l => ({ farmer: l.farmer, name: l.name, demo: l.demo, listingId: l.id, qtyKg: l.qtyKg })),
    ...newPool({ members: [mine.farmer, theirs.farmer], proposer: farmer, at }),
  };
  savePool(db, p, at, true);
  setStatus(db, [mine.id, theirs.id], 'pooled');
  notify(db, realOthers(p, farmer), 'POOL_PROPOSED', p.id, mine.name, at);
  return view(p, farmer);
}

export function getPoolFor(db, farmer, id) {
  const p = loadPool(db, id);
  if (!p || !p.members.includes(farmer)) throw new ApiError(404, 'not_found', 'pool not found');
  return view(p, farmer);
}

export function poolAction(db, farmer, id, body, at) {
  const p = loadPool(db, id);
  if (!p || !p.members.includes(farmer)) throw new ApiError(404, 'not_found', 'pool not found');
  let actor = farmer;
  if (body.asDemo != null) {
    // Demo only: simulated neighbours have no phone, so a real member may answer for them
    const who = p.people.find(x => x.farmer === body.asDemo);
    if (!who || !who.demo) throw new ApiError(403, 'not_demo', 'you can only answer for demo farmers');
    actor = who.farmer;
  }
  let next;
  try {
    next = act(p, actor, String(body.action), body, at);
  } catch (e) {
    if (!(e instanceof ActionError)) throw e;
    const status = { not_member: 403, invalid_action: 409 }[e.code] ?? 400;
    throw new ApiError(status, e.code, e.message);
  }
  if (next !== p) {
    savePool(db, next, at, false);
    const ids = p.people.map(x => x.listingId);
    if (next.state === 'CANCELLED') setStatus(db, ids, 'open');
    if (next.state === 'COMPLETED') {
      setStatus(db, ids, 'sold');
      recordPoolSales(db, next, at);
    }
    const actorName = p.people.find(x => x.farmer === actor)?.name;
    const action = String(body.action);
    notify(db, realOthers(p, actor), KIND[action === 'accept' && next.state === 'CONFIRMED' ? 'confirm' : action], p.id, actorName, at);
  }
  return view(next, farmer);
}

const KIND = { accept: 'POOL_ACCEPTED', confirm: 'POOL_CONFIRMED', decline: 'POOL_CANCELLED', arrange: 'POOL_TRANSPORT', sold: 'POOL_SOLD', complete: 'POOL_COMPLETED' };

// Real (non-demo) members other than the one who acted
const realOthers = (p, actor) => p.people.filter(x => !x.demo && x.farmer !== actor).map(x => x.farmer);

// A completed shared sale becomes a sale record for each real member, with their transport share
function recordPoolSales(db, p, at) {
  const soldOn = (p.events.findLast(e => e.action === 'sold')?.at ?? at).slice(0, 10);
  for (const x of p.people) {
    if (x.demo) continue;
    const m = p.plan.members.find(pm => pm.id === x.listingId);
    insertSale(db, { farmer: x.farmer, crop: p.crop, mandi: p.mandi, qtyKg: x.qtyKg, pricePerKg: p.soldPricePerKg, soldOn, receipt: `POOL-${p.id.slice(0, 8)}`, transport: m.sharedPart, commissionPct: 0, loading: 0, other: 0, poolId: p.id, createdAt: at });
  }
}

// Simulated neighbours near Manapparai, clearly marked as demo (names end in "(மாதிரி)")
const NEIGHBOURS = [
  { id: 'demo-muthu-tomato', farmer: 'demo-muthu', name: 'முத்து (மாதிரி)', crop: 'tomato', qtyKg: 200, lat: 10.625, lon: 78.44, willing: true },
  { id: 'demo-selvi-tomato', farmer: 'demo-selvi', name: 'செல்வி (மாதிரி)', crop: 'tomato', qtyKg: 350, lat: 10.59, lon: 78.41, willing: true },
  { id: 'demo-kannan-onion', farmer: 'demo-kannan', name: 'கண்ணன் (மாதிரி)', crop: 'onion', qtyKg: 400, lat: 10.62, lon: 78.45, willing: true },
  { id: 'demo-ravi-tomato', farmer: 'demo-ravi', name: 'ரவி (மாதிரி)', crop: 'tomato', qtyKg: 300, lat: 10.6, lon: 78.43, willing: false },
];

export function seedDemoNeighbours(db, today) {
  for (const n of NEIGHBOURS) {
    insertListing(db, { ...n, place: null, mandi: 'trichy', kmToMandi: roadKmBetween(n, MANDIS.trichy), status: 'open', demo: true, createdAt: `${today}T00:00:00Z` });
  }
}
