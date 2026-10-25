import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { openDb } from '../src/db.js';
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
const ME = 'farmer-me-1234567890';
const OTHER = 'farmer-other-123456';
const offer = (as, over = {}) => call('POST', '/api/listings', { as, body: { crop: 'tomato', qtyKg: 300, place: 'manapparai', mandi: 'trichy', willing: true, name: 'Murugan', ...over } });

test('listings need a farmer id and valid details', async () => {
  assert.equal((await call('POST', '/api/listings', { body: { crop: 'tomato', qtyKg: 300 } })).status, 401);
  assert.equal((await offer(ME, { qtyKg: 0 })).status, 400);
  assert.equal((await offer(ME, { qtyKg: 50000 })).status, 400);
  assert.equal((await offer(ME, { crop: 'brinjal' })).status, 400);
  assert.equal((await offer(ME, { mandi: 'chennai' })).status, 400);
  assert.equal((await offer(ME, { place: 'toString' })).status, 400);
  assert.equal((await call('POST', '/api/listings', { as: 'short', body: { crop: 'tomato', qtyKg: 300, place: 'manapparai', mandi: 'trichy' } })).status, 401);
});

test('a farmer sees only their own listings', async () => {
  const { status, body } = await offer(ME);
  assert.equal(status, 201);
  assert.equal(body.listing.kmToMandi, 42);
  await offer(OTHER, { crop: 'onion' });
  const mine = (await call('GET', '/api/listings/mine', { as: ME })).body.listings;
  assert.ok(mine.length >= 1 && mine.every(l => l.crop === 'tomato'));
});

test('matches show nearby demo farmers with each side’s saving, best first', async () => {
  const mine = (await offer(ME)).body.listing;
  const { status, body } = await call('GET', `/api/matches?listing=${mine.id}`, { as: ME });
  assert.equal(status, 200);
  assert.ok(body.matches.length >= 1);
  assert.ok(body.matches.every(m => m.listing.crop === 'tomato' && m.listing.demo === true && m.myBenefit > 0 && m.theirBenefit > 0));
  for (let i = 1; i < body.matches.length; i++) assert.ok(body.matches[i - 1].myBenefit >= body.matches[i].myBenefit);
  assert.equal((await call('GET', `/api/matches?listing=${mine.id}`, { as: OTHER })).status, 404);
});

async function proposeWithFirstMatch() {
  const mine = (await offer(ME)).body.listing;
  const match = (await call('GET', `/api/matches?listing=${mine.id}`, { as: ME })).body.matches[0];
  const res = await call('POST', '/api/pools', { as: ME, body: { listings: [mine.id, match.listing.id] } });
  return { mine, match, res };
}

test('proposing a pool: proposer consents, plan included, listings leave the match list', async () => {
  const { mine, match, res } = await proposeWithFirstMatch();
  assert.equal(res.status, 201);
  assert.equal(res.body.pool.state, 'PROPOSED');
  assert.equal(res.body.pool.plan.everyoneGains, true);
  assert.equal(res.body.pool.members.length, 2);
  const again = (await call('GET', `/api/matches?listing=${mine.id}`, { as: ME }));
  assert.equal(again.body.matches.length, 0); // my listing is now pooled
  assert.equal((await call('POST', '/api/pools', { as: ME, body: { listings: [mine.id, match.listing.id] } })).status, 409);
});

test('cannot propose with someone else’s listing as your own, or the same listing twice', async () => {
  const theirs = (await offer(OTHER)).body.listing;
  const mine = (await offer(ME)).body.listing;
  assert.equal((await call('POST', '/api/pools', { as: ME, body: { listings: [theirs.id, mine.id] } })).status, 403);
  assert.equal((await call('POST', '/api/pools', { as: ME, body: { listings: [mine.id, mine.id] } })).status, 400);
});

