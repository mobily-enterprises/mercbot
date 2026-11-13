const { query } = require("../db/pool");

async function listByCompany(companyId) {
  return (await query("select * from customers where company_id = $1 order by name", [companyId])).rows;
}

async function insertCustomer({ companyId, name, email, taxExempt }) {
  const { rows } = await query("insert into customers (company_id, name, email, tax_exempt) values ($1, $2, $3, $4) returning *", [companyId, name, email, taxExempt]);
  return rows[0];
}

async function findCustomer(companyId, id) {
  return (await query("select * from customers where company_id = $1 and id = $2", [companyId, id])).rows[0] || null;
}

module.exports = { listByCompany, insertCustomer, findCustomer };
