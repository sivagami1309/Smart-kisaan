import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offerVerdict } from '../src/offer.js';
import { smsSegments, parseCode, formatReply } from '../src/sms.js';

test('offer well below the best net price is low, with the total gap', () => {
  const v = offerVerdict(15, 17.22, 500);
  assert.equal(v.kind, 'low');
  assert.equal(v.gapPerKg.toFixed(2), '2.22');
  assert.equal(Math.round(v.gapTotal), 1110);
});

test('offer within 3% below the best is fair; at or above is good', () => {
  assert.equal(offerVerdict(17.0, 17.22, 500).kind, 'fair');
  assert.equal(offerVerdict(17.22, 17.22, 500).kind, 'good');
  assert.equal(offerVerdict(19, 17.22, 500).kind, 'good');
});

test('no verdict for an empty or invalid offer', () => {
  assert.equal(offerVerdict(0, 17.22, 500), null);
  assert.equal(offerVerdict(NaN, 17.22, 500), null);
  assert.equal(offerVerdict(15, null, 500), null);
});

test('SMS segments: 160 per plain-text SMS, 70 per Tamil (Unicode) SMS', () => {
  assert.equal(smsSegments('a'.repeat(160)), 1);
  assert.equal(smsSegments('a'.repeat(161)), 2);
  assert.equal(smsSegments('த'.repeat(70)), 1);
  assert.equal(smsSegments('த'.repeat(71)), 2);
  assert.equal(smsSegments('த'.repeat(135)), 3);
});

test('parses crop codes in any case, ignoring spaces', () => {
  assert.equal(parseCode(' tom '), 'tomato');
  assert.equal(parseCode('GNT'), 'groundnut');
  assert.equal(parseCode('XYZ'), null);
});

const ranked = [
  { mandi: 'trichy', net: 17.224, date: '2026-10-25', freshness: 'today' },
  { mandi: 'manapparai', net: 16.26, date: '2026-10-25', freshness: 'today' },
  { mandi: 'dindigul', net: 16, date: '2026-10-24', freshness: 'stale' },
  { mandi: 'oddanchatram', net: 15.64, date: '2026-10-25', freshness: 'today' },
];

test('Tamil reply lists the top 3 mandis, flags stale dates, marks demo data', () => {
  const r = formatReply({ crop: 'tomato', ranked, today: '2026-10-25', lang: 'ta', demo: true });
  assert.equal(r, 'தக்காளி 25அக் கையில் ₹/கிலோ:\n1.திருச்சி 17.22\n2.மணப்பாறை 16.26\n3.திண்டுக்கல் 16.00(24அக்)\n(மாதிரி)');
});

test('English reply avoids ₹ so it stays one plain-text SMS', () => {
  const r = formatReply({ crop: 'tomato', ranked, today: '2026-10-25', lang: 'en', demo: false });
  assert.equal(r, 'TOMATO 25Oct in hand Rs/kg:\n1.Trichy 17.22\n2.Manapparai 16.26\n3.Dindigul 16.00(24Oct)');
  assert.equal(smsSegments(r), 1);
});

test('reply says so when nothing nearby has a price', () => {
  assert.equal(formatReply({ crop: 'tomato', ranked: [], today: '2026-10-25', lang: 'en' }), 'TOMATO: no price nearby today.');
});
