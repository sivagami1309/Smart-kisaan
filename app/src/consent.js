// Consent workflow for a shared sale. Pure functions: act() returns a new pool and never edits the old one.
// PROPOSED → CONFIRMED (all consented) → TRANSPORT_ARRANGED → SOLD → COMPLETED; decline before SOLD → CANCELLED.

export class ActionError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const NEXT = {
  arrange: { from: 'CONFIRMED', to: 'TRANSPORT_ARRANGED' },
  sold: { from: 'TRANSPORT_ARRANGED', to: 'SOLD' },
  complete: { from: 'SOLD', to: 'COMPLETED' },
};
const DECLINABLE = ['PROPOSED', 'CONFIRMED', 'TRANSPORT_ARRANGED'];

export function newPool({ members, proposer, at }) {
  const unique = [...new Set(members)];
  if (unique.length < 2) throw new ActionError('too_few', 'a pool needs at least two different farmers');
  if (!unique.includes(proposer)) throw new ActionError('not_member', 'only a member can propose');
  return { state: 'PROPOSED', members: unique, consents: [proposer], soldPricePerKg: null, events: [{ at, actor: proposer, action: 'propose' }] };
}

export function act(pool, actor, action, payload = {}, at) {
  if (!pool.members.includes(actor)) throw new ActionError('not_member', 'only members of this pool can act');
  const done = (changes, detail) => ({ ...pool, ...changes, events: [...pool.events, { at, actor, action, ...(detail ? { detail } : {}) }] });

  if (action === 'accept') {
    if (pool.state !== 'PROPOSED') throw new ActionError('invalid_action', `cannot accept when ${pool.state}`);
    if (pool.consents.includes(actor)) return pool; // already consented: no change, no event
    const consents = [...pool.consents, actor];
    return done({ consents, state: consents.length === pool.members.length ? 'CONFIRMED' : 'PROPOSED' });
  }
  if (action === 'decline') {
    if (!DECLINABLE.includes(pool.state)) throw new ActionError('invalid_action', `cannot decline when ${pool.state}`);
    return done({ state: 'CANCELLED' });
  }
  const step = NEXT[action];
  if (!step) throw new ActionError('unknown_action', `unknown action: ${action}`);
  if (pool.state !== step.from) throw new ActionError('invalid_action', `cannot ${action} when ${pool.state}`);
  if (action === 'sold') {
    const price = Number(payload.pricePerKg);
    if (!(price > 0)) throw new ActionError('bad_price', 'sale needs a price per kg above 0');
    return done({ state: step.to, soldPricePerKg: price }, `₹${price}/kg`);
  }
  return done({ state: step.to }, payload.vehicle ?? undefined);
}
