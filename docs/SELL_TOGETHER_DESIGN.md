# Sell together (கூட்டு விற்பனை) – design

Date: 25 October 2026 · Source: the earlier Smart Kisaan project (React + Spring Boot), where this feature ran only on browser demo data.

## Goal

Two or more nearby farmers growing the same crop share one vehicle to the mandi. Each pays a fair share of one trip instead of a whole trip each. Nothing happens without every farmer's consent.

## Rules (each fixed by a test)

1. **Vehicle cost (estimate):** ≤ 500 kg three-wheeler ₹250 + ₹18/km (min ₹300); ≤ 1,500 kg pickup ₹450 + ₹24/km (min ₹500); above that small lorry ₹800 + ₹32/km (min ₹900). Same model for solo and shared trips, so the comparison is fair.
2. **Shared trip distance:** farthest member's distance to the mandi + the pickup detour between members (straight line × 1.3).
3. **Fair split:** shared transport is split by each farmer's share of the total kg. Shares are rounded to the paisa and always add up exactly to the total.
4. **Benefit:** solo trip cost − shared share. A pool is **never suggested** if any member's benefit would be zero or less.
5. **Matching:** same crop, same mandi, both marked willing, both open, pickup points within 10 km, not the farmer's own listing. Sorted by benefit to the asking farmer.
6. **Consent:** `PROPOSED` → `CONFIRMED` (once every member has consented) → `TRANSPORT_ARRANGED` → `SOLD` → `COMPLETED`. Any member may decline before `SOLD`, which makes it `CANCELLED`. Consent is recorded per farmer; consenting twice changes nothing; non-members cannot act; every action is written to an audit trail.

## Identity (prototype only)

There are no server accounts yet. Each phone gets a random farmer id kept on the device and sent as `X-Farmer-Id`. This is enough to tell farmers apart in a demo; it is **not** secure and must be replaced by real login before any real use.

## Changes from the earlier project

- Removed the unexplained “solo loading × 1.3” multiplier.
- Consent is tracked per farmer, not as a count passed in by the caller (which let one farmer count twice).
- Splits add up exactly to the paisa.
- Runs on the server with stored state, not browser demo data.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/listings` | Offer produce: crop, kg, place, mandi, willing to pool |
| GET | `/api/listings/mine` | This farmer's listings |
| GET | `/api/matches?listing=` | Nearby farmers to pool with, with each side's benefit |
| POST | `/api/pools` | Propose a pool (proposer consents) |
| GET | `/api/pools/:id` | Members, state, split, audit trail |
| POST | `/api/pools/:id/action` | accept, decline, arrange, sold, complete |
