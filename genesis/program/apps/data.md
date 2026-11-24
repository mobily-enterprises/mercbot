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
- `packages/apps/src/server/recordChecks.js`
- `packages/apps/src/server/recordFiles.js`
- `packages/apps/src/server/relatedRecords.js`
- `packages/apps/src/server/sheetInput.js`
- `packages/apps/src/server/auditReads.js`
- `packages/apps/src/server/tableCatalog.js`
- `packages/apps/src/server/starterApps.js`
- `packages/apps/catalog/contacts.json`
- `packages/apps/catalog/crm_contacts.json`
- `packages/apps/catalog/deals.json`
- `packages/apps/catalog/departments.json`
- `packages/apps/catalog/event_attendees.json`
- `packages/apps/catalog/events.json`
- `packages/apps/catalog/graphics.json`
- `packages/apps/catalog/organisations.json`
- `packages/apps/catalog/place_categories.json`
- `packages/apps/catalog/places.json`
- `packages/apps/catalog/todo_lists.json`
- `packages/apps/catalog/todos.json`
- `packages/files/src/server/recordFileStore.js`
- `packages/apps/src/server/schema.js`
- `packages/apps/src/shared/where.js`
- `packages/apps/src/shared/formulas.js`
- `packages/apps/src/shared/calculated.js`
- `migrations/20261113120000_baseline.cjs`
- `migrations/20261125120000_app_settings_starter_apps.cjs`
- `src/components/apps/AppsTable.vue`
- `src/components/apps/RecordDialog.vue`
- `src/components/apps/RecordFileField.vue`
- `src/components/apps/fieldValues.js`
- `src/components/apps/tableLinks.js`
- `src/components/apps/linkPickers.js`
- `src/components/apps/AppsActivity.vue`
- `src/components/apps/sheets.js`

## Public contract

- Records live in json-rest-api's AnyAPI storage, one tenant per home (`ws:<id>`); tables and
  fields have permanent ids (`t_…`, `f_…`) that are AnyAPI's resource and field names, while keys
  and labels live in `app_tables`/`app_fields`. Renaming changes only the registry. Field types:
  text, email, phone, choice, link, number, money (whole cents), date (YYYY-MM-DD), yesno, and
  (D-130) person (a member's user id, checked against the home's members whenever a write sets it,
  so a record keeps a member who has left until someone sets another, and labelled by name,
  "Former member" once gone), tags (a list of words, optionally from `choices`),
  url (http or https), longtext (up to 20,000 characters), datetime (an ISO moment) and file and
  image (below). A link takes an indexed text slot as it's made (`fieldStorage` in `anyapi.js`, for a new table and an
  added field alike), so filtering by it is indexed. Five to a table, removed ones included; a sixth is refused
  (`apps_table_slots_full`). AnyAPI keeps a stored field's slot, so a link made before links were indexed stays in a
  plain slot. A link may be `unique`: one live record at most per target, checked in the
  write's transaction under an advisory lock (`recordChecks.js`, 409 `apps_link_unique_taken`), and
  for an import's rows once among them and against the table, in one read per such field
  (`uniqueTakenIn`), which makes its table a one-to-one extension. In filters, `"x" in tags` is one `jsonb_exists`
  (only for a list field: `"x" in` a text is no database query), and an empty field, `""` to formulas and null in
  the database, is found by a `== ""` written in the formula (null or empty text; a date and time's, a number's and
  a yes/no's slot is only ever null). An empty value the formula
  reads (a signed-out visitor's email, a missing `params.id`, `me.id` for a bot) is compared as it is,
  so `owner == visitor.email` never reaches every record nobody owns.
- Each table has a fixed number of AnyAPI slots for each kind of value (`schema.js`'s `SLOTS`: 10 for tags, files
  and pictures together), taken for good by every field made, removed ones included; a field past them is refused
  (409 `apps_table_slots_full`, naming the kinds and the number) and the table stays as it was.
- **Database files** (D-130): a file or picture field's value is `{ path, name, size, type }` (never
  required, `apps_file_required`: its file goes on once the record exists), set only by the gate (`attachFile`, `recordFiles.js`; a value sent by path is refused,
  `apps_value_file_from_upload`). The files feature plugs its writer in at start
  (`useRecordFiles`), which copies the file to `/files/db/tables/<table>/<record>/<field>/<name>`
  in the home's storage before the change; a change that fails removes it, and one that replaces
  or clears it removes the old one after it's in. A picture is PNG, JPEG, GIF or WebP by its
  bytes. A draft's practice data and a visitor add none. Uploads come through
  `POST app-data/tables/:key/records/:id/files/:field` (the files' size limit and picture and
  video check). `recordFile` serves one by record and field through the gate's visitor rules, for
  a copy's public routes. Files lists `/files/db` read-only in every place (files.md).
- **Related records** (`gate.related`, `relatedRecords.js`): the records linking to one, grouped by
  table and link field, the first 10 of each with its count. That's one read per link field
  pointing at the table, whatever the counts.
- **The catalog** (`tableCatalog.js`, `packages/apps/catalog/*.json`, D-130): twelve shared tables,
  checked at start (`catalogProblems`; a broken file stops the server, naming the problem).
  `ensureTable` makes one with the tables its links need first, once (a same-key table is reused
  and only gains fields; seed rows go only into a table it made). `ensureExtension` and
  `ensureOwnTable` make a one-to-one extension and a template's own table. `catalogMatch` finds a
  shared table by key, label or alias, singular or plural. On `mercbot.apps` as `catalog`.
- **Starter apps** (`starterApps.js`): the home's list of apps (`GET /apps`, which its sidebar
  reads as it opens) first installs Contacts and To-dos, empty and published, once per home
  (`app_settings.starter_apps_at`, claimed under a row lock; cleared and retried at the next open
  after a failure). A home with an app of that name keeps its own. One read when they're there.
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
  `app-data/tables/:key/records/:id/related`, `app-activity` (filters table, app, person or bot, dates; paged by id). The person-or-bot filter
  reads `ix_audit_events_actor` (home, actor id, id desc): its list jumps from one actor id to the
  next (a recursive loose index scan), each with their latest entry's type and name, and one
  actor's page reads only their entries, so neither grows with the home's history.

## Proved by

- `tests/server/appsRegistry.integration.js`
- `tests/server/appsDataGate.integration.js`
- `tests/server/appsImport.integration.js`
- `tests/server/appsWhere.test.js`
- `tests/server/appsCalculated.test.js`
- `tests/server/appsCalculated.integration.js`
- `tests/client/appsLinkPickers.vitest.js`
- `tests/server/appsFieldTypes.test.js`
- `tests/server/appsSharedFields.integration.js`
- `tests/server/appsRecordFiles.integration.js`
- `tests/server/tableCatalog.test.js`
- `tests/server/appsCatalog.integration.js`
- `tests/server/appsStarter.integration.js`
- `tests/client/fieldValues.vitest.js`
- `tests/client/tableLinks.vitest.js`
