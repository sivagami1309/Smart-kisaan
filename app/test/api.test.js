import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { openDb, insertRows } from '../src/db.js';
import { seedDemo } from '../src/seed.js';

const TODAY = '2026-10-25';
let server, base, db;

before(async () => {
  db = openDb();
  seedDemo(db, TODAY);
  server = createApp({ db, today: () => TODAY });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const get = async path => { const r = await fetch(base + path); return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() }; };
const post = async (path, data) => { const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }); return { status: r.status, body: await r.json() }; };

test('health reports demo data state', async () => {
  const { status, body } = await get('/api/health');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.today, TODAY);
  assert.equal(body.dataState.state, 'demo');
});

test('crops and places for the pickers', async () => {
  const crops = (await get('/api/crops')).body.crops;
  assert.deepEqual(crops.map(c => c.key), ['tomato', 'onion', 'paddy', 'banana', 'groundnut']);
  assert.equal(crops[0].ta, 'தக்காளி');
  assert.ok((await get('/api/places')).body.places.some(p => p.key === 'manapparai'));
});

test('prices are ranked by net ₹/kg with Tamil names and data state (regression)', async () => {
  const { status, body } = await get('/api/prices?crop=tomato&place=manapparai&radius=100&rate=25&load=500&comm=8');
  assert.equal(status, 200);
  assert.deepEqual(body.ranked.map(r => [r.mandi, r.net.toFixed(2)]),
    [['trichy', '17.22'], ['manapparai', '16.26'], ['dindigul', '16.00'], ['oddanchatram', '15.64']]);
  assert.equal(body.ranked[0].ta, 'திருச்சி');
  assert.equal(body.ranked[2].freshness, 'stale');
  assert.deepEqual(body.missing.map(m => [m.mandi, m.lastModal, m.lastDate]), [['karur', 19.5, '2026-10-22']]);
  assert.equal(body.highestGross, 'oddanchatram');
  assert.equal(body.dataState.state, 'demo');
});

test('uses default costs and radius when none are given', async () => {
  const { body } = await get('/api/prices?crop=tomato');
  assert.deepEqual(body.cost, { rate: 25, load: 500, comm: 8 });
  assert.equal(body.radius, 100);
  assert.equal(body.ranked[0].mandi, 'trichy');
});

test('radius limits the mandis', async () => {
  const { body } = await get('/api/prices?crop=tomato&radius=25');
  assert.deepEqual(body.ranked.map(r => r.mandi), ['manapparai']);
});

test('rejects unknown crops and impossible costs', async () => {
  assert.equal((await get('/api/prices?crop=brinjal')).status, 400);
  assert.equal((await get('/api/prices?crop=tomato&load=0')).status, 400);
  assert.equal((await get('/api/prices?crop=tomato&comm=90')).status, 400);
});

test('7-day trend in ₹/kg for one mandi', async () => {
  const { body } = await get('/api/trend?crop=tomato&mandi=trichy&days=7');
  assert.equal(body.points.length, 7);
  assert.deepEqual(body.points.at(-1), { date: TODAY, modal: 21 });
});

test('offer check compares the trader with the best net price', async () => {
  const { status, body } = await post('/api/offer-check', { crop: 'tomato', offer: 15, qty: 500 });
  assert.equal(status, 200);
  assert.equal(body.verdict.kind, 'low');
  assert.equal(body.verdict.gapPerKg.toFixed(2), '2.22');
  assert.equal(body.best.mandi, 'trichy');
  assert.equal((await post('/api/offer-check', { crop: 'tomato', offer: -1 })).status, 400);
});

test('simulated SMS replies to a crop code and counts segments', async () => {
  const { body } = await post('/api/sms/simulate', { text: ' tom ', lang: 'en' });
  assert.equal(body.simulated, true);
  assert.equal(body.reply, 'TOMATO 25Oct in hand Rs/kg:\n1.Trichy 17.22\n2.Manapparai 16.26\n3.Dindigul 16.00(24Oct)\n(demo)');
  assert.equal(body.segments, 1);
  const help = (await post('/api/sms/simulate', { text: 'hello', lang: 'en' })).body;
  assert.match(help.reply, /TOM/);
});

test('serves the screens and blocks path tricks', async () => {
  const home = await get('/');
  assert.equal(home.status, 200);
  assert.match(home.body, /Smart Kisaan/);
  assert.equal((await get('/results.html')).status, 200);
  assert.equal((await get('/%2e%2e/app/package.json')).status, 404);
  assert.equal((await get('/api/nope')).status, 404);
});

test('live data replaces demo data, and mandis without a live price are listed as missing', async () => {
  const live = openDb();
  seedDemo(live, TODAY);
  insertRows(live, [{ date: TODAY, mandi: 'trichy', crop: 'tomato', minQ: 2000, maxQ: 2400, modalQ: 2200 }], 'live', 'now');
  const s = createApp({ db: live, today: () => TODAY });
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  try {
    const r = await fetch(`http://127.0.0.1:${s.address().port}/api/prices?crop=tomato`);
    const body = await r.json();
    assert.equal(body.dataState.state, 'live');
    assert.deepEqual(body.ranked.map(x => x.mandi), ['trichy']);
    assert.equal(body.missing.length, 4);
    assert.ok(body.missing.every(m => m.lastModal === null));
  } finally {
    s.close();
  }
});

// ---- Bugs found in testing (each written to fail before the fix) ----

test('bug: built-in object names are not valid crops, places or mandis', async () => {
  for (const q of ['crop=__proto__', 'crop=toString', 'crop=tomato&place=constructor', 'crop=tomato&place=__proto__']) {
    assert.equal((await get('/api/prices?' + q)).status, 400, q);
  }
  assert.equal((await get('/api/trend?crop=tomato&mandi=__proto__')).status, 400);
  assert.equal((await post('/api/offer-check', { crop: 'hasOwnProperty', offer: 15 })).status, 400);
});

test('bug: distances are the same in both directions for measured roads', async () => {
  const { body } = await get('/api/prices?crop=tomato&place=trichy');
  assert.equal(body.ranked.find(r => r.mandi === 'manapparai').km, 42);
  assert.equal(body.ranked.find(r => r.mandi === 'trichy').km, 0);
});

test('bug: demo data rolls forward when the server runs past midnight', async () => {
  let day = '2026-10-25';
  const d = openDb();
  seedDemo(d, day);
  const s = createApp({ db: d, today: () => day });
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  try {
    day = '2026-10-26';
    const body = await (await fetch(`http://127.0.0.1:${s.address().port}/api/prices?crop=tomato`)).json();
    assert.equal(body.dataState.asOf, '2026-10-26');
    assert.equal(body.ranked[0].mandi, 'trichy');
    assert.equal(body.ranked[0].freshness, 'today');
  } finally {
    s.close();
  }
});

test('bug: screens answer GET only', async () => {
  const r = await fetch(base + '/login.html', { method: 'POST' });
  assert.equal(r.status, 405);
});
