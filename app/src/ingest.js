// Fetches today's Tamil Nadu prices from data.gov.in, cleans them and stores them as 'live'.
import { pathToFileURL } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CROPS, STATE, RESOURCE_ID } from './config.js';
import { cleanRecords } from './clean.js';
import { openDb, insertRows, logIngestion } from './db.js';
import { APP_DIR, dbPath, loadEnv } from './paths.js';

export function buildUrl({ apiKey, commodity, offset = 0, limit = 500 }) {
  const u = new URL(`https://api.data.gov.in/resource/${RESOURCE_ID}`);
  u.searchParams.set('api-key', apiKey);
  u.searchParams.set('format', 'json');
  u.searchParams.set('offset', String(offset));
  u.searchParams.set('limit', String(limit));
  u.searchParams.set('filters[state]', STATE);
  u.searchParams.set('filters[commodity]', commodity);
  return u.toString();
}

export async function fetchAll({ apiKey, fetchFn = fetch, limit = 500, crops = Object.values(CROPS).map(c => c.feed) }) {
  const out = [];
  for (const commodity of crops) {
    for (let offset = 0; ; offset += limit) {
      const res = await fetchFn(buildUrl({ apiKey, commodity, offset, limit }));
      if (!res.ok) throw new Error(`data.gov.in returned HTTP ${res.status} for ${commodity}`);
      const records = (await res.json()).records || [];
      out.push(...records);
      if (records.length < limit) break;
    }
  }
  return out;
}

export async function runIngest({ db, apiKey, fetchFn = fetch, now = new Date().toISOString(), rawDir = null }) {
  if (!apiKey) {
    const message = 'No API key: add DATA_GOV_IN_API_KEY to the .env file';
    logIngestion(db, { at: now, source: 'live', ok: false, inserted: 0, message });
    return { ok: false, message };
  }
  try {
    const records = await fetchAll({ apiKey, fetchFn });
    if (rawDir) {
      mkdirSync(rawDir, { recursive: true });
      writeFileSync(join(rawDir, `${now.replace(/[:.]/g, '-')}.json`), JSON.stringify(records, null, 1));
    }
    const { rows, unmapped, dropped } = cleanRecords(records);
    const inserted = insertRows(db, rows, 'live', now);
    const message = `${records.length} records, ${rows.length} rows, ${dropped.length} dropped, ${unmapped.length} unmapped`;
    logIngestion(db, { at: now, source: 'live', ok: true, inserted, message });
    return { ok: true, fetched: records.length, inserted, unmapped, dropped: dropped.length, message };
  } catch (e) {
    logIngestion(db, { at: now, source: 'live', ok: false, inserted: 0, message: e.message });
    return { ok: false, message: e.message };
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadEnv();
  const res = await runIngest({ db: openDb(dbPath()), apiKey: process.env.DATA_GOV_IN_API_KEY, rawDir: join(APP_DIR, 'data', 'raw') });
  console.log(res.ok ? `Ingested: ${res.message}` : `Ingestion failed: ${res.message}`);
  if (res.unmapped?.length) console.log('Unmapped markets (add to feedNames in src/config.js if they are pilot mandis):\n  ' + res.unmapped.join('\n  '));
  process.exitCode = res.ok ? 0 : 1;
}
