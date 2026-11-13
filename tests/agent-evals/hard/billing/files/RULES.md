# Billing rules

- usage CSV columns: customer, date (YYYY-MM-DD), units. Units can be large and may be written with thousands separators (quoted, e.g. "1,250").
- customers.json lists each customer's plan: "flat" or "tiered".
- A month's invoice covers every usage row dated in that month, from the 1st to the last day inclusive. Rows from other months are ignored.
- flat: 0.10 per unit.
- tiered, on the month's total units: the first 1,000 units at 0.10, units 1,001 to 5,000 at 0.08, and every unit above 5,000 at 0.05.
- invoices/<customer>.json: {"customer": id, "month": "YYYY-MM", "units": total units, "total": amount rounded to 2 decimals}. Customers with no usage that month get no invoice.
