This folder holds the source of Ledgerly, a small invoicing service in Node.js. I need to understand how it's put together before I change it. Work it out from the code itself (the README may be out of date), then write answers.json with exactly these keys:

- "auth": where a request's user is authenticated, as {"file": the middleware every /api request goes through, "function": its name, "session_check": {"file": ..., "function": ...} where the session itself is checked}.
- "invoice_steps": what happens, in order, when POST /api/invoices creates an invoice: a list of "path/to/file.js#functionName" strings, from the route's handler to the last thing that happens because of it, including the work event listeners do.
- "invoice_tables": every database table written to when an invoice is created (directly or by listeners), sorted.
- "new_payment_provider": the existing files that would have to change to add a third payment provider (not counting the new provider's own file), sorted.

Paths are relative to this folder, like "src/app.js". Also write ARCHITECTURE.md: a short overview of the modules and how a request flows through the app, for the next developer.
