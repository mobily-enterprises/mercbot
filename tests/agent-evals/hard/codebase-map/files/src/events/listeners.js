const { postInvoiceToLedger } = require("../ledger/postInvoice");
const { emailInvoice } = require("../notifications/emailOnInvoice");
const { markInvoicePaid } = require("../payments/markPaid");
// const { smsInvoice } = require("../notifications/smsOnInvoice");

const safely = (bus, handler) => (payload) => Promise.resolve(handler(payload)).catch((error) => bus.emit("error", error));

// What happens after the fact. SMS is switched off until a provider is chosen.
function registerListeners(bus) {
  bus.on("invoice.created", safely(bus, postInvoiceToLedger));
  bus.on("invoice.created", safely(bus, emailInvoice));
  // bus.on("invoice.created", safely(bus, smsInvoice));
  bus.on("payment.received", safely(bus, markInvoicePaid));
}

module.exports = { registerListeners };
