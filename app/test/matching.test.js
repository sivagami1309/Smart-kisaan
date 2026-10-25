import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findMatches } from '../src/matching.js';

const L = (over) => ({ id: 'x', farmer: 'fx', crop: 'tomato', mandi: 'trichy', qtyKg: 300, kmToMandi: 42, lat: 10.6, lon: 78.4, willing: true, status: 'open', ...over });
const mine = L({ id: 'mine', farmer: 'me' });

test('matches nearby, willing, open farmers with the same crop and mandi, best saving first', () => {
  const others = [
    L({ id: 'near', farmer: 'f1', qtyKg: 200, kmToMandi: 45, lat: 10.645 }), // 6.5 km
    L({ id: 'nearer', farmer: 'f2', qtyKg: 400, kmToMandi: 43, lat: 10.62 }), // 2.9 km
  ];
  const m = findMatches(mine, others);
  assert.deepEqual(m.map(x => x.listing.id), ['nearer', 'near']);
  assert.ok(m[0].myBenefit > m[1].myBenefit);
  assert.ok(m.every(x => x.plan.everyoneGains));
  assert.equal(m[1].distanceKm, 6.5);
});

test('skips other crops, other mandis, unwilling, closed, own listings and the same farmer', () => {
  const others = [
    L({ id: 'onion', crop: 'onion' }),
    L({ id: 'dindigul', mandi: 'dindigul' }),
    L({ id: 'unwilling', willing: false }),
    L({ id: 'pooled', status: 'pooled' }),
    L({ id: 'mine' }),
    L({ id: 'mine-too', farmer: 'me' }),
  ];
  assert.deepEqual(findMatches(mine, others), []);
});

test('skips farmers more than 10 km away', () => {
  assert.deepEqual(findMatches(mine, [L({ id: 'far', farmer: 'f', lat: 10.7 })]), []); // ~14 km by road
});

test('never suggests a pool where either farmer would lose', () => {
  // Tiny loads near the minimum fare: sharing cannot beat going alone for one of them
  const small = L({ id: 'small', farmer: 'me', qtyKg: 20, kmToMandi: 2 });
  const other = L({ id: 'o', farmer: 'f', qtyKg: 480, kmToMandi: 9, lat: 10.66 });
  assert.deepEqual(findMatches(small, [other]), []);
});

test('an unwilling or closed listing gets no matches at all', () => {
  const others = [L({ id: 'n', farmer: 'f1', lat: 10.62 })];
  assert.deepEqual(findMatches({ ...mine, willing: false }, others), []);
  assert.deepEqual(findMatches({ ...mine, status: 'pooled' }, others), []);
});
