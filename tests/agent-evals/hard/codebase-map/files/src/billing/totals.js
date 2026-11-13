const { applyTax } = require("./tax");
const { applyDiscount } = require("./discounts");

// Each line's tax, then the invoice's subtotal, discount, tax and total, in cents.
function computeTotals(lines, customer) {
  const priced = lines.map((line) => applyTax(line, customer));
  const subtotal = priced.reduce((sum, line) => sum + Math.round(line.quantity * line.unitPrice * 100), 0);
  const discount = applyDiscount(subtotal, customer);
  const tax = priced.reduce((sum, line) => sum + line.tax, 0);
  return { lines: priced, subtotal, discount, tax, total: subtotal - discount + tax };
}

module.exports = { computeTotals };
