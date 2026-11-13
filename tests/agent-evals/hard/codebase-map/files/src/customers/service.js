const repository = require("./repository");
const { HttpError } = require("../http/errors");

async function listCustomers(user) {
  return repository.listByCompany(user.company_id);
}

async function addCustomer(user, input) {
  if (!input.name) throw new HttpError(400, "A customer needs a name");
  return repository.insertCustomer({ companyId: user.company_id, name: input.name, email: input.email || null, taxExempt: Boolean(input.taxExempt) });
}

async function getCustomer(user, id) {
  const customer = await repository.findCustomer(user.company_id, id);
  if (!customer) throw new HttpError(404, "No such customer");
  return customer;
}

module.exports = { listCustomers, addCustomer, getCustomer };
