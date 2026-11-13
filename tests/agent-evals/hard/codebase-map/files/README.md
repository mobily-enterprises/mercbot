# Ledgerly

Invoicing for small businesses: customers, invoices, payments and the ledger.

## Running

    npm start

## How it fits together

- The API is protected with HTTP basic auth (see `src/legacy/basicAuth.js`).
- Creating an invoice saves it and texts the customer a link by SMS.
- Payments go through Stripe.

(This README dates from version 1.)
