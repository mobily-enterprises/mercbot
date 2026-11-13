# Apps data: tables, records and audit

Each home's own tables, made by its Builder bot and shared by every app, bot and person of the
home, with every change audited and nothing ever deleted (D-35).

## Sources

- Main: `packages/apps/src/server/dataGate.js`
- `packages/apps/src/server/registry.js`
- `packages/apps/src/server/tables.js`
- `packages/apps/src/server/anyapi.js`
- `packages/apps/src/server/validate.js`
- `packages/apps/src/server/sqlPlan.js`
- `packages/apps/src/server/schema.js`
- `packages/apps/src/shared/where.js`
- `packages/apps/src/shared/formulas.js`
- `packages/apps/src/shared/calculated.js`
- `migrations/20261113120000_baseline.cjs`
- `src/components/apps/AppsTable.vue`
- `src/components/apps/RecordDialog.vue`
- `src/components/apps/linkPickers.js`
- `src/components/apps/AppsActivity.vue`
- `src/components/apps/sheets.js`
- `tests/server/appsRegistry.integration.js`
- `tests/server/appsDataGate.integration.js`
- `tests/server/appsImport.integration.js`
- `tests/server/appsWhere.test.js`
- `tests/server/appsCalculated.test.js`
- `tests/server/appsCalculated.integration.js`
- `tests/client/appsLinkPickers.vitest.js`

## Public contract

- Records live in json-rest-api's AnyAPI storage, one tenant per home (`ws:<id>`); tables and
  fields have permanent ids (`t_…`, `f_…`) that are AnyAPI's resource and field names, while keys
  and labels live in `app_tables`/`app_fields`. Renaming changes only the registry. Field types:
  text, email, phone, choice, link, number, money (whole cents), date (YYYY-MM-DD), yesno.
- Every write goes through the data gate (`create`, `update`, `markObsolete`, `restore`): values
  are checked by type, links must point to existing records, removed fields are refused, and an
  `audit_events` row (actor, via, field old → new) is written in the same transaction. A write
  whose audit fails doesn't happen. There is no delete. A draft's preview writes to its practice
  copy instead, unaudited (practice.md).
- Import (`importRecords`) adds a spreadsheet's rows, up to 500 per call, in one transaction:
  every row is checked, and one failing row (or a dry run) writes nothing; errors name the file's
  rows. Every row gets create()'s checks (`checkNew`: who may write, types, the rules, read once
  through `beforeSaveEach`, and links, against the records already read for titles) before
  anything is written. Only the linked records the sheet names are read, whatever the linked table
  holds: those whose title, trimmed and lowercased, is a cell's text (a plan field marked `trim`),
  then those whose id is a text no title matched, a query per `PAGE_MAX` texts; then the records go in and their audit entries are written together, so a
  dry run writes nothing and each row costs only AnyAPI's insert. Cells are converted first: money
  in units ("$1,250.50" → 125050 cents), yes/no words, dates with a time cut to the day, a link by
  the linked record's title (or id). Each record is audited `via { kind: "import", file }`. The
  Data tab checks every page with a dry run before writing any; export writes live records with
  labels as headings, money in units and links as titles, so a file exported can be imported back.
- Reads hide obsolete records unless asked; filters are CEL formulas compiled to SQL on AnyAPI's
  slots through a row policy; totals use `aggregate()` under the same policy. A page holds up to
  `PAGE_MAX` (200, `@local/apps/shared`) records, and each home's AnyAPI is given the same cap
  (`queryMaxLimit`; json-rest-api's own is 100), so a shorter page is the last one.
  Linked records are read in one query per link field (the row policy's `ids`), so a page costs
  the same at any size.
- The Data tab's record form picks a link from the target table's first 100 records, or those whose
  text has what the person types, searched on the server (`src/components/apps/linkPickers.js`); the
  record a field links to now is always offered, under its label.
- Calculated fields (D-78): a field whose `options.formula` is a CEL formula over the same record's
  other fields, stored by field ids (`=f_… * f_…`) and handed to browsers and bots by names
  (`fieldByNames`). Types text, number, money (rounded to whole cents), date or yesno; never
  required, never the title, and no AnyAPI slot: the data gate works the values out on every read
  (`withCalculated` in `toRecord`), in dependency order, a failing formula (say, on a removed field)
  giving null ("—") to it and to what is worked out from it. The registry checks each one when a
  table is made, a field added or its formula changed (`changeFormula`, audited `changedFormula`):
  known fields, built-in functions only (a table serves every app) and none that loops or matches a
  pattern (`map`, `filter`, `all`, `exists`, `exists_one`, `matches`), the field's type, and no chain
  back to itself (`a → b → a`), reading the fields in its transaction with the table's row locked
  (`lockedTable`), so concurrent changes can't make a chain. A value of the wrong type, a date that
  isn't one or a text past 10,000 characters (`TEXT_MAX`) is null. Writes and imports never set one (`apps_field_calculated`; an
  import skips its column). Filters, sorts and groups run in SQL, so they use stored fields only
  (`storedFieldIds`): the gate drops a calculated sort and refuses a calculated group; a sum or
  average of one is worked out from the matching records, read a page at a time, up to 5,000; past
  that it is refused after a count, unread (`apps_calculated_totals_too_many`). The owner keeps these limits
  (2026-11-12), said up front: the Data tab's table names under its search box the calculated fields search and
  sorting leave out, and its Fields says why they can't be filtered, sorted or grouped by (`AppsTable.vue`).
  Removing a field lists the calculated fields worked out from it (`fieldImpact`'s `calculated`).
- Several servers stay in sync: AnyAPI's `onSchemaChanged` and the registry publish notices, and
  json-rest-api's version check catches missed ones.
- Routes under `/api/w/:workspaceSlug/` (sign-in, CSRF, home membership): `app-data/tables`
  (with record counts and the apps using each; `app=<id>` keeps and counts only the tables that app
  uses, for its details, and `brief=true` answers the tables alone, for pickers and filters), `app-data/tables/:key/records` (search, sort,
  pages, show obsolete; create; `PATCH :id`; `:id/obsolete`; `:id/restore`; `:id/history`), `app-data/tables/:key/import`
  (`{rows, dryRun, firstRow, file}`, rows keyed by field id),
  `app-activity` (filters table, app, person or bot, dates; paged by id). The person-or-bot filter
  reads `ix_audit_events_actor` (home, actor id, id desc): its list jumps from one actor id to the
  next (a recursive loose index scan), each with their latest entry's type and name, and one
  actor's page reads only their entries, so neither grows with the home's history.
