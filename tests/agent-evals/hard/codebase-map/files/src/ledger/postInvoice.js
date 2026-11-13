const { query } = require("../db/pool");
const { ACCOUNTS } = require("./accounts");

// Double entry for a new invoice: debit receivables, credit sales and tax payable.
async function postInvoiceToLedger({ invoice }) {
  const entries = [
    [ACCOUNTS.receivables, invoice.total, 0],
    [ACCOUNTS.sales, 0, invoice.subtotal - invoice.discount],
    [ACCOUNTS.taxPayable, 0, invoice.tax]
  ];
  for (const [account, debit, credit] of entries) {
    await query("insert into ledger_entries (company_id, invoice_id, account, debit, credit) values ($1, $2, $3, $4, $5)", [invoice.company_id, invoice.id, account, debit, credit]);
  }
}

module.exports = { postInvoiceToLedger };
