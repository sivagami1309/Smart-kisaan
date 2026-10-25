// Profit calculator (earlier project's P&L): what a sale leaves in hand after every cost.
const round2 = x => Math.round(x * 100) / 100;

export function profitFor({ qtyKg, pricePerKg, transport, commissionPct, loading = 0, other = 0 }) {
  if (!(qtyKg > 0)) throw new RangeError('quantity must be more than 0 kg');
  if (!(pricePerKg > 0)) throw new RangeError('price must be more than ₹0');
  for (const [name, v] of Object.entries({ transport, loading, other })) {
    if (!(v >= 0)) throw new RangeError(`${name} must be a number of 0 or more`);
  }
  if (!(commissionPct >= 0 && commissionPct <= 30)) throw new RangeError('commission must be a number from 0 to 30%');

  const gross = round2(qtyKg * pricePerKg);
  const commission = round2((gross * commissionPct) / 100);
  const costs = round2(transport + commission + loading + other);
  const net = round2(gross - costs);
  return { gross, transport, commission, loading, other, costs, net, netPerKg: round2(net / qtyKg) };
}
