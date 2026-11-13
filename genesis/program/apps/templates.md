# Templates

Ready-made apps a home installs and adapts (D-35, stage 3).

## Sources

- Main: `packages/apps/src/server/templates.js`
- `packages/apps/templates/bookings.json`
- `packages/apps/templates/contact_form.json`
- `packages/apps/templates/crm.json`
- `packages/apps/templates/hiring.json`
- `packages/apps/templates/leave.json`
- `packages/apps/templates/stock.json`
- `src/components/apps/AppsTemplates.vue`
- `tests/server/appsTemplates.test.js`
- `tests/server/appsTemplates.integration.js`

## Public contract

- Six templates (CRM, Stock, Leave requests, Hiring pipeline, Contact form, Bookings), each
  passing the app check against its own tables.
- Installing (`POST /api/w/:slug/apps-templates/:key/install`, owners and admins, or the
  Builder's `template_install`) reuses tables with the same key, adding only missing fields, or
  creates them; creates the app with the template as a draft; optionally adds sample records
  through the gate (audited `via template`), skipping and counting ones that don't fit. Nothing
  is removed or renamed.
