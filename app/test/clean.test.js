import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDate, normalise, mapMandi, mapCrop, cleanRecords } from '../src/clean.js';

const rec = (over = {}) => ({
  state: 'Tamil Nadu', district: 'Tiruchirappalli', market: 'Gandhi Market', commodity: 'Tomato',
  variety: 'Hybrid', grade: 'FAQ', arrival_date: '25/10/2026', min_price: '1900', max_price: '2300', modal_price: '2100', ...over,
});

test('parses dd/mm/yyyy dates to ISO, rejects nonsense', () => {
  assert.equal(parseDate('25/10/2026'), '2026-10-25');
  assert.equal(parseDate('5/1/2026'), '2026-01-05');
  assert.equal(parseDate('2026-10-25'), '2026-10-25');
  assert.equal(parseDate('31/02/2026'), null);
  assert.equal(parseDate(''), null);
});

test('normalises both key styles the API has used', () => {
  const a = normalise(rec());
  const b = normalise({ State: 'Tamil Nadu', Market: 'Gandhi Market', Commodity: 'Tomato', Arrival_Date: '25/10/2026', Min_x0020_Price: 1900, Max_x0020_Price: 2300, Modal_x0020_Price: 2100 });
  for (const n of [a, b]) {
    assert.equal(n.market, 'Gandhi Market');
    assert.equal(n.date, '2026-10-25');
    assert.equal(n.modalQ, 2100);
    assert.equal(n.minQ, 1900);
  }
});

test('maps feed market names to pilot mandis by name, not district', () => {
  assert.equal(mapMandi('Trichy(Uzhavar Sandhai)'), 'trichy');
  assert.equal(mapMandi('GANDHI MARKET'), 'trichy');
  assert.equal(mapMandi('Manapparai'), 'manapparai');
  assert.equal(mapMandi('Madurai'), null);
});

test('maps commodity names to pilot crops', () => {
  assert.equal(mapCrop('Tomato'), 'tomato');
  assert.equal(mapCrop('Paddy(Dhan)(Common)'), 'paddy');
  assert.equal(mapCrop('Brinjal'), null);
});

test('cleans records into rows and reports unmapped markets', () => {
  const { rows, unmapped } = cleanRecords([rec(), rec({ market: 'Madurai' }), rec({ commodity: 'Brinjal' })]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { date: '2026-10-25', mandi: 'trichy', crop: 'tomato', minQ: 1900, maxQ: 2300, modalQ: 2100 });
  assert.deepEqual(unmapped, ['Madurai']);
});

test('drops zero or missing modal prices instead of storing ₹0', () => {
  const { rows, dropped } = cleanRecords([rec({ modal_price: '0' }), rec({ modal_price: '' })]);
  assert.equal(rows.length, 0);
  assert.equal(dropped.length, 2);
});

test('drops outliers more than 3× from the crop’s median that day', () => {
  const recs = [
    rec(), rec({ market: 'Manapparai', modal_price: '1800' }), rec({ market: 'Dindigul', modal_price: '2000' }),
    rec({ market: 'Karur', modal_price: '21000' }), // unit slip: 10× too high
  ];
  const { rows, dropped } = cleanRecords(recs);
  assert.deepEqual(rows.map(r => r.mandi).sort(), ['dindigul', 'manapparai', 'trichy']);
  assert.equal(dropped[0].reason, 'outlier');
});

test('averages several varieties of one crop at one mandi on one day', () => {
  const { rows } = cleanRecords([rec({ variety: 'Hybrid', modal_price: '2100', min_price: '1900', max_price: '2300' }),
    rec({ variety: 'Local', modal_price: '1900', min_price: '1700', max_price: '2100' })]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].modalQ, 2000);
  assert.equal(rows[0].minQ, 1800);
});

// ---- Lessons from the earlier Smart Kisaan importer ----

test('reads prices written with commas, and treats "NR" as no price', () => {
  const n = normalise(rec({ modal_price: '1,900', min_price: '1,700', max_price: 'NR' }));
  assert.equal(n.modalQ, 1900);
  assert.equal(n.minQ, 1700);
  assert.ok(Number.isNaN(n.maxQ));
});

test('matches crop names by keyword, but keeps small onion separate from onion', () => {
  assert.equal(mapCrop('Banana - Green'), 'banana');
  assert.equal(mapCrop('Groundnut pods (raw)'), 'groundnut');
  assert.equal(mapCrop('Paddy(Dhan)(Basmati)'), 'paddy');
  assert.equal(mapCrop('Onion'), 'onion');
  assert.equal(mapCrop('Small Onion'), null);
  assert.equal(mapCrop('Tomato'), 'tomato');
});
