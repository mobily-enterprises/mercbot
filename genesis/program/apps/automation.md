# Watches and bot tasks

Bots act by themselves when a home's records change (watches), and buttons hand bots tasks; both
become queued tasks that exactly one server runs, in the right chat (D-35, D-15).

## Sources

- Main: `packages/apps/src/server/watches.js`
- `packages/apps/src/server/apps.js`
- `packages/apps/src/server/runtime.js`
- `packages/bots/src/server/appJobRunner.js`
- `src/components/apps/MercbotAppsSection.vue`
- `migrations/20261113120000_baseline.cjs`
- `tests/server/appsWatches.integration.js`
- `tests/server/appsJobs.integration.js`
- `tests/server/appsHandoff.integration.js`

## Public contract

- A watch (`app_watches`) belongs to a bot and the conversation it was made in: a table, `on`
  create/update/any, an optional CEL condition over the record's fields (bare or `row.x`),
  `before` and `changed`, and instructions. Bots make and manage them with `watch_*` tools;
  people pause, resume or remove them in the bot's Details (`/api/w/:slug/apps/watches`).
- Every serving server runs the evaluation loop. A watch is claimed with SKIP LOCKED and reads
  `audit_events` between its cursor and the transaction horizon (`pg_snapshot_xmin`), so every
  change is seen exactly once even when transactions commit out of order. The changed records
  are read together (`gate.getMany`), so the claim's lock is short at any size. Matches become one
  task per claim (20 records shown, the rest counted). Changes made by the watch's own run never
  fire it; over 30 runs in an hour it pauses itself and its bot says so. New and resumed watches
  only see changes from then on.
- A button's `askBot` step queues a task for that bot after all its other steps succeed; a draft
  preview only reports it (`wouldSend`).
- Tasks (`app_jobs`) are claimed with SKIP LOCKED and run once: a watch's in its
  conversation, a hand-off in the bot's chat with the person who pressed (or its room if shared).
  A claimed task gets a run id and a 90-second lease its runner renews (D-59); a task whose server
  stopped (lease lapsed) is taken over by one server with a new run id and carried on from its
  saved `steps`, and only the run holding it writes its result and its end, in one transaction.
  A task stops at its next step once its runner can't be sure it holds it (`runLease.js`
  `keepLease`, as a routine's run does), and is then left unfinished for the server carrying it on.
  A task tried three times is given up as failed. Tasks left running before leases existed have
  none and are never taken over.
  The chat shows "Watch: …" or "Task from …", then the bot's reply. Record values reach the bot
  as data only, never instructions; public visitors' values are marked untrusted. Writes made in
  a watch run are audited `via { kind: "watch", watchId }`, in a task `via { kind: "task" }`.
