# Practice data and trying drafts

A draft's preview, and the Builder trying it, read and write a practice copy of the home's records
instead of the live ones, so Save works in a preview without touching the live app (D-71).

## Sources

- Main: `packages/apps/src/server/practice.js`
- `packages/apps/src/server/trial.js`
- `migrations/20261113120000_baseline.cjs`
- `tests/server/appsPractice.integration.js`

## Public contract

- One `app_practices` row per draft version (`ux_app_practices_version`) holds the copy's id, the
  tables copied into it so far (`copied`) and when it was last used (`used_at`, touched at most
  hourly). `of(app, versionId)` finds or makes it (two first uses at once get the same row).
- The copy's records are AnyAPI's, under the tenant `ws:<home>:p:<copy id>` (`anyapi.js`
  `practiceFor`), with the same tables and fields as the home's; a new field or table is there at
  once and a removed field drops out. `ensure` copies a table the first time the copy needs it,
  under the row's lock: its newest `PRACTICE_RECORDS` (1,000) records by AnyAPI's row id, with their
  ids, so links between copied records hold. A link to a record outside them shows as missing.
- The data gate takes a practice in its ctx (`ctx.practice`): reads and writes go to the copy,
  linked tables copied as needed, nothing is audited or announced, and each write is listed in
  `practice.changes`. `runtime.js` gives a draft's queries and buttons a practice, never a
  visitor's; scripts run on it with web calls other than GET simulated (`practice.simulated`), and
  their runs aren't kept; askBot is only reported (`wouldSend`).
- `remove(versionId, txOptions)` drops a copy inside the caller's transaction (publishing calls it);
  `reset` drops it and makes a new one (`POST …/apps/:slug/practice/reset`); `sweep`, run with the
  watch loop's pruning on every serving server, clears copies unused for 7 days, each claimed with
  SKIP LOCKED, then records under a copy whose row is gone.
- `trial.tryScreen` backs the Builder's `app_try` (genesis/program/bots/app-tools.md): it runs a
  draft screen's queries on the copy and describes what it shows (text, fields, the first rows of a
  table with their buttons, forms, totals, hidden parts and formula errors), optionally pressing a
  button, by its path or label, with a row and form values first: what was saved, record by record,
  a refusal's message, effects and what was only reported. It follows a `go` to the screen it ends on.
