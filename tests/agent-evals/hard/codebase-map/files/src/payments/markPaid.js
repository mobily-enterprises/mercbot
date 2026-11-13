const { setStatus } = require("../invoices/repository");

async function markInvoicePaid({ invoiceId }) {
  await setStatus(invoiceId, "paid");
}

module.exports = { markInvoicePaid };
