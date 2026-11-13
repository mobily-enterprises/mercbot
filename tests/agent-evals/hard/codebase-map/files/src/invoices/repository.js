const { query } = require("../db/pool");

async function listByCompany(companyId) {
  return (await query("select * from invoices where company_id = $1 order by created_at desc", [companyId])).rows;
}

async function findInvoice(companyId, id) {
  return (await query("select * from invoices where company_id = $1 and id = $2", [companyId, id])).rows[0] || null;
}

async function insertInvoice(client, invoice) {
  const { rows } = await client.query(
    "insert into invoices (company_id, customer_id, due_date, subtotal, tax, discount, total, status) values ($1, $2, $3, $4, $5, $6, $7, 'open') returning *",
    [invoice.companyId, invoice.customerId, invoice.dueDate, invoice.subtotal, invoice.tax, invoice.discount, invoice.total]
  );
  return rows[0];
}

async function insertLines(client, invoiceId, lines) {
  const saved = [];
  for (const line of lines) {
    const { rows } = await client.query(
      "insert into invoice_lines (invoice_id, description, quantity, unit_price, tax) values ($1, $2, $3, $4, $5) returning *",
      [invoiceId, line.description, line.quantity, line.unitPrice, line.tax]
    );
    saved.push(rows[0]);
  }
  return saved;
}

async function setStatus(invoiceId, status) {
  await query("update invoices set status = $2 where id = $1", [invoiceId, status]);
}

module.exports = { listByCompany, findInvoice, insertInvoice, insertLines, setStatus };
