// Smart Kisaan server: JSON API (PRD §8) + the frontend screens, using only Node built-ins.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CROPS, MANDIS, PLACES, DEFAULT_COST } from './config.js';
import { rankMandis, perKg } from './netPrice.js';
import { openDb, latestByMandi, dataState, trend, lastIngestion } from './db.js';
import { seedDemo } from './seed.js';
import { offerVerdict } from './offer.js';
import { smsSegments, parseCode, formatReply } from './sms.js';
import { runIngest } from './ingest.js';
import { ApiError, createListing, listingsOf, matchesFor, proposePool, getPoolFor, poolAction, seedDemoNeighbours } from './together.js';
import { recordSale, salesOf } from './sales.js';
import { notificationsOf, markRead } from './notifications.js';
import { profitFor } from './profit.js';
import { parseVoice, hrefFor } from './voice.js';
import { createWeather, WeatherError } from './weather.js';
import { vehicleFor, tripCost } from './pooling.js';
import { checkAdmin, adminSummary, adminFarmers, adminPools, addManualPrice } from './admin.js';
import { FRONTEND_DIR, dbPath, localToday, loadEnv } from './paths.js';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };

class BadRequest extends Error {}

// Only a config table's own keys count: "__proto__" or "toString" must not look like a crop
const has = (table, key) => typeof key === 'string' && Object.hasOwn(table, key);

// Measured road distance (either direction), else straight line × 1.3
function distanceKm(placeKey, mandiKey) {
  const p = PLACES[placeKey], m = MANDIS[mandiKey];
  const road = p.roadKm?.[mandiKey] ?? (has(PLACES, mandiKey) ? PLACES[mandiKey].roadKm?.[placeKey] : undefined);
  if (road != null) return road;
  const rad = x => (x * Math.PI) / 180;
  const a = Math.sin(rad(m.lat - p.lat) / 2) ** 2 + Math.cos(rad(p.lat)) * Math.cos(rad(m.lat)) * Math.sin(rad(m.lon - p.lon) / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.sqrt(a)) * 1.3);
}

function readOptions(q) {
  const crop = q.crop ?? 'tomato';
  if (!has(CROPS, crop)) throw new BadRequest(`unknown crop: ${crop}`);
  const place = q.place ?? 'manapparai';
  if (!has(PLACES, place)) throw new BadRequest(`unknown place: ${place}`);
  const numberIn = (name, min, max, dflt) => {
    if (q[name] == null || q[name] === '') return dflt;
    const v = Number(q[name]);
    if (!Number.isFinite(v) || v < min || v > max) throw new BadRequest(`${name} must be between ${min} and ${max}`);
    return v;
  };
  return {
    crop, place,
    radius: numberIn('radius', 1, 500, 100),
    cost: { rate: numberIn('rate', 0, 500, DEFAULT_COST.rate), load: numberIn('load', 10, 20000, DEFAULT_COST.load), comm: numberIn('comm', 0, 30, DEFAULT_COST.comm) },
  };
}

function prices(db, today, o) {
  const ds = dataState(db, today);
  const latest = new Map(latestByMandi(db, o.crop, ds.source).map(r => [r.mandi, r]));
  // Every pilot mandi appears: with its latest price, or as missing
  const rows = Object.keys(MANDIS).map(m => ({ mandi: m, km: distanceKm(o.place, m), ...(latest.get(m) || { modalQ: null, date: null }) }));
  const { ranked, missing, highestGross } = rankMandis(rows, o.cost, o.radius, today);
  const names = r => ({ ...r, ta: MANDIS[r.mandi].ta, en: MANDIS[r.mandi].en, lat: MANDIS[r.mandi].lat, lon: MANDIS[r.mandi].lon });
  return { ...o, today, dataState: ds, ranked: ranked.map(names), missing: missing.map(names), highestGross };
}

// Profit for one sale: today's mandi price and an estimated vehicle unless the farmer gives their own
function profitView(db, today, q) {
  const o = readOptions({ crop: q.crop, place: q.place });
  if (!has(MANDIS, q.mandi)) throw new BadRequest(`unknown mandi: ${q.mandi}`);
  const num = (name, dflt) => (q[name] == null || q[name] === '' ? dflt : Number(q[name]));
  const qtyKg = num('qtyKg', NaN);
  if (!(qtyKg >= 10 && qtyKg <= 20000)) throw new BadRequest('quantity must be between 10 and 20,000 kg');
  const km = distanceKm(o.place, q.mandi);
  const v = vehicleFor(qtyKg);
  const transportEstimate = { km, cost: tripCost(km, qtyKg), vehicle: { key: v.key, ta: v.ta, en: v.en } };
  let pricePerKg = num('pricePerKg', null), priceFrom = null;
  if (pricePerKg == null) {
    const row = latestByMandi(db, o.crop, dataState(db, today).source).find(r => r.mandi === q.mandi);
    if (!row) throw new BadRequest('no price for this mandi yet: enter your own price');
    pricePerKg = perKg(row.modalQ);
    priceFrom = { date: row.date, origin: row.origin };
  }
  const transport = num('transport', transportEstimate.cost);
  let profit;
  try {
    profit = profitFor({ qtyKg, pricePerKg, transport, commissionPct: num('commissionPct', 8), loading: num('loading', 0), other: num('other', 0) });
  } catch (e) { throw new BadRequest(e.message); }
  return { crop: o.crop, mandi: q.mandi, place: o.place, qtyKg, pricePerKg, priceFrom, transportEstimate, profit };
}

