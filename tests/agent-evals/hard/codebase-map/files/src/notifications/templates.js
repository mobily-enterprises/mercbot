function renderInvoiceEmail(invoice, customer) {
  const amount = (invoice.total / 100).toFixed(2);
  return `Hello ${customer.name},\n\nYour invoice ${invoice.id} for ${amount} is due on ${invoice.due_date}.\n`;
}

module.exports = { renderInvoiceEmail };