test('demo farmers can be accepted on their behalf; real farmers cannot be impersonated', async () => {
  const { res } = await proposeWithFirstMatch();
  const id = res.body.pool.id;
  const demo = res.body.pool.members.find(m => m.demo);
  const ok = await call('POST', `/api/pools/${id}/action`, { as: ME, body: { action: 'accept', asDemo: demo.farmer } });
  assert.equal(ok.body.pool.state, 'CONFIRMED');

  const a = (await offer(ME, { place: 'manapparai' })).body.listing;
  const b = (await offer(OTHER, { place: 'manapparai', qtyKg: 250 })).body.listing;
  const p2 = (await call('POST', '/api/pools', { as: ME, body: { listings: [a.id, b.id] } })).body.pool;
  const bad = await call('POST', `/api/pools/${p2.id}/action`, { as: ME, body: { action: 'accept', asDemo: OTHER } });
  assert.equal(bad.status, 403);
  const real = await call('POST', `/api/pools/${p2.id}/action`, { as: OTHER, body: { action: 'accept' } });
  assert.equal(real.body.pool.state, 'CONFIRMED');
});

test('full journey to completed, with each farmer’s money worked out at the sale price', async () => {
  const { res } = await proposeWithFirstMatch();
  const id = res.body.pool.id;
  const demo = res.body.pool.members.find(m => m.demo).farmer;
  const step = (action, body = {}) => call('POST', `/api/pools/${id}/action`, { as: ME, body: { action, ...body } });
  await step('accept', { asDemo: demo });
  await step('arrange');
  const sold = await step('sold', { pricePerKg: 20 });
  assert.equal(sold.body.pool.state, 'SOLD');
  const me = sold.body.pool.plan.members.find(m => !m.demo);
  assert.equal(me.gross, 6000); // 300 kg × ₹20
  assert.equal(me.takeHome, Math.round((6000 - me.sharedPart) * 100) / 100);
  const done = await step('complete');
  assert.equal(done.body.pool.state, 'COMPLETED');
  assert.deepEqual(done.body.pool.events.map(e => e.action), ['propose', 'accept', 'arrange', 'sold', 'complete']);
});

test('invalid steps are refused with a reason', async () => {
  const { res } = await proposeWithFirstMatch();
  const r = await call('POST', `/api/pools/${res.body.pool.id}/action`, { as: ME, body: { action: 'sold', pricePerKg: 20 } });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'invalid_action');
});

test('declining cancels the pool and frees both listings', async () => {
  const { mine, res } = await proposeWithFirstMatch();
  const d = await call('POST', `/api/pools/${res.body.pool.id}/action`, { as: ME, body: { action: 'decline' } });
  assert.equal(d.body.pool.state, 'CANCELLED');
  const again = await call('GET', `/api/matches?listing=${mine.id}`, { as: ME });
  assert.ok(again.body.matches.length >= 1);
});

test('outsiders cannot see a pool', async () => {
  const { res } = await proposeWithFirstMatch();
  assert.equal((await call('GET', `/api/pools/${res.body.pool.id}`, { as: 'farmer-stranger-0000' })).status, 404);
  assert.equal((await call('GET', `/api/pools/${res.body.pool.id}`, { as: ME })).status, 200);
});

test('each farmer is told which member is them, and real farmer ids are never shown', async () => {
  const a = (await offer(ME, { place: 'manapparai' })).body.listing;
  const b = (await offer(OTHER, { place: 'manapparai', qtyKg: 250 })).body.listing;
  const id = (await call('POST', '/api/pools', { as: ME, body: { listings: [a.id, b.id] } })).body.pool.id;
  const forMe = (await call('GET', `/api/pools/${id}`, { as: ME })).body.pool;
  const forOther = (await call('GET', `/api/pools/${id}`, { as: OTHER })).body.pool;
  assert.deepEqual(forMe.members.map(m => m.isYou), [true, false]);
  assert.deepEqual(forOther.members.map(m => m.isYou), [false, true]);
  assert.deepEqual(forMe.plan.members.map(m => m.isYou), [true, false]);
  assert.ok(!JSON.stringify(forMe).includes(OTHER) && !JSON.stringify(forOther).includes(ME));
});
