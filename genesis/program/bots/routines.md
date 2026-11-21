# Routines

A bot does something on a schedule in a chat (D-15, D-112, R4): a routine belongs to one bot in one chat and runs as
the person who made it. This boundary owns making and changing routines from chat, the routine runner every server
runs, and how people list, pause, resume and delete them.

## Sources

- Main: `packages/bots/src/server/chatRoutines.js`
- `packages/bots/src/server/routineTools.js`
- `packages/bots/src/server/routineSchedule.js`
- `packages/bots/src/server/routineRunner.js`
- `packages/bots/src/server/runLease.js`
- `packages/bots/src/server/backgroundRuns.js`
- `packages/bots/src/server/botActions.js`
- `packages/bots/src/server/botReplies.js`
- `packages/bots/src/server/workPause.js`
- `packages/bots/src/server/registerRoutes.js`
- `packages/bots/src/server/records/workRepository.js`
- `migrations/20261122120000_chats_core.cjs`
- `migrations/20261119180000_routine_feeds.cjs`
- `src/components/mercbot/useBotRoutines.js`
- `src/components/mercbot/MercbotChatDetails.vue`
- `src/components/mercbot/MercbotMemberCard.vue`

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
run at once. Where its runs read an app's events feed up to (`feeds`, D-94: Sedna's, by account) is written only when a
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
- Each routine is shown as `{ id, name, schedule, enabled, botId, chatId, chatTitle, madeBy, canResume }`, naming its
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

## Proved by

- `tests/server/chatRoutines.integration.js`
- `tests/server/routineRuns.integration.js`
- `tests/server/routineHistory.integration.js`
- `tests/server/routineSchedule.test.js`
- `tests/server/runLease.test.js`
- `tests/server/backgroundPerson.integration.js`
- `tests/server/archiveChats.integration.js`
