const providers = require("./providers");
const invoices = require("../invoices/service");
const { HttpError } = require("../http/errors");

// Starts paying an invoice with one of the enabled providers; returns where to send the person.
async function startCheckout(user, invoiceId, providerName) {
  const invoice = await invoices.getInvoice(user, invoiceId);
  if (!invoice) throw new HttpError(404, "No such invoice");
  const provider = providers.get(providerName);
  return provider.createCheckout(invoice);
}

module.exports = { startCheckout };
