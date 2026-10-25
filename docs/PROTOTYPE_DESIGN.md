# Smart Kisaan – Prototype design (brainstorm outcome)

Date: 25 October 2026 · Scope: the whole working prototype for the hackathon demo.

## Goal

Turn the six static screens into a working app: a small server that stores prices, applies the PRD rules once, and serves both the API and the screens. It must run on a laptop with no internet, and switch to real data.gov.in prices the moment an API key is added.

## Options considered

| Option | For | Against | Decision |
| --- | --- | --- | --- |
| Keep static pages, maths in the browser | Already works | No real data path, rules duplicated in 3 pages | Rejected |
| Python FastAPI + SQLite | Team knows Python | Extra installs (pip, uvicorn) on demo laptop | Rejected |
| **Node 24, built-in `node:http` + `node:sqlite` + `node:test`** | **Zero dependencies, one command to run, tests built in** | Hand-written router | **Chosen** |

## Architecture

```
data.gov.in API ──(npm run ingest, needs key)──┐
demo seed (npm run seed, 30 days synthetic) ───┤
                                               ▼
                                  SQLite: price_daily (+ source, fetched_at)
                                               │
                               src/netPrice.js (rules, one place)
                                               │
          node:http server ── /api/* JSON ── frontend screens (fetch)
```

## Modules (each test-first)

| Module | Responsibility | PRD |
| --- | --- | --- |
| `src/netPrice.js` | ₹/quintal → ₹/kg, net price, freshness, ranking | FR7, FR8 |
| `src/clean.js` | Parse data.gov.in records, map feed names, drop outliers | FR1–FR3 |
| `src/db.js` | Schema, idempotent upsert, latest price, trend | FR1, FR15 |
| `src/seed.js` | Deterministic 30-day demo history, `source = 'demo'` | FR10 |
| `src/ingest.js` | Fetch from data.gov.in (fetch injected for tests) | FR1 |
| `src/offer.js` | Trader offer verdict | FR11 |
| `src/sms.js` | SMS reply text + Unicode segment count | FR17 |
| `src/server.js` | API + static screens | §8 endpoints |

## Rules fixed by tests

1. Net ₹/kg = modal/100 − ₹/km × km ÷ load − commission% × modal/100.
2. Price age 0–1 day → ranked (1 day flagged stale); older → "no report today", never ranked, never ₹0.
3. Rows are never overwritten for the same date, mandi and crop (history is append-only).
4. Every API response carries `dataState`: `live`, `cached` (live data older than today) or `demo`.
5. Demo regression: tomato near Manapparai, 100 km, ₹25/km, 500 kg, 8% → Trichy ₹17.22, Manapparai ₹16.26, Dindigul ₹16.00, Oddanchatram ₹15.64; Karur listed as no report.

## Out of scope for the prototype

Live SMS/DLT, user accounts on the server (login stays on-device), FPO linking, AI sell-or-hold hint.
