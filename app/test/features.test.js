import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profitFor } from '../src/profit.js';
import { parseVoice, hrefFor } from '../src/voice.js';
import { createWeather, WeatherError } from '../src/weather.js';

// ---------- Profit ----------

test('profit: gross − transport − commission − loading − other, and per kg', () => {
  const p = profitFor({ qtyKg: 300, pricePerKg: 21, transport: 1006, commissionPct: 8, loading: 150, other: 0 });
  assert.equal(p.gross, 6300);
  assert.equal(p.commission, 504);
  assert.equal(p.costs, 1660);
  assert.equal(p.net, 4640);
  assert.equal(p.netPerKg, 15.47);
});

test('profit: rounds to the paisa and allows a loss to show as negative', () => {
  const p = profitFor({ qtyKg: 33, pricePerKg: 9.99, transport: 400, commissionPct: 2.5 });
  assert.equal(p.gross, 329.67);
  assert.equal(p.commission, 8.24);
  assert.equal(p.net, -78.57);
});

test('profit: refuses impossible inputs', () => {
  assert.throws(() => profitFor({ qtyKg: 0, pricePerKg: 20, transport: 0, commissionPct: 0 }), RangeError);
  assert.throws(() => profitFor({ qtyKg: 10, pricePerKg: 0, transport: 0, commissionPct: 0 }), RangeError);
  assert.throws(() => profitFor({ qtyKg: 10, pricePerKg: 20, transport: -5, commissionPct: 0 }), RangeError);
  assert.throws(() => profitFor({ qtyKg: 10, pricePerKg: 20, transport: 0, commissionPct: 40 }), RangeError);
});

// ---------- Voice ----------

test('voice: a crop name opens that crop’s prices, in Tamil or English', () => {
  assert.deepEqual(parseVoice('தக்காளி விலை'), { type: 'crop-prices', crop: 'tomato' });
  assert.deepEqual(parseVoice('Onion price today'), { type: 'crop-prices', crop: 'onion' });
  assert.deepEqual(parseVoice('கடலை'), { type: 'crop-prices', crop: 'groundnut' });
  assert.deepEqual(parseVoice('rice rate'), { type: 'crop-prices', crop: 'paddy' });
});

test('voice: English words match whole words only ("price" is not "rice")', () => {
  assert.deepEqual(parseVoice('what is the price today'), { type: 'none' });
  assert.deepEqual(parseVoice('show me the homepage'), { type: 'none' });
});

test('voice: small onion is not onion', () => {
  assert.deepEqual(parseVoice('சின்ன வெங்காயம் விலை'), { type: 'none' });
  assert.deepEqual(parseVoice('small onion price'), { type: 'none' });
});

test('voice: action words', () => {
  assert.equal(parseVoice('அருகிலுள்ள சந்தை').type, 'nearby');
  assert.equal(parseVoice('நாளை மழை வருமா').type, 'weather');
  assert.equal(parseVoice('லாபம் கணக்கு').type, 'profit');
  assert.equal(parseVoice('சேர்ந்து அனுப்பணும்').type, 'together');
  assert.equal(parseVoice('my sales').type, 'sales');
  assert.equal(parseVoice('farming tips').type, 'tips');
  assert.equal(parseVoice('முகப்பு').type, 'home');
  assert.deepEqual(parseVoice('   '), { type: 'none' });
  assert.deepEqual(parseVoice('hello there'), { type: 'none' });
});

test('voice: an action word wins over a crop name, and the crop is kept', () => {
  assert.deepEqual(parseVoice('தக்காளி லாபம்'), { type: 'profit', crop: 'tomato' });
  assert.deepEqual(parseVoice('tomato sell together'), { type: 'together', crop: 'tomato' });
});

test('voice: each command has a screen to open', () => {
  assert.equal(hrefFor({ type: 'crop-prices', crop: 'tomato' }), 'results.html?crop=tomato');
  assert.equal(hrefFor({ type: 'profit', crop: 'onion' }), 'profit.html?crop=onion');
  assert.equal(hrefFor({ type: 'nearby' }), 'markets.html');
  assert.equal(hrefFor({ type: 'none' }), null);
});

// ---------- Weather ----------

const sample = { current: { temperature_2m: 31.2 }, daily: { time: ['2026-10-25'], temperature_2m_max: [33] } };
function fakeFetch({ ok = true, body = sample } = {}) {
  const calls = [];
  return { calls, fetchFn: async url => { calls.push(url); return { ok, status: ok ? 200 : 502, json: async () => body }; } };
}

test('weather: asks Open-Meteo with rounded coordinates and returns the source', async () => {
  const { calls, fetchFn } = fakeFetch();
  const w = createWeather({ fetchFn, now: () => 0 });
  const r = await w.get(10.60712, 78.42549);
  const u = new URL(calls[0]);
  assert.equal(u.origin + u.pathname, 'https://api.open-meteo.com/v1/forecast');
  assert.equal(u.searchParams.get('latitude'), '10.61');
  assert.equal(u.searchParams.get('longitude'), '78.43');
  assert.equal(u.searchParams.get('timezone'), 'Asia/Kolkata');
  assert.equal(r.source, 'Open-Meteo (open-meteo.com)');
  assert.equal(r.current.temperature_2m, 31.2);
});

test('weather: one fetch per place per hour', async () => {
  let t = 0;
  const { calls, fetchFn } = fakeFetch();
  const w = createWeather({ fetchFn, now: () => t });
  await w.get(10.6, 78.4);
  t = 59 * 60e3; await w.get(10.6, 78.4);
  assert.equal(calls.length, 1);
  t = 61 * 60e3; await w.get(10.6, 78.4);
  assert.equal(calls.length, 2);
});

test('weather: only places inside India', async () => {
  const w = createWeather({ fetchFn: fakeFetch().fetchFn });
  await assert.rejects(w.get(51.5, -0.1), e => e instanceof WeatherError && e.status === 400);
});

test('weather: a failure or empty answer is “unavailable”, never invented numbers', async () => {
  await assert.rejects(createWeather({ fetchFn: fakeFetch({ ok: false }).fetchFn }).get(10.6, 78.4), e => e.status === 503);
  await assert.rejects(createWeather({ fetchFn: fakeFetch({ body: {} }).fetchFn }).get(10.6, 78.4), e => e.status === 503);
  await assert.rejects(createWeather({ fetchFn: async () => { throw new Error('offline'); } }).get(10.6, 78.4), e => e.status === 503);
});
