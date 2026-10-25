// Trader offer check (PRD FR11): compare the trader's ₹/kg offer with the best net mandi price.
export function offerVerdict(offer, bestNet, qty) {
  if (!(offer > 0) || !(bestNet > 0)) return null;
  const gapPerKg = bestNet - offer;
  const kind = gapPerKg > bestNet * 0.03 ? 'low' : gapPerKg > 0 ? 'fair' : 'good';
  return { kind, gapPerKg, gapTotal: gapPerKg * (qty > 0 ? qty : 0) };
}
