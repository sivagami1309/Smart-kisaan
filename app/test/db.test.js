import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, insertRows, latestByMandi, dataState, trend, logIngestion, lastIngestion } from '../src/db.js';
import { seedDemo } from '../src/seed.js';
import { rankMandis } from '../src/netPrice.js';
import { PLACES } from '../src/config.js';

const row = (over = {}) => ({ date: '2026-10-25', mandi: 'trichy', crop: 'tomato', minQ: 1900, maxQ: 2300, modalQ: 2100, ...over });

test('stores rows and never overwrites the same date, mandi and crop', () => {
  const db = openDb();
  assert.equal(insertRows(db, [row()], 'live', '2026-10-25T06:00:00Z'), 1);
  assert.equal(insertRows(db, [row({ modalQ: 9999 })], 'live', '2026-10-25T07:00:00Z'), 0);
  assert.equal(latestByMandi(db, 'tomato', 'live')[0].modalQ, 2100);
});

test('latest price per mandi for one crop and source', () => {
  const db = openDb();
  insertRows(db, [row({ date: '2026-10-24', modalQ: 2000 }), row(), row({ mandi: 'karur', date: '2026-10-22', modalQ: 1950 })], 'live', 'x');
  const latest = latestByMandi(db, 'tomato', 'live');
  assert.equal(latest.length, 2);
  assert.equal(latest.find(r => r.mandi === 'trichy').date, '2026-10-25');
  assert.equal(latest.find(r => r.mandi === 'karur').modalQ, 1950);
});

test('data state: demo with no live rows, live when today’s live data exists, cached when older', () => {
  const db = openDb();
  seedDemo(db, '2026-10-25');
  assert.deepEqual(dataState(db, '2026-10-25'), { state: 'demo', source: 'demo', asOf: '2026-10-25' });
  insertRows(db, [row({ date: '2026-10-23' })], 'live', 'x');
  assert.deepEqual(dataState(db, '2026-10-25'), { state: 'cached', source: 'live', asOf: '2026-10-23' });
  insertRows(db, [row()], 'live', 'x');
  assert.deepEqual(dataState(db, '2026-10-25'), { state: 'live', source: 'live', asOf: '2026-10-25' });
});

test('trend returns the last N days in date order', () => {
  const db = openDb();
  seedDemo(db, '2026-10-25');
  const t = trend(db, 'tomato', 'trichy', 'demo', 7, '2026-10-25');
  assert.equal(t.length, 7);
  assert.equal(t[0].date, '2026-10-19');
  assert.equal(t[6].date, '2026-10-25');
  assert.equal(t[6].modalQ, 2100);
});

test('demo seed reproduces the agreed demo ranking (regression)', () => {
  const db = openDb();
  seedDemo(db, '2026-10-25');
  const latest = latestByMandi(db, 'tomato', 'demo').map(r => ({ ...r, km: PLACES.manapparai.roadKm[r.mandi] }));
  const { ranked, missing, highestGross } = rankMandis(latest, { rate: 25, load: 500, comm: 8 }, 100, '2026-10-25');
  assert.deepEqual(ranked.map(r => [r.mandi, r.net.toFixed(2)]),
    [['trichy', '17.22'], ['manapparai', '16.26'], ['dindigul', '16.00'], ['oddanchatram', '15.64']]);
  assert.deepEqual(missing.map(m => m.mandi), ['karur']);
  assert.equal(highestGross, 'oddanchatram');
});

test('seeding twice adds nothing', () => {
  const db = openDb();
  const first = seedDemo(db, '2026-10-25');
  assert.ok(first > 0);
  assert.equal(seedDemo(db, '2026-10-25'), 0);
});

test('logs ingestion runs and returns the latest one', () => {
  const db = openDb();
  logIngestion(db, { at: '2026-10-25T06:00:00Z', source: 'live', ok: false, inserted: 0, message: 'HTTP 403' });
  logIngestion(db, { at: '2026-10-25T07:00:00Z', source: 'live', ok: true, inserted: 12, message: '' });
  assert.deepEqual(lastIngestion(db), { at: '2026-10-25T07:00:00Z', source: 'live', ok: true, inserted: 12, message: '' });
});
