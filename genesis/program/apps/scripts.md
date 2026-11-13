# Scripts

Gives apps abilities screens and formulas don't have (D-35, owner 2026-10-29: "make it
powerful"): the Builder writes small scripts with tests; they run sealed off in QuickJS, and
everything they read or write goes through the data gate, audited as the script.

## Sources

- Main: `packages/apps/src/server/scripts.js`
- `packages/apps/src/server/scriptChecks.js`
- `packages/apps/src/server/scriptPool.js`
- `packages/apps/src/server/scriptWorker.js`
- `packages/apps/src/server/webAccess.js`
- `packages/apps/src/shared/sandbox.js`
- `packages/apps/src/shared/formulas.js`
- `packages/apps/src/shared/check.js`
- `packages/apps/src/server/runtime.js`
- `packages/apps/src/server/dataGate.js`
- `packages/apps/src/server/watches.js`
- `src/components/apps/AppLogic.vue`
- `src/components/apps/AppsScripts.vue`
- `src/components/apps/scriptFunctions.js`
- `migrations/20261113120000_baseline.cjs`
- `tests/server/appsSandbox.test.js`
- `tests/server/appsScripts.integration.js`

## Public contract

- A script (`app_scripts`, one per app and key, versioned and audited as action `script`) has a
  kind, a summary people read, code defining `main`, tests and settings. It is saved only when
  `checkScript` passes and every test passes against an in-memory stand-in of the record
  functions (seeded by the test's `records`, answering `web.fetch` from its `web`); people read
  scripts in the app's Logic tab and never edit them.
- Kinds: `action` (button step `{ runScript: { script, input } }`, returns notify / go /
  openDialog; not on public screens), `source` (screen query `{ script, input }`: a list for
  tables, `[{ label, value }]` for totals and charts, one object for single values; allowed on
  public screens, where it runs with the visitor's access and reaches only what the app lists,
  D-66), `rule` (settings `{ table, on }`; runs inside the data gate before every
  create and update by anyone; `{ refuse }` stops the save with that message, `{ set }` fills
  fields; a failing rule stops the save; rules only read), `function` (settings `{ params }`; pure
  and synchronous; formulas call it by key on the server and in the browser, never in filters),
  `job` (settings `{ every, at, day, timeZone }` or `{ watch: { table, on, condition } }`; claimed
  once across servers by the watches loop; a job's own writes don't set it off again).
- Sandbox: fresh QuickJS runtime per run in pooled worker threads (2 warm, 4 top-level runs per
  server; runs started while another script's call is answered skip the queue); 1 s of the
  script's own running time, 32 MB, 256 KB stack, worker heap 64 MB, wall watchdog 30 s (rules
  10 s) that replaces the worker; 50 record calls and 5 web calls per run; JSON only in and out;
  `console.log` kept with the run. Formula functions run in the main thread (100 ms, 8 MB).
- Record functions: `records.list/get/totals/create/update/markObsolete`, by field name (links as
  ids, money in cents); `where` is a formula over the table with `params`.
- `web.fetch(url, options)` reaches only https origins on the home's list (`app_web_access`,
  owners and admins: `GET /api/w/:slug/apps-scripts`, `PUT /api/w/:slug/apps-web-access`), never
  private addresses (checked on the connected address), no redirects, 10 s and 1 MB per call;
  secret headers are sealed with `MERCBOT_VAULT_KEY`, added by the server and never shown again.
  In a test copy (`SIDE_EFFECTS` not `live`, D-69) any method but GET is logged, not sent, and
  answers status 200 with no body.
- Owners and admins switch a script off and on (`PUT /api/w/:slug/apps/:app/scripts/:key/enabled`,
  the Logic tab's Turn off): a switched-off rule stops checking saves, a switched-off button or
  data script says so in place, and a job stops running. The Builder removes one with
  `script_remove` when the person agrees.
- Runs are kept (`app_script_runs`, last 200 per script) with time, calls, error and log, a row
  per run; a save records its rules' runs at once, an import (`beforeSaveEach`'s `flush`) records
  all of its rows' rule runs together once the rows are checked, a dry or failed import's too;
  `GET /api/w/:slug/apps/:app/scripts` returns an app's scripts, runs and coding-loop rounds.
