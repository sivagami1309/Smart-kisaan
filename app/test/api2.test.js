import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { openDb } from '../src/db.js';
import { seedDemo } from '../src/seed.js';
import { seedDemoNeighbours } from '../src/together.js';
import { createWeather } from '../src/weather.js';

const TODAY = '2026-10-25';
const TOKEN = 'test-admin-token-0123456789';
const weatherOk = createWeather({ fetchFn: async () => ({ ok: true, json: async () => ({ current: { temperature_2m: 30 }, daily: { time: [TODAY] } }) }) });

async function start(opts = {}) {
  const db = openDb();
  seedDemo(db, TODAY);
  seedDemoNeighbours(db, TODAY);
  const server = createApp({ db, today: () => TODAY, weather: weatherOk, ...opts });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { headers = {}, body } = {}) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  };
  return { server, call };
}

let app;
before(async () => { app = await start({ adminToken: TOKEN }); });
after(() => app.server.close());
const get = p => app.call('GET', p);

// ---------- Profit ----------

test('profit uses today’s mandi price and an estimated vehicle unless told otherwise', async () => {
  const { status, body } = await get('/api/profit?crop=tomato&mandi=trichy&qtyKg=300');
  assert.equal(status, 200);
  assert.equal(body.pricePerKg, 21);
  assert.deepEqual(body.priceFrom, { date: TODAY, origin: 'demo' });
  assert.equal(body.transportEstimate.cost, 1006);
  assert.equal(body.transportEstimate.vehicle.key, 'three-wheeler');
  assert.equal(body.profit.net, 6300 - 1006 - 504);
});

test('profit accepts your own price and transport', async () => {
  const { body } = await get('/api/profit?crop=tomato&mandi=trichy&qtyKg=300&pricePerKg=18&transport=500&commissionPct=5');
  assert.equal(body.pricePerKg, 18);
  assert.equal(body.priceFrom, null);
  assert.equal(body.profit.net, 5400 - 500 - 270);
});

test('profit refuses bad input', async () => {
  assert.equal((await get('/api/profit?crop=tomato&mandi=trichy&qtyKg=0')).status, 400);
  assert.equal((await get('/api/profit?crop=tomato&mandi=chennai&qtyKg=100')).status, 400);
  assert.equal((await get('/api/profit?crop=tomato&mandi=trichy&qtyKg=100&transport=-1')).status, 400);
});

// ---------- Voice, markets, board ----------

test('voice turns words into a screen to open', async () => {
  const { body } = await get('/api/voice?text=' + encodeURIComponent('தக்காளி விலை'));
  assert.deepEqual(body, { command: { type: 'crop-prices', crop: 'tomato' }, href: 'results.html?crop=tomato' });
  assert.equal((await get('/api/voice?text=hello')).body.href, null);
});

test('nearby markets are listed nearest first with directions data', async () => {
  const { body } = await get('/api/markets?place=manapparai');
  assert.deepEqual(body.markets.map(m => [m.key, m.km]), [['manapparai', 6], ['trichy', 42], ['dindigul', 48], ['karur', 70], ['oddanchatram', 92]]);
  assert.ok(body.markets[0].lat && body.markets[0].ta);
  assert.equal((await get('/api/markets?place=__proto__')).status, 400);
});

test('prices board gives every crop’s best mandi today', async () => {
  const { body } = await get('/api/board');
  assert.equal(body.crops.length, 5);
  const tomato = body.crops.find(c => c.crop === 'tomato');
  assert.equal(tomato.best.mandi, 'trichy');
  assert.equal(tomato.best.net.toFixed(2), '17.22');
  assert.equal(body.dataState.state, 'demo');
});

// ---------- Weather ----------

test('weather for a place comes from the server, with its source', async () => {
  const { status, body } = await get('/api/weather?place=manapparai');
  assert.equal(status, 200);
  assert.equal(body.source, 'Open-Meteo (open-meteo.com)');
  assert.equal(body.place, 'manapparai');
  assert.equal((await get('/api/weather?place=london')).status, 400);
});

test('weather says unavailable when the service fails', async () => {
  const down = await start({ weather: createWeather({ fetchFn: async () => { throw new Error('offline'); } }) });
  try { assert.equal((await down.call('GET', '/api/weather?place=manapparai')).status, 503); } finally { down.server.close(); }
});

// ---------- Admin ----------

const admin = (method, path, body, token = TOKEN) => app.call(method, path, { headers: { 'x-admin-token': token }, body });

test('admin is off when no admin password is configured', async () => {
  const off = await start({ adminToken: '' });
  try {
    const r = await off.call('GET', '/api/admin/summary', { headers: { 'x-admin-token': '' } });
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'admin_disabled');
  } finally { off.server.close(); }
});

test('admin needs the right password', async () => {
  assert.equal((await admin('GET', '/api/admin/summary', null, 'wrong')).status, 401);
  assert.equal((await app.call('GET', '/api/admin/summary')).status, 401);
  const ok = await admin('GET', '/api/admin/summary');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.dataState.state, 'demo');
  assert.ok('listings' in ok.body.counts && 'sales' in ok.body.counts && 'farmers' in ok.body.counts);
});

test('admin sees real farmers and pools, never their ids', async () => {
  const farmer = 'farmer-admin-view-0001';
  await app.call('POST', '/api/listings', { headers: { 'x-farmer-id': farmer }, body: { crop: 'tomato', qtyKg: 300, place: 'manapparai', mandi: 'trichy', name: 'Kavitha' } });
  const farmers = (await admin('GET', '/api/admin/farmers')).body.farmers;
  assert.ok(farmers.some(f => f.name === 'Kavitha' && f.listings === 1));
  assert.ok(!JSON.stringify(farmers).includes(farmer));
  assert.ok(!farmers.some(f => f.name?.includes('மாதிரி')));
  assert.equal((await admin('GET', '/api/admin/pools')).status, 200);
});

test('admin checks a manual price before saving it', async () => {
  const p = over => admin('POST', '/api/admin/prices', { date: TODAY, mandi: 'dindigul', crop: 'tomato', minPerKg: 18, modalPerKg: 20.5, maxPerKg: 23, ...over });
  assert.equal((await p({ date: '2026-10-26' })).status, 400); // future
  assert.equal((await p({ date: '2026-09-01' })).status, 400); // older than 30 days
  assert.equal((await p({ minPerKg: 25 })).status, 400); // min above modal
  assert.equal((await p({ mandi: 'chennai' })).status, 400);
  assert.equal((await p({ modalPerKg: 0 })).status, 400);
});

test('a manual price is saved once, marked manual, and becomes real data', async () => {
  const own = await start({ adminToken: TOKEN });
  try {
    const p = () => own.call('POST', '/api/admin/prices', { headers: { 'x-admin-token': TOKEN }, body: { date: TODAY, mandi: 'trichy', crop: 'tomato', minPerKg: 19, modalPerKg: 22, maxPerKg: 24 } });
    assert.equal((await p()).status, 201);
    assert.equal((await p()).status, 409);
    const prices = (await own.call('GET', '/api/prices?crop=tomato')).body;
    assert.equal(prices.dataState.state, 'live');
    assert.equal(prices.ranked[0].origin, 'manual');
    assert.equal(prices.ranked[0].modal, 22);
  } finally { own.server.close(); }
});
