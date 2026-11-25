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
- `migrations/20261122120000_chats_core.cjs`
- `packages/bots/src/server/backgroundRuns.js`
- `packages/apps/src/server/registerRoutes.js`

## Public contract

- A watch (`app_watches`) belongs to a bot in the chat it was made in (its seat, `chat_bot_id`, D-112) and runs as
  the person who made it (`created_by`, R4): a table, `on` create/update/any, an optional CEL condition over the
  record's fields (bare or `row.x`), `before` and `changed`, and instructions; its name is its own among that bot's
  watches in that chat. Bots make and manage them with `watch_*` tools; people list, pause, resume or remove the ones
  in the chats they can open (`/api/w/:slug/apps/watches[?bot=]`, the row policy of the watch's chat; one in a chat
  they can't open is 404). Taking the bot out of the chat, or deleting the chat, deletes its watches there.
- Every serving server runs the evaluation loop. A watch is claimed with SKIP LOCKED and reads
  `audit_events` between its cursor and the transaction horizon (`pg_snapshot_xmin`), so every
  change is seen exactly once even when transactions commit out of order. The changed records
  are read together (`gate.getMany`), so the claim's lock is short at any size. Matches become one
  task per claim (20 records shown, the rest counted). Changes made by the watch's own run never
  fire it. It runs at most 30 times an hour (D-134): at each firing its limit counts its runs in the hour and its
  tasks still waiting (`repository.waitingTasks`, the `ix_app_jobs_waiting_watch` index), so a backlog in the shared
  runner never runs more; the firing over that pauses it and records what the limit counted (`runs_in_hour`, over 30:
  paused by its limit), and its task is queued as any other. New and resumed watches only see changes from then on. A run is one its bot worked on (`watches.ran`, from `backgroundRuns.js` once the run's
  first AI call goes out): it adds one to the watch's runs in the hour (a new hour when the hour's first run was an hour
  ago) and is kept as its `last_run_at`; a task that only said its home is paused is neither. The list shows a watch
  paused by its limit (`pausedByLimit`), for the home's recurring tasks (D-132, `genesis/program/bots/routines.md`),
  which also lists every app's job.
- A button's `askBot` step queues a task for that bot after all its other steps succeed; a draft
  preview only reports it (`wouldSend`).
- Tasks (`app_jobs`) are claimed with SKIP LOCKED and run once: a watch's in its seat, as the watch's maker, a
  hand-off in the presser's direct chat with the bot (made on first use), as the presser (`backgroundRuns.js`
  `taskSeat`); an archived bot takes none, and the button that asked says so (D-108). A watch's task that finds its
  watch paused since it was queued, by its limit or a person, or removed, runs nothing (D-134): `watches.whyNotRun`
  gives the one line saying why, which the chat gets as a paused home's (botReplies' `respond` with `stopped`, posted
  once until someone writes), without the task's own line, and it's no run (D-132).
  `watches.pauseIn` pauses running watches and answers each `{ chatBotId, name }`: a bot's in the chats given
  (`chatBotIds`: the bot archived, D-108, or a Public chat archived, through the bots' `pauseWork`) or a person's in a home they left (`createdBy`, `homeId`), each chat saying
  so (`genesis/program/bots/routines.md`).
  A claimed task gets a run id and a 90-second lease its runner renews (D-59); a task whose server
  stopped (lease lapsed) is taken over by one server with a new run id and carried on from its
  saved `steps`, and only the run holding it writes its result and its end, in one transaction.
  A task stops at its next step once its runner can't be sure it holds it (`runLease.js`
  `keepLease`, as a routine's run does), and is then left unfinished for the server carrying it on.
  A server that stops hands its tasks over at once, ending their lease, and publishes `apps-jobs`,
  on which every other server's runner claims them straight away.
  A task tried three times is given up as failed. Tasks left running before leases existed have
  none and are never taken over.
  The chat shows "Watch: …" or "Task from …", then the bot's reply. Record values reach the bot
  as data only, never instructions; public visitors' values are marked untrusted. Writes made in
  a watch run are audited `via { kind: "watch", watchId }`, in a task `via { kind: "task" }`.

## Proved by

- `tests/server/appsWatches.integration.js`
- `tests/server/appsJobs.integration.js`
- `tests/server/appsHandoff.integration.js`
- `tests/server/backgroundPerson.integration.js`
- `tests/server/archiveBots.integration.js`
- `tests/server/archiveChats.integration.js`