async function readJson(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 10_000) throw new BadRequest('body too large'); chunks.push(c); }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw new ApiError(400, 'bad_body', 'invalid JSON'); }
  // Handlers read fields from an object; null, arrays, strings and numbers are refused here
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'bad_body', 'request body must be a JSON object');
  return body;
}

export function createApp({ db, today = localToday, frontendDir = FRONTEND_DIR, weather = createWeather(), adminToken = process.env.SK_ADMIN_TOKEN || '' }) {
  const root = resolve(frontendDir);

  // Demo history is dated relative to "today"; when the date changes (server left running
  // past midnight), extend it so demo prices don't all turn stale. Live data is never touched.
  let demoDay = null;
  function rollDemo() {
    const t = today();
    if (t === demoDay) return;
    if (dataState(db, t).source === 'demo') seedDemo(db, t);
    demoDay = t;
  }

  const routes = {
    'GET /api/health': () => ({ ok: true, today: today(), dataState: dataState(db, today()), lastIngestion: lastIngestion(db) }),
    'GET /api/crops': () => ({ crops: Object.entries(CROPS).map(([key, c]) => ({ key, ta: c.ta, en: c.en, ico: c.ico, code: c.code })) }),
    'GET /api/places': () => ({ places: Object.entries(PLACES).map(([key, p]) => ({ key, ta: p.ta, en: p.en })) }),
    'GET /api/prices': q => prices(db, today(), readOptions(q)),
    'GET /api/trend': q => {
      const { crop } = readOptions(q);
      if (!has(MANDIS, q.mandi)) throw new BadRequest(`unknown mandi: ${q.mandi}`);
      const days = Math.min(30, Math.max(2, Number(q.days) || 7));
      const ds = dataState(db, today());
      return { crop, mandi: q.mandi, dataState: ds, points: trend(db, crop, q.mandi, ds.source, days, today()).map(p => ({ date: p.date, modal: perKg(p.modalQ) })) };
    },
    'POST /api/offer-check': (_, body) => {
      const o = readOptions(body);
      const offer = Number(body.offer);
      if (!(offer > 0)) throw new BadRequest('offer must be a price above 0');
      const p = prices(db, today(), o);
      const best = p.ranked[0] ?? null;
      return { crop: o.crop, offer, qty: Number(body.qty) || 0, best, verdict: offerVerdict(offer, best?.net, Number(body.qty) || 0), dataState: p.dataState };
    },
    'GET /api/profit': q => profitView(db, today(), q),
    'GET /api/voice': q => { const command = parseVoice(q.text); return { command, href: hrefFor(command) }; },
    'GET /api/markets': q => {
      const place = q.place ?? 'manapparai';
      if (!has(PLACES, place)) throw new BadRequest(`unknown place: ${place}`);
      const markets = Object.entries(MANDIS).map(([key, m]) => ({ key, ta: m.ta, en: m.en, lat: m.lat, lon: m.lon, km: distanceKm(place, key) }));
      return { place, markets: markets.sort((a, b) => a.km - b.km) };
    },
    'GET /api/board': q => {
      const crops = Object.entries(CROPS).map(([crop, c]) => {
        const p = prices(db, today(), readOptions({ ...q, crop }));
        const b = p.ranked[0];
        return { crop, ta: c.ta, en: c.en, ico: c.ico, best: b ? { mandi: b.mandi, ta: b.ta, en: b.en, net: b.net, modal: b.modal, date: b.date, freshness: b.freshness, origin: b.origin } : null };
      });
      return { today: today(), dataState: dataState(db, today()), crops };
    },
    'GET /api/weather': async q => {
      const place = q.place ?? 'manapparai';
      if (!has(PLACES, place)) throw new BadRequest(`unknown place: ${place}`);
      try {
        return { place, ...(await weather.get(PLACES[place].lat, PLACES[place].lon)) };
      } catch (e) {
        if (e instanceof WeatherError) throw new ApiError(e.status, e.status === 503 ? 'weather_unavailable' : 'bad_place', e.message);
        throw e;
      }
    },
    'POST /api/sms/simulate': (_, body) => {
      const lang = body.lang === 'en' ? 'en' : 'ta';
      const crop = parseCode(body.text);
      let reply;
      if (!crop) {
        reply = lang === 'ta'
          ? 'பயிர் குறியீட்டை அனுப்புங்கள்:\nTOM தக்காளி · ONI வெங்காயம்\nPAD நெல் · BAN வாழை · GNT நிலக்கடலை'
          : 'Send a crop code:\nTOM tomato, ONI onion, PAD paddy, BAN banana, GNT groundnut';
      } else {
        const p = prices(db, today(), readOptions({ ...body, crop }));
        reply = formatReply({ crop, ranked: p.ranked, today: today(), lang, demo: p.dataState.state === 'demo' });
      }
      return { simulated: true, crop, reply, chars: reply.length, segments: smsSegments(reply) };
    },
  };

  // Sell together. Prototype identity: a random id kept on the farmer's phone (see SELL_TOGETHER_DESIGN.md)
  const farmerOf = req => {
    const id = req.headers['x-farmer-id'];
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) throw new ApiError(401, 'no_farmer', 'missing farmer id');
    return id;
  };
  const now = () => new Date().toISOString();
  const together = {
    'POST /api/listings': (req, _, body) => ({ __status: 201, listing: createListing(db, farmerOf(req), body, now()) }),
    'GET /api/listings/mine': req => ({ listings: listingsOf(db, farmerOf(req)) }),
    'GET /api/matches': (req, q) => ({ matches: matchesFor(db, farmerOf(req), q.listing) }),
    'POST /api/pools': (req, _, body) => ({ __status: 201, pool: proposePool(db, farmerOf(req), body.listings, now()) }),
    'POST /api/sales': (req, _, body) => { recordSale(db, farmerOf(req), body, today(), now()); return { __status: 201, ok: true }; },
    'GET /api/sales': req => salesOf(db, farmerOf(req)),
    'GET /api/notifications': req => notificationsOf(db, farmerOf(req)),
    'POST /api/notifications/read': (req, _, body) => ({ unread: markRead(db, farmerOf(req), body.ids) }),
    'GET /api/admin/summary': req => { checkAdmin(req, adminToken); return adminSummary(db, today()); },
    'GET /api/admin/farmers': req => { checkAdmin(req, adminToken); return { farmers: adminFarmers(db) }; },
    'GET /api/admin/pools': req => { checkAdmin(req, adminToken); return { pools: adminPools(db) }; },
    'POST /api/admin/prices': (req, _, body) => { checkAdmin(req, adminToken); addManualPrice(db, body, today(), now()); return { __status: 201, ok: true }; },
  };
  const poolRoute = (method, pathname) => {
    const m = pathname.match(/^\/api\/pools\/([0-9a-f-]{36})(\/action)?$/);
    if (!m) return null;
    if (method === 'GET' && !m[2]) return req => ({ pool: getPoolFor(db, farmerOf(req), m[1]) });
    if (method === 'POST' && m[2]) return (req, _, body) => ({ pool: poolAction(db, farmerOf(req), m[1], body, now()) });
    return null;
  };

  async function serveStatic(pathname, res) {
    let rel;
    try { rel = decodeURIComponent(pathname); } catch { rel = ''; }
    if (rel === '/' || rel === '') rel = '/login.html';
    const file = resolve(join(root, rel));
    if (!file.startsWith(root + sep)) return send(res, 404, { error: 'not found' });
    try {
      const data = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(data);
    } catch {
      send(res, 404, { error: 'not found' });
    }
  }

  function send(res, status, obj) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(obj));
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method not allowed' });
        return await serveStatic(url.pathname, res);
      }
      rollDemo();
      const key = `${req.method} ${url.pathname}`;
      const query = Object.fromEntries(url.searchParams);
      const body = req.method === 'POST' ? await readJson(req) : {};
      if (routes[key]) return send(res, 200, await routes[key](query, body));
      const own = together[key] ?? poolRoute(req.method, url.pathname);
      if (!own) return send(res, 404, { error: 'not found' });
      const { __status = 200, ...out } = own(req, query, body);
      send(res, __status, out);
    } catch (e) {
      if (e instanceof BadRequest) send(res, 400, { error: e.message });
      else if (e instanceof ApiError) send(res, e.status, { error: e.message, code: e.code });
      else { console.error(e); send(res, 500, { error: 'server error' }); }
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadEnv();
  const db = openDb(dbPath());
  const added = seedDemo(db, localToday()); // keeps the demo history current; never touches live rows
  seedDemoNeighbours(db, localToday()); // labelled demo farmers for the sell-together demo
  const key = process.env.DATA_GOV_IN_API_KEY;
  const ingest = () => runIngest({ db, apiKey: key }).then(r => console.log(r.ok ? `Ingested: ${r.message}` : `Ingestion failed: ${r.message}`));
  if (key) { ingest(); setInterval(ingest, 6 * 3600e3).unref(); }
  const port = Number(process.env.PORT) || 5173;
  createApp({ db }).listen(port, () => {
    const ds = dataState(db, localToday());
    console.log(`Smart Kisaan running at http://localhost:${port}  (data: ${ds.state}, as of ${ds.asOf}; ${added} demo rows added)`);
    if (!key) console.log('No DATA_GOV_IN_API_KEY in .env, so the app shows labelled demo data.');
  });
}
