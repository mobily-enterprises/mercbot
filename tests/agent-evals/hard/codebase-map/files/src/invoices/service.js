const { validateInvoiceInput } = require("./validate");
const { computeTotals } = require("../billing/totals");
const repository = require("./repository");
const customers = require("../customers/service");
const { withTransaction } = require("../db/transaction");
const { bus } = require("../events/bus");

async function listInvoices(user) {
  return repository.listByCompany(user.company_id);
}

async function getInvoice(user, id) {
  return repository.findInvoice(user.company_id, id);
}

// A new invoice: checked, priced, saved with its lines in one transaction, then announced.
async function createInvoice(user, input) {
  const clean = validateInvoiceInput(input);
  const customer = await customers.getCustomer(user, clean.customerId);
  const totals = computeTotals(clean.lines, customer);
  const invoice = await withTransaction(async (client) => {
    const saved = await repository.insertInvoice(client, { companyId: user.company_id, customerId: customer.id, dueDate: clean.dueDate, ...totals });
    saved.lines = await repository.insertLines(client, saved.id, totals.lines);
    return saved;
  });
  bus.emit("invoice.created", { invoice, customer, user });
  return invoice;
}

module.exports = { listInvoices, getInvoice, createInvoice };
