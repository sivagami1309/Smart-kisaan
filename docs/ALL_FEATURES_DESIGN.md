# Smart Kisaan – porting every feature of the earlier project

Date: 25 October 2026. Decisions agreed: rule-based voice commands instead of the paid AI assistant; admin protected by `SK_ADMIN_TOKEN` in `.env` (admin is off when it is not set).

## Feature map

| Earlier project | Before this round | Now |
| --- | --- | --- |
| Login (OTP), home, market prices, compare, 7-day trend, sell produce, sell together, consent | Built | Unchanged |
| Profit calculator | Missing | `profit.js` + `/api/profit` + profit screen |
| My sales and receipts | Missing | `sales.js` + `/api/sales` + sales screen; a completed shared sale is recorded for every real member |
| Notifications | Missing | Created on every pool step for the *other* members; bell on home |
| Traceability | Pool history only | Every price carries its origin (demo / Agmarknet / manual) and fetch time |
| Nearby markets | Missing | `/api/markets` + markets screen with directions |
| Transport optimiser | Inside sell together | Profit screen estimates the vehicle and cost; sell together keeps the shared comparison |
| Weather | Missing | `weather.js` via Open-Meteo (free, no key), cached 1 hour, honest “unavailable” |
| Farming tips | Missing | Six bilingual tips from the earlier project |
| Voice commands | Crop names only | `voice.js` parser (crops, nearby, profit, weather, together, sales, tips, home) + `/api/voice` |
| Admin console, prices, farmers, collaborations, data sources | Missing | `admin.js` + `/api/admin/*` + admin screen |
| AI voice assistant (Claude + Gemini) | Missing | **Out of scope** (needs paid keys) |

## Rules fixed by tests

- **Profit:** gross = kg × ₹/kg; costs = transport + commission% of gross + loading + other; net and net per kg, rounded to the paisa. Transport may be typed or estimated with the vehicle model.
- **Voice:** longest crop phrase wins; “சின்ன வெங்காயம் / small onion” is not onion (same rule as ingestion); action words beat crop words.
- **Sales:** quantity 10–20,000 kg, price above 0, date not in the future. Each sale is compared with that mandi’s modal price for that day when one exists; otherwise “no mandi price that day”.
- **Notifications:** go to every real member except the one who acted; demo farmers get none; only the owner can read or clear them.
- **Weather:** only places inside India; coordinates rounded to about 1 km before leaving the server; one fetch per place per hour; any failure is a 503 with no invented numbers.
- **Admin:** constant-time token check; off (403) when no token is configured; manual prices are dated, checked (min ≤ modal ≤ max, not in the future, within 30 days) and stored with origin `manual`, never overwriting an existing price.
- **Traceability:** price origin is one of `demo`, `agmarknet`, `manual`, shown wherever a price is shown.
