# Routines

A bot does something on a schedule in a chat (D-15, D-112, R4): a routine belongs to one bot in one chat and runs as
the person who made it. This boundary owns making and changing routines from chat, the routine runner every server
runs, how people list, pause, resume and delete them, and the home's list of every recurring task with what each costs
(D-132).

## Sources

- Main: `packages/bots/src/server/chatRoutines.js`
- `packages/bots/src/server/routineTools.js`
- `packages/bots/src/server/routineSchedule.js`
- `packages/bots/src/server/routineRunner.js`
- `packages/bots/src/server/recurringTasks.js`
- `packages/bots/src/server/runLease.js`
- `packages/bots/src/server/backgroundRuns.js`
- `packages/bots/src/server/botActions.js`
- `packages/bots/src/server/botReplies.js`
- `packages/bots/src/server/workPause.js`
- `packages/bots/src/server/registerRoutes.js`
- `packages/bots/src/server/records/workRepository.js`
- `migrations/20261122120000_chats_core.cjs`
- `migrations/20261119180000_routine_feeds.cjs`
- `migrations/20261127120000_usage_tasks_daily.cjs`
- `migrations/20261128120000_usage_tasks_daily_checks.cjs`
- `src/components/mercbot/useBotRoutines.js`
- `src/components/mercbot/MercbotChatDetails.vue`
- `src/components/mercbot/MercbotMemberCard.vue`
- `src/components/mercbot/MercbotSettingsRecurringTasks.vue`
- `src/components/mercbot/recurringTasksView.js`

## Public contract

**A routine** is a `bot_routines` row of the bot's seat in a chat (`chat_bot_id`), with who made it (`made_by`), a
name, a plain-words schedule, a five-field cron pattern in an IANA time zone, its instructions, whether it's on, its
next run, its failures in a row and, for a one-off (`once`), that it removes itself after running. Taking the bot out
of the chat, or deleting the chat, deletes its routines there.

**From chat** (`routineTools.js`): the bot creates and changes routines with `create_routine` and `update_routine`,
for itself in this chat, each an approval action (reversible: it asks only when a rule says so), each carrying a short
acknowledgement posted before its "Created routine", "Updated routine", "Started routine" or "Paused routine" line;
the bot then confirms the schedule in plain words with the time zone and the next run as a clock time. Runs are at most
every 10 minutes ("Routines can run at most every 10 minutes."). The state note lists the bot's routines in this chat.

