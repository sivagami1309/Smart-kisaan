# Smart Kisaan – prototype

Nearby mandi prices for small farmers, ranked by **money in hand** (net ₹/kg), in Tamil.
Node 22.13+ only: no packages to install (uses built-in `node:http`, `node:sqlite`, `node:test`).

## Run it

```bash
cd project/app
npm test          # 131 tests: prices, cleaning, storage, ingestion, offer check, SMS, sell together, profit, sales, notifications, voice, weather, admin, API
npm start         # http://localhost:5173  (screens + API)
```

Open `http://localhost:5173` on a phone-sized window. `http://localhost:5173/flow.html` shows all six screens and the user flow.

## Data: demo, cached or live

- With no API key the server seeds **labelled demo data** (30 days, 5 crops, 5 mandis near Manapparai). Every price screen says `DEMO DATA – NOT LIVE MARKET PRICES`.
- To use real Agmarknet prices, create `project/app/.env` (never commit it):

  ```
  DATA_GOV_IN_API_KEY=your-key-here
  ```

  Then `npm run ingest` (or just `npm start`, which ingests at start and every 6 hours). Raw responses are saved in `data/raw/` as proof. Market names the app doesn’t recognise are printed; add the pilot ones to `feedNames` in `src/config.js`.
- Once live rows exist the banner switches to **LIVE** (today’s data) or **NOT LIVE · last prices from …** (older data). Live and demo data are never mixed.

## API

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/api/health` | Today, data state, last ingestion run |
| GET | `/api/crops`, `/api/places` | Pilot crops and places |
| GET | `/api/prices?crop=tomato&place=manapparai&radius=100&rate=25&load=500&comm=8` | Mandis ranked by net ₹/kg, plus missing mandis |
| GET | `/api/trend?crop=tomato&mandi=trichy&days=7` | Daily modal ₹/kg |
| POST | `/api/offer-check` `{crop, offer, qty}` | Low / fair / good verdict and the gap |
| POST | `/api/sms/simulate` `{text, lang}` | SMS reply text and SMS count (simulated) |

### More features (ported from the earlier project – see `docs/ALL_FEATURES_DESIGN.md`)

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/api/profit?crop&mandi&qtyKg[&pricePerKg&transport&commissionPct&loading&other]` | Profit for one sale; today’s price and a vehicle estimate unless given |
| GET / POST | `/api/sales` | My sales with profit and that day’s mandi price · record a sale (needs `X-Farmer-Id`) |
| GET | `/api/notifications` · POST `/api/notifications/read` | Pool updates for this farmer · mark read |
| GET | `/api/board` | Every crop’s best mandi today |
| GET | `/api/markets?place=` | Mandis nearest first, with coordinates for directions |
| GET | `/api/weather?place=` | 5-day forecast from Open-Meteo (internet needed; cached 1 hour) |
| GET | `/api/voice?text=` | Tamil/English voice command → screen to open |
| GET / POST | `/api/admin/summary`, `/farmers`, `/pools`, `/prices` | Admin console; needs `SK_ADMIN_TOKEN` in `.env` and the `X-Admin-Token` header |

To switch admin on, add to `project/app/.env`: `SK_ADMIN_TOKEN=<a long password>`, restart, and open `/admin.html`. Without it, admin is off.

### Sell together (கூட்டு விற்பனை)

Nearby farmers share one vehicle to the mandi; see `docs/SELL_TOGETHER_DESIGN.md`. Requests carry `X-Farmer-Id`, a random id kept on the phone (prototype only, not a login).

| Method | Path | Returns |
| --- | --- | --- |
| POST | `/api/listings` `{crop, qtyKg, place, mandi, willing, name}` | The new listing |
| GET | `/api/listings/mine` | This farmer’s listings |
| GET | `/api/matches?listing=` | Nearby farmers, each side’s saving, best first |
| POST | `/api/pools` `{listings: [mine, theirs]}` | Proposed pool with the cost split |
| GET | `/api/pools/:id` | Members, state, split, history (members only) |
| POST | `/api/pools/:id/action` `{action, pricePerKg?, asDemo?}` | accept, decline, arrange, sold, complete |

Demo neighbours near Manapparai are seeded with names ending “(மாதிரி)”; a member may answer for them with `asDemo`, never for a real farmer.

## Rules the tests lock in

- Net ₹/kg = modal/100 − ₹/km × km ÷ load − commission %.
- A price 1 day old is ranked but flagged; older prices are listed as “no report today”, never ranked, never ₹0.
- History is append-only; a re-run never overwrites a stored price.
- Demo regression: tomato near Manapparai → Trichy ₹17.22, Manapparai ₹16.26, Dindigul ₹16.00, Oddanchatram ₹15.64; Karur missing.

## Layout

```
app/src/   config, netPrice, clean, db, seed, ingest, offer, sms, server, paths
app/test/  one test file per module + api.test.js
frontend/  the six screens (served by the app) and flow.html
```
