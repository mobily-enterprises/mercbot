const { query } = require("../db/pool");

// Texts the customer a link to a new invoice. Not in use: see events/listeners.js.
async function smsInvoice({ invoice, customer }) {
  if (!customer.phone) return;
  await query("insert into sms_outbox (phone, text) values ($1, $2)", [customer.phone, `Your invoice ${invoice.id} is ready`]);
}

module.exports = { smsInvoice };
