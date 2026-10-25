// SQLite storage (Node's built-in node:sqlite). Price history is append-only.
import { DatabaseSync } from 'node:sqlite';

export function openDb(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS price_daily (
      date TEXT NOT NULL, mandi TEXT NOT NULL, crop TEXT NOT NULL,
      min_q REAL, max_q REAL, modal_q REAL NOT NULL,
      source TEXT NOT NULL, fetched_at TEXT NOT NULL,
      PRIMARY KEY (date, mandi, crop, source)
    );
    CREATE TABLE IF NOT EXISTS ingestion_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, source TEXT, ok INTEGER, inserted INTEGER, message TEXT
    );
    CREATE TABLE IF NOT EXISTS listings (
      id TEXT PRIMARY KEY, farmer TEXT NOT NULL, name TEXT, crop TEXT NOT NULL, qty_kg REAL NOT NULL,
      place TEXT, lat REAL NOT NULL, lon REAL NOT NULL, mandi TEXT NOT NULL, km_to_mandi REAL NOT NULL,
      willing INTEGER NOT NULL, status TEXT NOT NULL, demo INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pools (
      id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY, farmer TEXT NOT NULL, crop TEXT NOT NULL, mandi TEXT NOT NULL, qty_kg REAL NOT NULL,
      price_per_kg REAL NOT NULL, sold_on TEXT NOT NULL, buyer TEXT, receipt TEXT, transport REAL NOT NULL,
      commission_pct REAL NOT NULL, loading REAL NOT NULL, other REAL NOT NULL, pool_id TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT, farmer TEXT NOT NULL, kind TEXT NOT NULL, pool_id TEXT,
      actor_name TEXT, created_at TEXT NOT NULL, read INTEGER NOT NULL DEFAULT 0
    );`);
  // Where each price came from (demo / agmarknet / manual). Older databases get the column added.
  try { db.exec('ALTER TABLE price_daily ADD COLUMN origin TEXT'); } catch { /* already there */ }
  return db;
}

const plain = r => ({ ...r });

export function insertRows(db, rows, source, fetchedAt, origin = source === 'demo' ? 'demo' : 'agmarknet') {
  const stmt = db.prepare(`INSERT OR IGNORE INTO price_daily
    (date, mandi, crop, min_q, max_q, modal_q, source, fetched_at, origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let inserted = 0;
  db.exec('BEGIN');
  try {
    for (const r of rows) inserted += Number(stmt.run(r.date, r.mandi, r.crop, r.minQ ?? null, r.maxQ ?? null, r.modalQ, source, fetchedAt, origin).changes);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return inserted;
}

export function latestByMandi(db, crop, source) {
  return db.prepare(`
    SELECT p.mandi, p.date, p.min_q AS minQ, p.max_q AS maxQ, p.modal_q AS modalQ, p.fetched_at AS fetchedAt,
      COALESCE(p.origin, CASE p.source WHEN 'demo' THEN 'demo' ELSE 'agmarknet' END) AS origin
    FROM price_daily p
    JOIN (SELECT mandi, MAX(date) AS d FROM price_daily WHERE crop = ? AND source = ? GROUP BY mandi) l
      ON p.mandi = l.mandi AND p.date = l.d
    WHERE p.crop = ? AND p.source = ?`).all(crop, source, crop, source).map(plain);
}

// live: live data for today · cached: live data, but older · demo: no live data at all
export function dataState(db, today) {
  const live = db.prepare(`SELECT MAX(date) AS d FROM price_daily WHERE source = 'live'`).get().d;
  if (!live) {
    const demo = db.prepare(`SELECT MAX(date) AS d FROM price_daily WHERE source = 'demo'`).get().d;
    return { state: 'demo', source: 'demo', asOf: demo ?? null };
  }
  return { state: live >= today ? 'live' : 'cached', source: 'live', asOf: live };
}

const shift = (iso, days) => new Date(Date.parse(iso) + days * 864e5).toISOString().slice(0, 10);

export function trend(db, crop, mandi, source, days, today) {
  return db.prepare(`SELECT date, modal_q AS modalQ FROM price_daily
    WHERE crop = ? AND mandi = ? AND source = ? AND date BETWEEN ? AND ? ORDER BY date`)
    .all(crop, mandi, source, shift(today, -(days - 1)), today).map(plain);
}

// One mandi's modal price for a crop on a date, real data preferred over demo; null if none
export function priceOn(db, crop, mandi, date) {
  const r = db.prepare(`SELECT modal_q AS modalQ, source,
      COALESCE(origin, CASE source WHEN 'demo' THEN 'demo' ELSE 'agmarknet' END) AS origin
    FROM price_daily WHERE crop = ? AND mandi = ? AND date = ? ORDER BY source = 'live' DESC LIMIT 1`).get(crop, mandi, date);
  return r ? { ...r } : null;
}

export function logIngestion(db, { at, source, ok, inserted, message }) {
  db.prepare('INSERT INTO ingestion_log (at, source, ok, inserted, message) VALUES (?, ?, ?, ?, ?)')
    .run(at, source, ok ? 1 : 0, inserted, message);
}

export function lastIngestion(db) {
  const r = db.prepare('SELECT at, source, ok, inserted, message FROM ingestion_log ORDER BY id DESC LIMIT 1').get();
  return r ? { at: r.at, source: r.source, ok: r.ok === 1, inserted: r.inserted, message: r.message } : null;
}

export { shift };
