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
- `packages/apps/src/server/scriptDrafts.js`
- `packages/apps/src/server/scriptPeople.js`
- `packages/apps/src/server/scriptSchedule.js`
- `packages/apps/src/server/scriptDocs.js`
- `packages/apps/src/server/scriptComputer.js`
- `packages/apps/src/shared/schedules.js`
- `migrations/20261205130000_app_scripts_drafts.cjs`

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
  `job` (settings `{ every, at, day, days, dayOfMonth, timeZone }`, `every` 15min, hour, day, week or month
  (`scriptSchedule.js`, described in words by `shared/schedules.js` `jobSchedule`), or `{ watch: { table, on, condition } }`,
  given up to 100 changes a run with how many more; claimed
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
  In a test copy (`APP_ENV` development, test or staging, D-69, D-87) any method but GET is logged,
  not sent, and answers status 200 with no body; a copy without `APP_ENV` is refused.
- Owners and admins switch a script off and on (`PUT /api/w/:slug/apps/:app/scripts/:key/enabled`,
  the Logic tab's Turn off): a switched-off rule stops checking saves, a switched-off button or
  data script says so in place, and a job stops running. The Builder removes one with
  `script_remove` when the person agrees.
- Runs are kept (`app_script_runs`, last 200 per script) with time, calls, error and log, a row
  per run; a save records its rules' runs at once, an import (`beforeSaveEach`'s `flush`) records
  all of its rows' rule runs together once the rows are checked, a dry or failed import's too;
  `GET /api/w/:slug/apps/:app/scripts` returns an app's scripts, runs and coding-loop rounds.

- **Drafts (D-139, `scriptDrafts.js`):** saving or removing a script writes the app's draft row (`app_scripts.draft`,
  `removed`; unique app, key and draft); the live app runs live rows only, a draft's preview the draft's (rules
  included). `apps.publish` copies each draft onto its live row in the publish's transaction and keeps the live scripts
  on the version (`app_versions.scripts`); `apps.restore` makes a version's scripts live again. Switching off or on acts
  on the live row at once.
- **All or nothing (D-140):** a button's, a job's and a screen's data script's run is one transaction (`wholeRun`,
  `WHOLE_RUNS`); the gate's writes and the record store's calls join it (`boundTo`), and so does queued AI work. A
  job's budget (`LIMITS.job`) is 5 s, 60 s and 200 record calls.
- **Who acted (D-140, `scriptPeople.js`):** a rule's `actor` is `{ type, id, name, role }`, and buttons', screens' and
  jobs' scripts get `people.me()` (null for a visitor); the role comes from the request's membership, else the home's
  (`roleOf`, a required collaborator).
- **Values (D-140):** scripts read tags as a list, a file or picture as `{ name, size, type }` and a link as its id.
- **Personal tables (D-145):** a button's, screen's or rule's run reaches only its person's records of a personal table;
  a job's run is marked `everyone` and names `whose` on what it adds. A button's script may return `celebrate`.
- **An app's own bot (D-144):** `ai.work` and `ai.picture` with the bot "default" (or none) go to the app's bot
  (`apps.bot_id`, a template's, D-144) while it's in the home, else the home's main bot; a bot named is that bot.
- **Documents (D-140, `scriptDocs.js`):** `docs.pdf({ template, record, into, name })` for buttons and jobs, 3 a run:
  the template's `{{field}}` and `{{lines:table:link:fields}}` filled and escaped, made a PDF through the gate
  (`gate.makeDocument`, the files feature's `pdf` plug-in, 503 `apps_documents_unavailable` without the office apps).
  `docs.text({ record, field })` (D-143), 3 a run: the record's file read as the run (`gate.recordFileText`), text,
  Markdown and CSV as they are, documents, spreadsheets, presentations and PDFs by the files feature's `text` plug-in;
  `{ name, text, more }`, at most 1,000,000 characters; another kind is 415 `apps_file_not_text`.
- **Programs on the bot's computer (D-146, `scriptComputer.js`):** `computer.run({ command, files, recordFiles, seconds,
  bring, keep })` for buttons (1 to 20 s, 3 a run) and jobs (1 to 300 s, 10 a run), on the computer of the app's bot
  (else the home's main bot), through the files feature's `programs.js` (`useComputer`, shell.md): `/work` holds the
  script's text files, records' files copied in through the gate (`recordFiles`, 3) and the app's own files (its
  definition's `computer.files`, the draft's in a preview) read-only in their place; no internet unless the definition
  says `computer.internet`. Answers `{ exitCode, output, seconds, timedOut, files, kept }`: `bring`'s text files back,
  `keep`'s files on a record's file field (`gate.attachFile`, as the run; only pretended in a preview). The pool's wall
  clock stands still while it runs (`scriptPool.js` `untimed`). Refused for a visitor, and 503
  `apps_computer_unavailable` where the server has no sandbox; the save check refuses `computer` on a public app and
  checks its files' names and sizes (`check.js` `checkComputer`). Script tests answer it as `computer: { run }`; the
  browser gets the files' names only (`GET …/apps/:slug`).
- **Watching jobs on personal tables (D-146):** a job's changes are matched as everyone (`matchChanges` `everyone`), so
  each person's change sets it off.
- `notify.member` and `notify.email` for jobs are sending.md's.

## Proved by

- `tests/server/appsSandbox.test.js`
- `tests/server/appsScripts.integration.js`
- `tests/server/appsScriptDrafts.integration.js`
- `tests/server/appsWholeRuns.integration.js`
- `tests/server/appsWhoActed.integration.js`
- `tests/server/appsScriptValues.integration.js`
- `tests/server/appsDocs.test.js`
- `tests/server/appsDocs.integration.js`
- `tests/server/appsStudy.integration.js`
- `tests/server/appsComputer.integration.js`
- `tests/server/appsPersonalTables.integration.js`
- `tests/server/appsLlmCourse.integration.js`
- `tests/server/appsLearnToProgram.integration.js`
