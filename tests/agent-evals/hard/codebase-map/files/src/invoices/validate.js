const { HttpError } = require("../http/errors");

// Checks an invoice's input and returns it cleaned up.
function validateInvoiceInput(input) {
  if (!input.customerId) throw new HttpError(400, "Choose a customer");
  if (!Array.isArray(input.lines) || !input.lines.length) throw new HttpError(400, "An invoice needs at least one line");
  const lines = input.lines.map((line, index) => {
    const quantity = Number(line.quantity);
    const unitPrice = Number(line.unitPrice);
    if (!line.description || !(quantity > 0) || !(unitPrice >= 0)) throw new HttpError(400, `Line ${index + 1} is incomplete`);
    return { description: String(line.description), quantity, unitPrice, taxCode: line.taxCode || "GST" };
  });
  const dueDate = input.dueDate || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  return { customerId: input.customerId, lines, dueDate };
}

module.exports = { validateInvoiceInput };
