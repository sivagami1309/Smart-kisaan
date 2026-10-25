// File locations and "today" for the running app.
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const FRONTEND_DIR = join(APP_DIR, '..', 'frontend');

export function dbPath() {
  if (process.env.SK_DB) return process.env.SK_DB;
  mkdirSync(join(APP_DIR, 'data'), { recursive: true });
  return join(APP_DIR, 'data', 'smart-kisaan.db');
}

// Today's date in India (or SK_TODAY to pin a demo date), as YYYY-MM-DD
export function localToday() {
  if (process.env.SK_TODAY) return process.env.SK_TODAY;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

// Minimal .env reader: KEY=VALUE lines in app/.env or project/.env
export function loadEnv() {
  for (const p of [join(APP_DIR, '.env'), join(APP_DIR, '..', '.env')]) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
