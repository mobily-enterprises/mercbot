const RATES = { GST: 0.1, FREE: 0 };

// A line's tax in cents, from its tax code; tax-exempt customers pay none.
function applyTax(line, customer) {
  const rate = customer.tax_exempt ? 0 : RATES[line.taxCode] ?? RATES.GST;
  return { ...line, tax: Math.round(line.quantity * line.unitPrice * rate * 100) };
}

module.exports = { applyTax, RATES };
