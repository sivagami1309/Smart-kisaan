import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newPool, act, ActionError } from '../src/consent.js';

const AT = '2026-10-25T06:00:00Z';
const two = () => newPool({ members: ['a', 'b'], proposer: 'a', at: AT });
const fails = (fn, code) => assert.throws(fn, e => e instanceof ActionError && e.code === code);

test('a new pool is PROPOSED with the proposer’s consent', () => {
  const p = two();
  assert.equal(p.state, 'PROPOSED');
  assert.deepEqual(p.consents, ['a']);
  assert.deepEqual(p.events.map(e => [e.actor, e.action]), [['a', 'propose']]);
});

test('the proposer must be a member, and a pool needs two different farmers', () => {
  fails(() => newPool({ members: ['a', 'b'], proposer: 'c', at: AT }), 'not_member');
  fails(() => newPool({ members: ['a', 'a'], proposer: 'a', at: AT }), 'too_few');
});

test('confirmed only when every member has consented', () => {
  const p3 = newPool({ members: ['a', 'b', 'c'], proposer: 'a', at: AT });
  const afterB = act(p3, 'b', 'accept', {}, AT);
  assert.equal(afterB.state, 'PROPOSED');
  assert.equal(act(afterB, 'c', 'accept', {}, AT).state, 'CONFIRMED');
  assert.equal(act(two(), 'b', 'accept', {}, AT).state, 'CONFIRMED');
});

test('consenting twice changes nothing (one farmer cannot count twice)', () => {
  const p3 = newPool({ members: ['a', 'b', 'c'], proposer: 'a', at: AT });
  const again = act(p3, 'a', 'accept', {}, AT);
  assert.equal(again.state, 'PROPOSED');
  assert.deepEqual(again.consents, ['a']);
  assert.equal(again.events.length, 1);
});

test('only members can act', () => {
  fails(() => act(two(), 'x', 'accept', {}, AT), 'not_member');
});

test('the full journey: confirmed → transport → sold → completed', () => {
  let p = act(two(), 'b', 'accept', {}, AT);
  p = act(p, 'a', 'arrange', { vehicle: 'three-wheeler' }, AT);
  assert.equal(p.state, 'TRANSPORT_ARRANGED');
  p = act(p, 'b', 'sold', { pricePerKg: 18.5 }, AT);
  assert.equal(p.state, 'SOLD');
  assert.equal(p.soldPricePerKg, 18.5);
  p = act(p, 'a', 'complete', {}, AT);
  assert.equal(p.state, 'COMPLETED');
  assert.deepEqual(p.events.map(e => e.action), ['propose', 'accept', 'arrange', 'sold', 'complete']);
});

test('steps cannot be skipped', () => {
  fails(() => act(two(), 'a', 'arrange', {}, AT), 'invalid_action');
  fails(() => act(act(two(), 'b', 'accept', {}, AT), 'a', 'sold', { pricePerKg: 18 }, AT), 'invalid_action');
});

test('a sale needs a real price', () => {
  const ready = act(act(two(), 'b', 'accept', {}, AT), 'a', 'arrange', {}, AT);
  fails(() => act(ready, 'a', 'sold', { pricePerKg: 0 }, AT), 'bad_price');
  fails(() => act(ready, 'a', 'sold', {}, AT), 'bad_price');
});

test('any member can decline before the sale; not after', () => {
  assert.equal(act(two(), 'b', 'decline', {}, AT).state, 'CANCELLED');
  const confirmed = act(two(), 'b', 'accept', {}, AT);
  assert.equal(act(confirmed, 'a', 'decline', {}, AT).state, 'CANCELLED');
  const sold = act(act(confirmed, 'a', 'arrange', {}, AT), 'a', 'sold', { pricePerKg: 18 }, AT);
  fails(() => act(sold, 'b', 'decline', {}, AT), 'invalid_action');
});

test('nothing happens after cancelled or completed, and unknown actions are refused', () => {
  const cancelled = act(two(), 'b', 'decline', {}, AT);
  fails(() => act(cancelled, 'b', 'accept', {}, AT), 'invalid_action');
  fails(() => act(two(), 'a', 'teleport', {}, AT), 'unknown_action');
});

test('acting never changes the pool it was given', () => {
  const p = two();
  act(p, 'b', 'accept', {}, AT);
  assert.equal(p.state, 'PROPOSED');
  assert.deepEqual(p.consents, ['a']);
});
