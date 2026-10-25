import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { openDb, insertRows } from '../src/db.js';
import { seedDemo } from '../src/seed.js';
import { seedDemoNeighbours } from '../src/together.js';

const TODAY = '2026-10-25';
let server, base;

before(async () => {
  const db = openDb();
  seedDemo(db, TODAY);
  seedDemoNeighbours(db, TODAY);
  server = createApp({ db, today: () => TODAY });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const call = async (method, path, { as, body } = {}) => {
  const headers = { 'content-type': 'application/json' };
  if (as) headers['x-farmer-id'] = as;
  const r = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
};
const ME = 'farmer-sales-me-000001';
const OTHER = 'farmer-sales-other-0001';
const sale = (as, over = {}) => call('POST', '/api/sales', { as, body: { crop: 'tomato', mandi: 'trichy', qtyKg: 300, pricePerKg: 20, soldOn: TODAY, buyer: 'Sri Meenakshi Traders', receipt: 'TRY-114', transport: 1006, commissionPct: 8, ...over } });

// ---------- Sales ----------

test('records a sale with its profit and compares it with that day’s mandi price', async () => {
  const r = await sale(ME);
  assert.equal(r.status, 201);
  const { sales, totals } = (await call('GET', '/api/sales', { as: ME })).body;
  const s = sales[0];
  assert.equal(s.profit.gross, 6000);
  assert.equal(s.profit.net, 6000 - 1006 - 480);
  assert.deepEqual(s.vsMandi, { modal: 21, date: TODAY, diffPerKg: -1, origin: 'demo' });
  assert.equal(totals.count, 1);
  assert.equal(totals.kg, 300);
});

test('a sale on a day with no mandi price says so instead of guessing', async () => {
  await sale(ME, { soldOn: '2026-01-02' });
  const s = (await call('GET', '/api/sales', { as: ME })).body.sales.find(x => x.soldOn === '2026-01-02');
  assert.equal(s.vsMandi, null);
});

test('sales are checked and private', async () => {
  assert.equal((await sale(ME, { soldOn: '2026-10-26' })).status, 400); // future
  assert.equal((await sale(ME, { qtyKg: 0 })).status, 400);
  assert.equal((await sale(ME, { pricePerKg: 0 })).status, 400);
  assert.equal((await sale(ME, { crop: 'brinjal' })).status, 400);
  assert.equal((await sale(ME, { soldOn: 'yesterday' })).status, 400);
  assert.equal((await call('GET', '/api/sales')).status, 401);
  assert.equal((await call('GET', '/api/sales', { as: OTHER })).body.sales.length, 0);
});

// ---------- Price origin (traceability) ----------

test('every ranked price says where it came from and when', async () => {
  const p = (await call('GET', '/api/prices?crop=tomato')).body;
  assert.equal(p.ranked[0].origin, 'demo');
  assert.ok(p.ranked[0].fetchedAt);
});

test('live prices are marked as Agmarknet', async () => {
  const db = openDb();
  seedDemo(db, TODAY);
  insertRows(db, [{ date: TODAY, mandi: 'trichy', crop: 'tomato', minQ: 2000, maxQ: 2400, modalQ: 2200 }], 'live', '2026-10-25T06:00:00Z');
  const s = createApp({ db, today: () => TODAY });
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  try {
    const body = await (await fetch(`http://127.0.0.1:${s.address().port}/api/prices?crop=tomato`)).json();
    assert.equal(body.ranked[0].origin, 'agmarknet');
    assert.equal(body.ranked[0].fetchedAt, '2026-10-25T06:00:00Z');
  } finally { s.close(); }
});

// ---------- Shared sale → sales + notifications ----------

const offer = (as, over = {}) => call('POST', '/api/listings', { as, body: { crop: 'tomato', qtyKg: 300, place: 'manapparai', mandi: 'trichy', willing: true, name: as === ME ? 'Murugan' : 'Lakshmi', ...over } });
const notes = as => call('GET', '/api/notifications', { as });

async function realPool() {
  const a = (await offer(ME)).body.listing;
  const b = (await offer(OTHER, { qtyKg: 250 })).body.listing;
  return (await call('POST', '/api/pools', { as: ME, body: { listings: [a.id, b.id] } })).body.pool;
}

test('the other farmer is told about a proposal; the proposer is not', async () => {
  const before = (await notes(ME)).body.items.length;
  const pool = await realPool();
  const theirs = (await notes(OTHER)).body;
  assert.ok(theirs.items.some(n => n.kind === 'POOL_PROPOSED' && n.poolId === pool.id && n.actorName === 'Murugan' && !n.read));
  assert.ok(theirs.unread >= 1);
  assert.equal((await notes(ME)).body.items.length, before);
});

test('each step notifies the other members, and confirmation is its own message', async () => {
  const pool = await realPool();
  await call('POST', `/api/pools/${pool.id}/action`, { as: OTHER, body: { action: 'accept' } });
  const mine = (await notes(ME)).body.items.filter(n => n.poolId === pool.id);
  assert.deepEqual(mine.map(n => n.kind), ['POOL_CONFIRMED']);
});

test('answering for a demo farmer notifies the real member who asked', async () => {
  const mine = (await offer(ME)).body.listing;
  const match = (await call('GET', `/api/matches?listing=${mine.id}`, { as: ME })).body.matches[0];
  const pool = (await call('POST', '/api/pools', { as: ME, body: { listings: [mine.id, match.listing.id] } })).body.pool;
  const demo = pool.members.find(m => m.demo).farmer;
  await call('POST', `/api/pools/${pool.id}/action`, { as: ME, body: { action: 'accept', asDemo: demo } });
  const n = (await notes(ME)).body.items.find(x => x.poolId === pool.id);
  assert.equal(n.kind, 'POOL_CONFIRMED');
  assert.ok(n.actorName.includes('மாதிரி'));
});

test('notifications can be marked read, only by their owner', async () => {
  const pool = await realPool();
  const mineIds = (await notes(OTHER)).body.items.filter(n => n.poolId === pool.id).map(n => n.id);
  const stranger = await call('POST', '/api/notifications/read', { as: ME, body: { ids: mineIds } });
  assert.equal(stranger.status, 200);
  assert.ok((await notes(OTHER)).body.items.filter(n => n.poolId === pool.id).every(n => !n.read));
  await call('POST', '/api/notifications/read', { as: OTHER, body: {} });
  assert.equal((await notes(OTHER)).body.unread, 0);
});

test('completing a shared sale records it for every real member, with their transport share', async () => {
  const pool = await realPool();
  const step = (as, action, body = {}) => call('POST', `/api/pools/${pool.id}/action`, { as, body: { action, ...body } });
  await step(OTHER, 'accept');
  await step(ME, 'arrange');
  await step(OTHER, 'sold', { pricePerKg: 19 });
  const done = (await step(ME, 'complete')).body.pool;
  const myShare = done.plan.members.find(m => m.isYou).sharedPart;
  const mySale = (await call('GET', '/api/sales', { as: ME })).body.sales.find(s => s.poolId === pool.id);
  assert.equal(mySale.qtyKg, 300);
  assert.equal(mySale.pricePerKg, 19);
  assert.equal(mySale.transport, myShare);
  const theirSale = (await call('GET', '/api/sales', { as: OTHER })).body.sales.find(s => s.poolId === pool.id);
  assert.equal(theirSale.qtyKg, 250);
  assert.ok((await notes(ME)).body.items.some(n => n.poolId === pool.id && n.kind === 'POOL_SOLD'));
});

// ---- Bugs found in the second testing round (each failed before its fix) ----

const raw = async (path, text, as = ME) => {
  const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-farmer-id': as }, body: text });
  return { status: r.status, body: await r.json() };
};

test('bug: a request body that is not a JSON object is a 400, never a server error', async () => {
  for (const [path, text] of [['/api/sales', 'null'], ['/api/pools', 'null'], ['/api/sms/simulate', 'null'], ['/api/listings', '[1,2]'], ['/api/offer-check', '"hi"'], ['/api/sales', '42']]) {
    const r = await raw(path, text);
    assert.equal(r.status, 400, `${path} ${text}`);
    assert.equal(r.body.code, 'bad_body');
  }
});

test('bug: marking notifications read needs a list; an empty list marks nothing', async () => {
  const pool = await realPool();
  const unreadBefore = (await notes(OTHER)).body.unread;
  assert.ok(unreadBefore >= 1);
  assert.equal((await call('POST', '/api/notifications/read', { as: OTHER, body: { ids: '5' } })).status, 400);
  assert.equal((await call('POST', '/api/notifications/read', { as: OTHER, body: { ids: [] } })).body.unread, unreadBefore);
  const one = (await notes(OTHER)).body.items.find(n => n.poolId === pool.id).id;
  assert.equal((await call('POST', '/api/notifications/read', { as: OTHER, body: { ids: [one] } })).body.unread, unreadBefore - 1);
});

test('bug: a cost that is not a number says so, not "cannot be negative"', async () => {
  const r = await sale(ME, { transport: 'abc' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /number/);
});
