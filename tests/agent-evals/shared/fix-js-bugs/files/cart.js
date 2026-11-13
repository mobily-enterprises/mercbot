// A shopping cart: quantities per sku, prices from a catalogue.
export function addItem(cart, sku, qty = 1) {
  const next = { ...cart };
  next[sku] = qty;
  return next;
}
export function cartTotal(cart, catalogue) {
  let total = 0;
  for (const sku in cart) total += catalogue[sku] * cart[sku];
  return Math.round(total);
}
