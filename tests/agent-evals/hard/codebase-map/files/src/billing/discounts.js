// A customer's standing discount, in cents.
function applyDiscount(subtotal, customer) {
  const percent = Number(customer.discount_percent || 0);
  return Math.round(subtotal * percent / 100);
}

module.exports = { applyDiscount };
