import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUrl, fetchAll, runIngest } from '../src/ingest.js';
import { openDb, latestByMandi, lastIngestion } from '../src/db.js';
import { RESOURCE_ID } from '../src/config.js';

const record = (market, commodity, modal) => ({
  state: 'Tamil Nadu', district: 'X', market, commodity, variety: 'Other', grade: 'FAQ',
  arrival_date: '25/10/2026', min_price: String(modal - 200), max_price: String(modal + 200), modal_price: String(modal),
});

// A fake data.gov.in: serves pages of records for whichever commodity is asked for
function fakeApi(byCommodity, { status = 200 } = {}) {
  const calls = [];
  const fetchFn = async url => {
    calls.push(url);
    const u = new URL(url);
    const all = byCommodity[u.searchParams.get('filters[commodity]')] || [];
    const offset = Number(u.searchParams.get('offset')), limit = Number(u.searchParams.get('limit'));
    return { ok: status === 200, status, json: async () => ({ records: all.slice(offset, offset + limit) }) };
  };
  return { fetchFn, calls };
}

test('builds the data.gov.in URL with key, state and commodity filters', () => {
  const u = new URL(buildUrl({ apiKey: 'KEY', commodity: 'Tomato', offset: 0, limit: 100 }));
  assert.equal(u.origin + u.pathname, `https://api.data.gov.in/resource/${RESOURCE_ID}`);
  assert.equal(u.searchParams.get('api-key'), 'KEY');
  assert.equal(u.searchParams.get('format'), 'json');
  assert.equal(u.searchParams.get('filters[state]'), 'Tamil Nadu');
  assert.equal(u.searchParams.get('filters[commodity]'), 'Tomato');
});

test('pages through results until a short page', async () => {
  const many = Array.from({ length: 5 }, (_, i) => record('Gandhi Market', 'Tomato', 2000 + i));
  const { fetchFn, calls } = fakeApi({ Tomato: many });
  const recs = await fetchAll({ apiKey: 'K', fetchFn, limit: 2, crops: ['Tomato'] });
  assert.equal(recs.length, 5);
  assert.equal(calls.length, 3);
});

test('ingests, cleans and stores live rows, and logs the run', async () => {
  const { fetchFn } = fakeApi({ Tomato: [record('Gandhi Market', 'Tomato', 2100), record('Madurai', 'Tomato', 2000)] });
  const db = openDb();
  const res = await runIngest({ db, apiKey: 'K', fetchFn, now: '2026-10-25T06:00:00Z' });
  assert.equal(res.ok, true);
  assert.equal(res.inserted, 1);
  assert.deepEqual(res.unmapped, ['Madurai']);
  assert.equal(latestByMandi(db, 'tomato', 'live')[0].modalQ, 2100);
  assert.equal(lastIngestion(db).ok, true);
});

test('a failed API call keeps old data and is logged, not thrown', async () => {
  const { fetchFn } = fakeApi({}, { status: 403 });
  const db = openDb();
  const res = await runIngest({ db, apiKey: 'K', fetchFn, now: '2026-10-25T06:00:00Z' });
  assert.equal(res.ok, false);
  assert.match(res.message, /403/);
  assert.equal(lastIngestion(db).ok, false);
});

test('refuses to run without an API key', async () => {
  const res = await runIngest({ db: openDb(), apiKey: '', fetchFn: async () => { throw new Error('should not fetch'); } });
  assert.equal(res.ok, false);
  assert.match(res.message, /API key/);
});
