# Templates

Ready-made apps a home installs and adapts (D-35, stage 3).

## Sources

- Main: `packages/apps/src/server/templates.js`
- `packages/apps/templates/bookings.json`
- `packages/apps/templates/contacts.json`
- `packages/apps/templates/todos.json`
- `packages/apps/templates/contact_form.json`
- `packages/apps/templates/crm.json`
- `packages/apps/templates/hiring.json`
- `packages/apps/templates/leave.json`
- `packages/apps/templates/stock.json`
- `src/components/apps/AppsTemplates.vue`

## Public contract

- Eight templates (Contacts, To-dos, CRM, Stock, Leave requests, Hiring pipeline, Contact form,
  Bookings), each passing the app check against its own tables and the shared tables it `uses`
  (D-130), which installing makes with `ensureTable`. Contacts, To-dos and CRM are built on the
  shared tables: the CRM keeps each contact's pipeline in the `crm_contacts` extension. Contacts
  and To-dos are every home's starter apps (data.md).
- Installing (`POST /api/w/:slug/apps-templates/:key/install`, owners and admins, or the
  Builder's `template_install`) reuses tables with the same key, adding only missing fields, or
  creates them; creates the app with the template as a draft; optionally adds sample records
  through the gate (audited `via template`), skipping and counting ones that don't fit. Nothing
  is removed or renamed.

## Proved by

- `tests/server/appsTemplates.test.js`
- `tests/server/appsTemplates.integration.js`
- `tests/server/appsStarter.integration.js`
