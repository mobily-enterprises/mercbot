const { queueEmail } = require("./mailer");
const { renderInvoiceEmail } = require("./templates");

// Emails the customer their new invoice, when they have an address.
async function emailInvoice({ invoice, customer }) {
  if (!customer.email) return;
  await queueEmail(customer.email, `Invoice ${invoice.id}`, renderInvoiceEmail(invoice, customer));
}

module.exports = { emailInvoice };
