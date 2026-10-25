import { test } from 'node:test';
import assert from 'node:assert/strict';
import { perKg, netPrice, ageDays, freshness, rankMandis } from '../src/netPrice.js';

const COST = { rate: 25, load: 500, comm: 8 };
const close = (a, b) => assert.ok(Math.abs(a - b) < 0.005, `${a} ≈ ${b}`);

test('converts ₹ per quintal to ₹ per kg', () => {
  assert.equal(perKg(2000), 20);
  assert.equal(perKg(2150), 21.5);
});

test('net price = modal − transport − commission (PRD FR7)', () => {
  const n = netPrice(2100, 42, COST);
  close(n.modal, 21);
  close(n.transport, 2.1);
  close(n.commission, 1.68);
  close(n.net, 17.22);
});

test('rejects a load of zero or less', () => {
  assert.throws(() => netPrice(2000, 10, { ...COST, load: 0 }), RangeError);
});

test('age in whole days between price date and today', () => {
  assert.equal(ageDays('2026-10-25', '2026-10-25'), 0);
  assert.equal(ageDays('2026-10-24', '2026-10-25'), 1);
  assert.equal(ageDays('2026-10-22', '2026-10-25'), 3);
});

test('freshness: today, stale (1 day) or missing (older) (PRD FR8)', () => {
  assert.equal(freshness(0), 'today');
  assert.equal(freshness(1), 'stale');
  assert.equal(freshness(2), 'missing');
});

const rows = [
  { mandi: 'trichy', km: 42, modalQ: 2100, minQ: 1900, maxQ: 2300, date: '2026-10-25' },
  { mandi: 'manapparai', km: 6, modalQ: 1800, minQ: 1600, maxQ: 2000, date: '2026-10-25' },
  { mandi: 'dindigul', km: 48, modalQ: 2000, minQ: 1800, maxQ: 2200, date: '2026-10-24' },
  { mandi: 'oddanchatram', km: 92, modalQ: 2200, minQ: 2000, maxQ: 2400, date: '2026-10-25' },
  { mandi: 'karur', km: 70, modalQ: 1950, minQ: 1800, maxQ: 2100, date: '2026-10-22' },
];

test('ranks by net price, highest first, not by mandi price', () => {
  const { ranked } = rankMandis(rows, COST, 100, '2026-10-25');
  assert.deepEqual(ranked.map(r => r.mandi), ['trichy', 'manapparai', 'dindigul', 'oddanchatram']);
  close(ranked[0].net, 17.22);
  close(ranked[3].net, 15.64);
});

test('flags a 1-day-old price as stale but still ranks it', () => {
  const { ranked } = rankMandis(rows, COST, 100, '2026-10-25');
  assert.equal(ranked.find(r => r.mandi === 'dindigul').freshness, 'stale');
  assert.equal(ranked.find(r => r.mandi === 'trichy').freshness, 'today');
});

test('older prices are listed as missing with their last price, never ₹0', () => {
  const { ranked, missing } = rankMandis(rows, COST, 100, '2026-10-25');
  assert.ok(!ranked.some(r => r.mandi === 'karur'));
  assert.equal(missing.length, 1);
  assert.equal(missing[0].mandi, 'karur');
  close(missing[0].lastModal, 19.5);
  assert.equal(missing[0].lastDate, '2026-10-22');
});

test('a mandi with no price at all is missing with no last price', () => {
  const { ranked, missing } = rankMandis([{ mandi: 'x', km: 10, modalQ: null, date: null }], COST, 100, '2026-10-25');
  assert.equal(ranked.length, 0);
  assert.equal(missing[0].lastModal, null);
});

test('radius filter keeps only mandis within reach', () => {
  const { ranked, missing } = rankMandis(rows, COST, 25, '2026-10-25');
  assert.deepEqual(ranked.map(r => r.mandi), ['manapparai']);
  assert.equal(missing.length, 0);
});

test('names the highest-mandi-price row when it is not the best in hand', () => {
  const { highestGross } = rankMandis(rows, COST, 100, '2026-10-25');
  assert.equal(highestGross, 'oddanchatram');
  assert.equal(rankMandis(rows, COST, 25, '2026-10-25').highestGross, null);
});
