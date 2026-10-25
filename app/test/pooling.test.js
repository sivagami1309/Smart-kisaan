import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vehicleFor, tripCost, roadKmBetween, splitByQuantity, poolPlan } from '../src/pooling.js';

test('picks the vehicle by load: three-wheeler, pickup, small lorry', () => {
  assert.equal(vehicleFor(300).key, 'three-wheeler');
  assert.equal(vehicleFor(500).key, 'three-wheeler');
  assert.equal(vehicleFor(501).key, 'pickup');
  assert.equal(vehicleFor(1500).key, 'pickup');
  assert.equal(vehicleFor(1501).key, 'lorry');
});

test('trip cost = base + per-km rate, never below the minimum fare', () => {
  assert.equal(tripCost(42, 300), 1006); // 250 + 18 × 42
  assert.equal(tripCost(1, 300), 300); // minimum fare
  assert.equal(tripCost(42, 1000), 1458); // 450 + 24 × 42
  assert.equal(tripCost(10, 2000), 1120); // 800 + 32 × 10
});

test('road distance between pickups = straight line × 1.3, to 0.1 km', () => {
  const a = { lat: 10.6, lon: 78.4 }, b = { lat: 10.645, lon: 78.4 }; // 5.0 km apart
  assert.equal(roadKmBetween(a, b), 6.5);
  assert.equal(roadKmBetween(a, a), 0);
});

test('split by quantity adds up exactly to the paisa', () => {
  assert.deepEqual(splitByQuantity(1000, [300, 700]), [300, 700]);
  const thirds = splitByQuantity(100, [1, 1, 1]);
  assert.deepEqual(thirds, [33.34, 33.33, 33.33]);
  assert.equal(Math.round(thirds.reduce((a, b) => a + b, 0) * 100), 10000);
  const odd = splitByQuantity(1177, [137, 251, 89]);
  assert.equal(Math.round(odd.reduce((a, b) => a + b, 0) * 100), 117700);
});

test('split refuses an empty load', () => {
  assert.throws(() => splitByQuantity(100, [0, 0]), RangeError);
});

const farmerA = { id: 'a', qtyKg: 300, kmToMandi: 42, lat: 10.6, lon: 78.4 };
const farmerB = { id: 'b', qtyKg: 200, kmToMandi: 45, lat: 10.645, lon: 78.4 };

test('pool plan: one trip from the farthest farmer plus the pickup detour', () => {
  const p = poolPlan([farmerA, farmerB]);
  assert.equal(p.totalKg, 500);
  assert.equal(p.tripKm, 51.5); // 45 + 6.5
  assert.equal(p.vehicle.key, 'three-wheeler');
  assert.equal(p.sharedCost, 1177); // 250 + 18 × 51.5
});

test('pool plan: fair shares, solo costs and each farmer’s saving', () => {
  const p = poolPlan([farmerA, farmerB]);
  const a = p.members.find(m => m.id === 'a'), b = p.members.find(m => m.id === 'b');
  assert.equal(a.sharePct, 60);
  assert.equal(a.sharedPart, 706.2);
  assert.equal(b.sharedPart, 470.8);
  assert.equal(a.soloCost, 1006);
  assert.equal(b.soloCost, 1060);
  assert.equal(a.benefit, 299.8);
  assert.equal(b.benefit, 589.2);
  assert.equal(p.everyoneGains, true);
  assert.equal(p.totalSaving, 889);
});

test('pool plan: a heavier combined load moves up to a bigger vehicle', () => {
  const p = poolPlan([{ ...farmerA, qtyKg: 400 }, { ...farmerB, qtyKg: 300 }]);
  assert.equal(p.vehicle.key, 'pickup');
});

test('pool plan flags when a long detour means someone would lose', () => {
  const far = { ...farmerB, lat: 10.6 + 0.27 }; // ~30 km apart: detour ~39 km
  assert.equal(poolPlan([farmerA, far]).everyoneGains, false);
});

test('pool plan needs at least two farmers', () => {
  assert.throws(() => poolPlan([farmerA]), RangeError);
});