**Running** (`routineRunner.js`, `backgroundRuns.js`): every server, once listening, claims due routines every 30
seconds with `FOR UPDATE SKIP LOCKED` and moves the next run on before running it, so each run happens on exactly one
server, and runs missed while every server was down collapse into one. A run is a bot reply in the routine's seat, as
its maker, to a scheduler prompt; it reads the routine's instructions and its own last 3 runs, not the chat or its
summary (D-57). It posts an ordinary message (marking the chat unread), nothing when the bot calls `nothing_new`, or a
short failure message. A claimed run holds its routine with a run id and a 90-second lease its server renews every 20
seconds (`runLease.js`) and saves its steps; when nothing is due, the loop takes over a run whose lease lapsed under a
new run id and carries it on from its saved steps, so the stopped server's result is never posted, and one tried three
times is given up as failed. The lease is an AbortSignal handed to the agent loop, so two servers never work on one
run at once. A server that stops hands its runs over at once (they stop at their next step and their lease ends) and
publishes `routines`, on which every other server's loop claims them straight away. Where its runs read an app's events feed up to (`feeds`, D-94: Sedna's, by account) is written only when a
run ends well. The fifth failed run in a row pauses the routine with a "Paused routine" line saying how to resume it;
a run that works, a resume, or a run whose work was refused (D-73) sets the count back to 0. A one-off is deleted after
its run with a "Routine finished and removed" line. In a paused home the bot starts nothing new and says why once.

**Who it runs as** (R4): only its maker. One whose maker can no longer open its chat (they left it, or the home) or
whose account is gone pauses with a "Routine paused" line saying why; one whose seat, chat or bot is gone or archived
ends unrun. Archiving the bot, or a Public chat it's in, pauses its routines there first with a "Paused while
archived" line, and unarchiving leaves them paused, to be resumed by their maker. When someone leaves the home, the routines and
watches they made are paused first with a "Paused: its maker left" line (`workPause.js`).

**Routes** (under `/api/w/:workspaceSlug`; `chatRoutines.js`):
- `GET …/chats/:chatId/routines`: the routines of every bot in the chat, for anyone who can open it (404 otherwise).
- `GET …/bots/:botId/routines`: a bot's routines in the chats the person can open, and no others (R11).
- Each routine is shown as `{ id, name, schedule, enabled, once, failures, nextRunAt, lastRunAt, botId, chatId, chatTitle,
  madeBy, canResume }`, naming its
  bot and chat (a direct chat by its person, "you" or their name): two reads for any number of chats.
- `PATCH …/routines/:routineId {enabled}` (400 `bots_routine_enabled` without a boolean): anyone who can open its
  chat pauses it; only the person it runs as resumes it (403 `bots_routine_resume_forbidden` "Only the person who made
  this routine can resume it: it runs as them."), never while its bot (409 `bots_bot_archived`) or chat (409
  `bots_chat_archived`) is archived. Resuming clears its failures in a row and counts its next run from now.
- `DELETE …/routines/:routineId`: by anyone who can open its chat. A routine the person can't reach answers 404
  `bots_routine_not_found`.

**On the page** (`useBotRoutines.js`): Chat details → Routines lists the chat's routines, each with its name, schedule
or "Paused" and its bot, a switch (anyone pauses; only its maker resumes), Edit and Delete ("It stops for good, in
this chat and everywhere."); with none, "No routines run in this chat. Ask a bot here to do something on a
schedule." A bot's card lists its routines, each naming its chat. Search lists every routine in the chats the person
can open (`genesis/program/bots/chats.md`).

**Recurring tasks** (D-132; `recurringTasks.js`, `GET …/recurring-tasks`): every routine and watch in the chats the
person can open, and every app's job (`kind: "job"`), each `{ kind, id, name, detail?, bot, where, schedule, nextRunAt,
lastRunAt, state, why, madeByYou, cost, can }`: `where` is its chat (`chatId`, `chatTitle`) or app (`appSlug`,
`appName`); `schedule` is in words (a routine's own; "When Deals records are added" for a watch; "Every day at 02:00
(Europe/Rome)" or "When Weigh-ins records change" for a job, named from its key, its summary as `detail`); `state` is
`running`, `paused` or `failing` (a routine paused by 5 failed runs in a row, a watch by firing more than 30 times in an hour (D-134),
a job whose last run failed), with `why` in words. `cost` is the last 30 days' `{ nano, runs }` from the account's task
totals (`meter.taskCosts`, below), `{ nano: 0, runs: 0 }` when nothing is counted and null when the person can't see it:
owners and admins see every task's (`costScope: "home"`), a member only those that run as them (`"own"`). Apps' jobs
run without AI. `can` says which of the existing routes the person may use: a routine's and a watch's switch (pause:
anyone who can open its chat; resume: its maker) and delete; edit (a routine's maker, neither its chat nor its bot archived, as Chat details' Edit, through its chat); a job's switch,
owners and admins only. Owners and admins also get `others: { count, costNano }`, the routines and watches in chats
they can't open, unnamed (read with the bots' system context), and everyone `notListedNano`, what tasks since deleted
(and, for a member, theirs in chats they've left) cost. Its reads are the same number however many tasks, apart from the costs, read a page of 100 tasks' totals at a
time; it reads only the columns it shows (never a running routine's saved steps), apps' jobs alone of their scripts
(`scripts.overview({ kind: "job" })`), and, for the unseen count, only ids (`routineIdsOfHome`, `watches.idsOfHome`).

**What a task costs** (D-132; `packages/account`): a routine's run and a watch's run are tracked with their task
(`meter.track({ …, task: { kind, id } })`), which work started inside carries on. Each AI call and command's
computation made for a task adds its calls and cost to `usage_tasks_daily` (home, UTC day, task, the person it runs as),
and each run adds one once its bot works: when the run's first AI call goes out (`meter.track`'s `onWork`,
`backgroundRuns.js`), once, by the server that started it (`meter.countTaskRun`, never again for a run taken over). The
same moment sets the task's last run (a routine's `last_run_at`; a watch's with its runs in the hour, `watches.ran`). A
run in a paused home, or whose work is refused at its first call, only says why (D-73) and is none of these; a
computer's day is never a task's. A copy that records work its own way (`mercbot.usage-recorder`) adds its own columns
there and answers `spending.tasks`. Rows are kept 13 months, then deleted by the usage upkeep. Costs count from this
release; earlier runs show none.

**Settings → Recurring tasks** (`MercbotSettingsRecurringTasks.vue`): a top line ("3 running · 1 paused · 1 needs
attention" and the last 30 days' cost the person sees), filter chips (All, Routines, Watches, App jobs, Paused, Needs
attention; each shown when it has tasks), By bot or By cost, the tasks grouped under each bot's face (apps' jobs last),
each row with its name, kind, where (a link that opens its chat or app), when, why, cost, a switch (disabled with a
tooltip saying who may) and a menu (Open chat or Open app, Edit, Delete, confirmed); then the unseen and no-longer-listed
lines and how costs are counted. With none: "No recurring tasks yet" and an example to ask for. A bot's card links to it
under its routines, opening it at that bot ("Only Scout", closable); `?settings=recurring-tasks&bot=<id>` does the same.

## Proved by

- `tests/server/chatRoutines.integration.js`
- `tests/server/routineRuns.integration.js`
- `tests/server/routineHistory.integration.js`
- `tests/server/routineSchedule.test.js`
- `tests/server/runLease.test.js`
- `tests/server/backgroundPerson.integration.js`
- `tests/server/archiveChats.integration.js`
- `tests/server/recurringTasks.integration.js`
- `tests/server/usage.integration.js`
- `tests/client/recurringTasks.vitest.js`
