# Bots and conversations

Owns each person's bots, their conversation timeline, the scripted first-run
onboarding and the bot's typed replies.

## Sources

- Main: `packages/bots/src/server/BotsFeature.js`
- `packages/bots/src/server/registerRoutes.js`
- `packages/bots/src/server/botLoops.js`
- `packages/bots/src/server/types.js`
- `packages/bots/src/server/botsError.js`
- `packages/bots/src/server/botsService.js`
- `packages/bots/src/server/botConversations.js`
- `packages/bots/src/server/botHistory.js`
- `packages/bots/src/server/backgroundWork.js`
- `packages/bots/src/server/botRows.js`
- `packages/bots/src/server/replyChecks.js`
- `packages/bots/src/server/botCards.js`
- `packages/bots/src/server/botTurns.js`
- `packages/bots/src/server/botReplies.js`
- `packages/bots/src/server/groupReplies.js`
- `packages/bots/src/server/botList.js`
- `packages/bots/src/server/botPalette.js`
- `packages/bots/src/server/botSettings.js`
- `packages/bots/src/server/botChat.js`
- `packages/bots/src/server/botTeaching.js`
- `packages/bots/src/server/botGroups.js`
- `packages/bots/src/server/botLibrary.js`
- `packages/bots/src/server/botMemory.js`
- `packages/bots/src/server/botWriting.js`
- `packages/bots/src/server/modelFailures.js`
- `tests/server/botModelFailures.test.js`
- `tests/server/eventStreams.test.js`
- `tests/support/botDoubles.mjs`
- `packages/bots/src/server/botRequests.js`
- `migrations/20261113120000_baseline.cjs`
- `src/components/mercbot/MercbotRequestCard.vue`
- `tests/server/botRequests.integration.js`
- `tests/server/botPalette.test.js`
- `tests/server/botLibrary.integration.js`
- `tests/server/findInChat.integration.js`
- `tests/server/builderRooms.integration.js`
- `tests/server/firstUse.integration.js`
- `tests/server/compaction.integration.js`
- `packages/bots/src/server/skills.js`
- `packages/bots/src/server/vaultLogins.js`
- `src/components/mercbot/MercbotSecureForm.vue`
- `src/components/mercbot/MercbotRoomTabs.vue`
- `src/components/mercbot/MercbotVoiceMemo.vue`
- `src/components/mercbot/MercbotDraftCard.vue`
- `packages/bots/skills/shopping.md`
- `tests/server/skills.test.js`
- `packages/bots/src/server/onboarding.js`
- `packages/bots/src/server/botAgent.js`
- `tests/server/leakedMarkup.test.js`
- `tests/server/turnContext.test.js`
- `tests/server/truthfulFiles.test.js`
- `tests/server/commandOutput.integration.js`
- `src/components/mercbot/MercbotTodoCard.vue`
- `tests/server/botGoals.integration.js`
- `tests/server/stopShort.integration.js`
- `tests/server/replyCheckpoints.integration.js`
- `tests/server/hearWhileWorking.integration.js`
- `tests/server/todos.integration.js`
- `tests/server/readFileParts.test.js`
- `tests/server/stoppedShort.test.js`
- `packages/bots/src/server/routineRunner.js`
- `packages/bots/src/server/runLease.js`
- `packages/bots/src/server/connectFollowUps.js`
- `packages/bots/src/server/records/followUpRepository.js`
- `tests/server/connectFollowUps.integration.js`
- `tests/server/routineRuns.integration.js`
- `tests/server/runLease.test.js`
- `packages/bots/src/server/signInCodes.js`
- `tests/server/signInCodes.test.js`
- `packages/bots/src/server/codingTools.js`
- `packages/bots/src/server/routineSchedule.js`
- `packages/bots/src/server/teaching.js`
- `packages/bots/src/server/mentions.js`
- `tests/server/mentions.test.js`
- `tests/server/teaching.test.js`
- `tests/server/approvalAction.integration.js`
- `tests/server/routineSchedule.test.js`
- `packages/bots/package.json`
- `tests/server/chatCatchUp.integration.js`
- `packages/bots/src/server/approvals.js`
- `packages/bots/src/server/botTools.js`
- `packages/bots/src/server/botActions.js`
- `packages/bots/src/server/routineTools.js`
- `packages/bots/src/server/botRequestTools.js`
- `packages/bots/src/server/draftTools.js`
- `packages/bots/src/server/cardTools.js`
- `packages/bots/src/server/memoryTools.js`
- `packages/bots/src/server/webTools.js`
- `packages/bots/src/server/accountTools.js`
- `packages/bots/src/server/calendarTools.js`
- `packages/bots/src/server/fileTools.js`
- `packages/bots/src/server/commandTools.js`
- `packages/bots/src/server/connectedApps.js`
- `packages/bots/src/server/googleApps.js`
- `packages/bots/src/server/googleApi.js`
- `packages/bots/src/server/googleDrive.js`
- `packages/bots/src/server/microsoftApps.js`
- `packages/bots/src/server/githubApps.js`
- `packages/bots/src/server/mailTools.js`
- `packages/bots/src/server/driveTools.js`
- `packages/bots/src/server/githubTools.js`
- `packages/bots/src/server/githubActions.js`
- `packages/bots/src/server/connectorTools.js`
- `tests/server/connectorTools.test.js`
- `packages/bots/src/server/eventMessage.js`
- `tests/server/mailTools.test.js`
- `tests/server/calendarInfo.test.js`
- `tests/server/driveTools.test.js`
- `tests/server/githubTools.test.js`
- `packages/bots/src/server/pictureMaker.js`
- `packages/bots/skills/pictures.md`
- `tests/server/googleApps.test.js`
- `tests/server/approvals.test.js`
- `tests/bench/handover.bench.js`
- `tests/server/onboarding.test.js`

## Public contract

Long chats are compacted in the background (D-41):
- A reply reads the conversation's newest summary (`agent_summaries`) and every message after
  the one it covers, word for word; the summary goes first, so the prompt only grows at the end and
  DeepSeek's prefix cache keeps hitting. Past 600,000 estimated tokens the oldest messages give way.
- After a reply (one-to-one, room, group or routine run), a conversation whose part since its last
  summary is over 450,000 estimated tokens (sized for the model's 1M window, D-48) is queued (`agent_summary_queue`, notice
  `bots-compaction`). Every serving server runs the runner; a conversation is claimed with SKIP
  LOCKED and a three-minute lease. The summariser (DeepSeek, metered to the person and bot) folds
  everything but the latest turns (up to 200 within 125,000 tokens, at least the last) into the
  previous summary, recall first: who and how, goals and status, decisions and changes, exact facts,
  what the bot did, promises, open questions. It replaces exactly the messages it covers, so
  messages said meanwhile stay as they are. A failure waits 1, 2, 4… up to 60 minutes; a newer
  summary from another server wins. Five summaries are kept per conversation.
- A room's first summary takes in the messages it inherited; group chats are summarised with each
  speaker's name. The page always shows the whole conversation.

Sharing (D-36):
- Each bot has `sharing` (`private`, `mixed` by default, or `shared`), which owners and admins
  change with `PATCH …/bots/:botId {sharing}`. Others get 403, and a group chat can't be shared.
- A shared bot talks in rooms: `bot_conversations` rows with no person and a required title,
  starting with "General".
- The list gives each shared bot `rooms` (title, parent, unread for this person) and the
  `roomId` the person last had open.
- `messages`, `send` and `reply` take the room.
- `POST …/rooms {title, from}` starts a tab that continues from `from`. The bot's history there
  is the parent's messages up to that moment, recursively, then the tab's own.
- `PATCH …/rooms/:roomId {title}` renames a tab.
- A shared Builder keeps one room per app (owner, 2026-10-30): `POST …/rooms/app {appId, title}`
  finds the app's room (`bot_conversations.app_id`, one per bot and app) or makes it fresh, named
  after the app, and opens it for the person; the Current state note names the room's app.
- Rows made on first use (a person's own conversation with a bot, the app's room, a member bot's
  computer for a group) are upserts on their unique keys (`bot_id` with `user_id`, `app_id` or
  `group_id`): several first uses at once make one row, and every caller gets it.
- People's messages in rooms carry `from {id, name}`, and the bot reads each message with the
  name.
- News about a room reaches everyone in the home, with `roomId`.
- In rooms, no one's memories, connected accounts, vault logins or own skills are used, and the
  bot's files are the shared bot's `everyone` folder.
- Unread is per person per room (`conversation_reads`).

The home notebook (D-36, mixed bots):
- Notes are `bot_notebook` rows. `note_for_home(text)` is offered only in a mixed bot's private
  chat that isn't kept out (`keep_out_of_notebook` on the person's own row).
- It refuses email addresses, runs of nine or more digits (dates aside) and the person's vault
  passwords.
- It posts a `note` line ("Noted for <home>: … Undo").
- Each reply's state lists the 40 newest notes as information, never instructions.
- `GET …/bots/:botId/notebook[?after=]` lists the notes for everyone in the home, 50 at a time,
  newest first: `{notes, next}`, where `next` (null on the last page) is the older page's `after`.
  Details reads it while its Details tab is shown, again as the bot's activity changes there, and
  shows older pages with Show more.
- `DELETE …/notebook/:noteId` sets `removed_at`: the note's author, owners and admins may do it
  (403 otherwise). The chat line then reads "Taken out of the notebook".
- `PATCH …/bots/:botId {keepOutOfNotebook}` keeps the person's chat out.

Authenticated routes under `/api/bots` list the person's bots with a preview
(each conversation's latest previewable message, one row per conversation),
return one bot exactly as the list shows it (`GET …/bots/:botId`, `{bot}`),
create the first bot (idempotent), return a bot's timeline with a cursor
(`{messages, cursor}`; with `?since=<cursor>` only the messages written or
changed since, see below), accept a typed
message and return it with the bot's reply, advance onboarding one step when
the expected step still matches, and record the chosen name while the name
question is open. Other people's bots answer 404. A model call that fails while
a route works answers 502 `bots_model_failed` ("The AI provider couldn't answer
just now. Try again in a moment."), never the provider's own status (401 for a
refused key, 429 for its limit, 5xx), which the page would read as its own. A
new bot's welcome and first question and the status line fall back on their
standard words instead, a bot's one answer for another feature (`answerOnce`,
below) is empty, and a failed reply ends with the bot's apology. Each failure is logged in one line with the provider's status and
the error's message, never the error, which carries the request. Timeline items are
timestamps, text from the person or bot, the name choice card, the app-connect
card and system events. Replies run on the agent loop (`@jskit-ai/agent`, D-52) with DeepSeek's Flash model, on the kind of
AI for the kind of work (D-59, D-72, `WORK` in `packages/account/src/server/providers/index.js`): the one chat model
`createChatModel` makes picks it on each call. Chats, groups, requests between bots and button hand-offs run on the
premium AI (Together); the Builder's own replies on the slower, cheaper AI (DeepInfra Standard); routines, watch runs,
finished background commands, goal rounds and summaries on its Flex tier. The Builder and background replies have 30
minutes instead of 15. Reasoning is adaptive on every step of the loop; the model keys stay on the server.

The agent loop (D-48; the full account, decisions and evaluations are in `docs/agent-loop.md`), one for every reply (own chat, rooms, groups, requests between bots, routines
and app tasks: `generateReply` and `generateGroupReply` in `botAgent.js` call `@jskit-ai/agent`'s `runLoop`; a group reply only brings its own instructions and history):
- **Goals:** for a multi-step job the bot opens a goal (`create_goal`, `get_goal`, `update_goal`,
  `agent_goals`); while one is active, each finished turn queues another round (`<goal_round>`),
  claimed with a lease, until it's complete, blocked (not before round 3) or at 24 rounds (then a
  "Stopped working on the goal" line says so), or when the job's model spend since the goal began
  (`usage_events` for that person and bot) reaches `AGENT_JOB_COST_USD` (5 dollars by default; 0
  for no limit), which the same line reports. A person's reply or round that runs out of steps
  or time opens a goal for the request and carries on in rounds by itself; its account says so.
- **Stopping short:** a reply under 600 characters that ends by announcing its next step, with no
  result, carries on once from its own steps (own chat, rooms and groups); with a goal active, the
  goal's next round does instead.
- **Saved steps:** a person's reply or a goal round writes its steps to `agent_runs.steps`
  (with what started it in `input`) as each finishes. A reply whose server stopped (stale
  heartbeat) is resumed from them by a page retry or by the resumer every server runs, unless the
  person has written since.
- **Messages mid-reply:** what the person writes while a reply works reaches the bot with its next
  tool result (`personWrote`), and that reply then counts as answering it.
- **To-do list:** `update_todos` keeps one `todos` card per job (`{list, items: [{text, status}],
  updatedAt}`), updated in place and shown by `MercbotTodoCard.vue`; the open list is in the state
  note at every turn. `keep_notes` keeps the bot's own notes for the job (`bot_conversations.job_notes`,
  up to 30), also in the state note at every turn and never shown in the chat.
- **Raw markup:** a reply with leaked model markup (a tool call written as text, DeepSeek's tokens)
  carries on once from its own steps, and what people see is always cleaned (`withoutMarkup`).
- **Room inside a long turn:** past 700,000 estimated tokens in one request, the oldest tool results
  (never the newest 20) are sent as a one-line note until it's under 500,000; once left out, they
  stay out for that turn. Stored history is untouched (`trimOldResults`, applied before each step).
- **Never forgetting unseen:** past 550,000 tokens since the last summary, a reply summarises first;
  if that fails, it's told the earliest part isn't shown.
- **The Builder checks its own work:** after `app_save_draft` passes the save check, every screen's
  queries run on the draft as the preview runs them (`runtime.query`, version `draft`); any that fail
  come back as `problems` to fix before telling the person.
- **Truthful replies:** `send_files` attaches existing files as cards (whenever they were made) and
  reports missing ones with the closest names; a reply that says files are attached when no card
  will show is sent back once (`claimsFiles`); a reply that reports actions is checked against its
  tool record in one short call (`unsupportedClaims`), and an unsupported claim sends it back once;
  internal `/files/...` paths are taken out of what people see (`withoutPaths`).
- **Whole command output:** a cut `run_command` or `check_command` result says so (`wholeOutput`);
  the whole output is `/runs/<run>.log` on the bot's command line (grep, tail), and
  `read_command_output({ run, from_line })` reads it in parts (`textPart`, shared with `read_file`,
  splitting very long lines), for the run's own conversation only.
- **Repeats:** the 3rd, 5th and 8th identical tool call in a row gets a `reminder` in its result.

Sidebar organisation: each home's first bot is its main bot and can't
be deleted or renamed from its menu; its menu offers "Replace with a different
bot" instead, and `PATCH` with `main: true` (owners and admins only) moves the
main bot to another bot that isn't a group. Bots can be pinned (ordered tiles), placed in the account's
sections, hidden and marked unread; anything a bot posts marks it unread and
counts as activity, as do the user's messages and renames. Routes:
`PATCH /api/bots/:botId` (name, pinned, hidden, unread, sectionId, main),
`DELETE /api/bots/:botId`, `PUT /api/bot-pins`, and `/api/bot-sections` to
create (optionally from a bot, placed above it), rename, collapse, move and
delete sections (their bots return to Unassigned).

Chat: `POST /api/bots/:botId/messages` stores the user's message (text,
reply quote, selected quotes, attachments — small text files carry their text)
and returns at once; `POST /api/bots/:botId/reply` produces the bot's reply.
A reply is claimed in `agent_runs` (one per conversation, with a 15-second heartbeat) and runs
as background work: the request waits up to 20 seconds, then answers `{pending: true}`,
and the page waits for the `messages` and `working` bot events, asking again every 30
seconds. A second request while a reply runs gets `{pending}`; a claim whose heartbeat is a
minute old is taken over (D-15, D-19). Every reply ends with a message: a reply
that fails, runs out of steps (8; 40 with office apps; 60 with web tools), or runs past
`AGENT_REPLY_MINUTES` (default 15) ends with the bot's own account of what it did and
what's left, from a log of its steps; web steps fail after two minutes;
`POST /api/bots/:botId/messages/:messageId/activity` returns a few words for the
status line (none when the model doesn't answer) and may add the bot's own emoji reaction; `PUT
/api/bots/:botId/messages/:messageId/reaction` sets or clears the user's reaction
on a bot message. Sidebar previews are plain text.

Details: bots have an optional label (`PATCH /api/bots/:botId` with
`label`). `GET /api/bots/:botId/routines` lists a bot's routines, `PATCH
/api/bots/:botId/routines/:routineId` pauses or resumes one (resuming counts the
next run from now and clears its failures in a row), and `DELETE` removes it.

New bot: `POST /api/bots` creates an unpinned bot with a name, shape and
palette colour, which then runs a short intro: a generated greeting and a
generated first question (single or multi-select, with a "something else"
option). `POST /api/bots/:botId/choices/:messageId` answers a question card with
one or more picks (no user message).

What a copy built on Mercbot adds to a bot's chat: `extensions.js` `botActions` (actions at the top of a
bot's Details, not a group's, each given the `bot`) and `messageCards` (a card for a kind of message Mercbot doesn't
show itself, given the `message` and its `bot`); Mercbot adds none. They use the chat MercbotShell provides under
`MERCBOT_CHAT_KEY` (`shellChat.js`): show messages appended or rewritten in a bot's chat, update a bot in the list,
set a bot's work line and mood, confirm or report a step, and keep the keyboard shortcuts away while their own dialog
is open (`holdKeys`). On the server such a copy reads the bot and its chat through `mercbot.bots.records` and asks
`bots.answerOnce(botId, { question, purpose }, options)` for one answer the person's bot writes in its own voice,
kept nowhere: refused (meter.js refuseWork) it throws the refusal (D-73), any other failure answers "" and a model
call's failure is logged as `Bot <id>'s <purpose> wasn't written: …`.
`records.messages.rewriteCards({ botId, kind, slug, homeId }, { merge, drop }, options)` changes the cards of one kind
naming one slug in every chat of a bot in a home (the home's own context, as a deleted page's mark), answering only
the cards the caller sees.

Bots asking bots (D-46, step 1): `ask_bot` sends another bot in the home a
brief (never the chat or memories) and waits; `message_bot` passes a task on for
the other bot to answer the person itself. Each is a `bot_requests` row with a
`bot_request` card in both conversations (the asker's, and the person's own
conversation with the target, or the room they have open for a shared bot), showing
status Starting, Working, Has a question, Waiting for your OK, Done, Couldn't
finish or Cancelled. Next steps (`target_turn`, `asker_turn`) are claimed with a
lease and SKIP LOCKED by `botRequests.js`, which every serving server runs, woken
by the `bots-requests` notice, and which the server that created the request also
starts straight away. A target turn gets `answer_request` and `ask_back`; the
asker gets `answer_bot` while a question waits (also in the person's own turns),
and an asker turn after an answer, a failure or a cancel. Runner turns are
`viaBot`: `attempt()` ignores `personAsked`, so anything needing approval asks the
person (the card carries `requestId`, and answering it resumes the request), and
`send_draft` refuses. Limits: depth 2, no bot already in the chain, one open
request per pair and person, 3 questions, 8 turns, 30 minutes; three failed
attempts fail the request. Usage is tracked to the person. Route:
`POST /api/w/:workspaceSlug/bot-requests/:requestId/cancel` (the person only).

Asking first (architecture §3.7): bots have actions (`create_routine`,
`update_routine`, and final steps on a web page). Before an action runs, the
person's policy, set in Settings → Permissions, decides: a
matching "Always ask" rule wins, a matching "Allow without asking" rule lets it run, otherwise auto-review (on by default) asks;
reversible actions, which so far means routines, only ask when a rule says so. Rules are matched to the action
by DeepSeek. Asking parks the action on a "Go ahead" / "Don't do it" question
card after the bot's message; approving claims the card in a short transaction,
then runs exactly the stored action outside it (actions may take a while on the
bot's computer and must never hold the bot's rows locked) and adds its event
line. Bot and section rows are locked with `FOR NO KEY UPDATE`, so rows that only
reference a bot (screenshots, tickets) can always be written. A web step asks
first only when it sends, buys, books, posts, deletes or saves a change, and the reply straight after a decision takes no new
actions. Routes: `GET`/`PATCH /api/bot-policy` (auto-review) and
`/api/bot-policy/rules` to add, edit and delete rules.

Sign-ins: in order, a login the person gave for the task (typed field by
field), `sign_in_with_saved_login` (a vault login for that site, filled by the computer's `fill`
operation, never shown to the model), `ask_for_login` (a `secure_form` card, `{site, form:
login|code, url, status}`), then `ask_for_help`. A code the site emails to an inbox the bot
can read, it fetches itself: `fill_sign_in_code` (`signInCodes.js`, only on the
person's own turn in their own chat with their bot: not for another bot's request, nor in a routine
or an Apps task, D-77) first checks the computer's page is registered as the site the bot names
(`baseDomain`: the Public Suffix List, through `tldts`, with private suffixes such as github.io, so
two sites under ltd.uk or github.io are never one), then reads only the person's own connected
Gmail and Outlook (never a home's, `connectedKeys` with `own`; a mail switch turned off stays off)
for mail of the last 10 minutes whose sender is registered as that site, waiting up to a minute.
The newest code in it (`signInCodeIn`: digits or capitals near words such as "code" or
"verification") is never returned to the model or shown in the chat; an event line says only that
it was typed, from which mailbox, into which address and from which sign-in. With none found the
bot uses the secure form. A site where others publish counts as one site with its owner's codes, so
a code goes in by itself only where the person's sign-in led (D-77): `start_sign_in` opens a
sign-in, only for a site the person named in their last 10 messages in the chat (`namesSite`: its
address, or its name as one to three words), and only at the site's front page (`isFrontPage`) or
an address the person wrote, and the computer keeps that sign-in's chain
(`computer/bot-computer.md`). On a page of the open chain of a sign-in to the page's own
site (its first address registered as the same site) the computer's `fill` types the code
(`inChain`). On any other page the bot posts an approval card (`askFirst`, never
answered by the person's rules) asking "Shall I type the sign-in code from <sender> into this
page?" with the page's full address, and stops; its `fill_sign_in_code` action
(`SIGN_IN_CODE_ACTIONS`) reads the newest code from that exact sender again and types it only while
the page in front is still at that address (`onlyAt`). When a turn that worked on a sign-in ends
with nothing waiting on the person (a card, a secure form, a hand-over or a Connect card), the
sign-in is over and its chain ends.

Connect cards: `suggest_connect` posts a `connect` card (`status: "waiting"`) with
the task the bot will do once the app is connected. When the person starts signing in from it, the
page posts `POST /api/w/:slug/bots/:botId/connect-cards/:messageId` (`{timeZone, language}`),
which marks it `connecting` with the time and the page's settings and keeps a `waiting` row for it in
`connect_follow_ups` (409 `bots_connect_card_closed` once it's settled; pressing it again starts the wait
again). Nothing reads the waiting rows until a sign-in finishes (`connectFollowUps.js`, D-77): integrations
tells `connected` of every account that turns connected (`connections.whenConnected`, from the provider's
callback or a hub's sign-in), inside the transaction that saves it, and it marks `ready` the rows the
account reaches whose sign-in began in the last 30 minutes (a person's own account their own chats in
every home, a home's every chat in it, D-37), through two partial indexes. Once that commits, the same
server starts them at once (`start`): a group's, or one whose chat or bot is gone, is closed; one whose
app isn't connected for its chat after all (`integrations.hasConnected`) waits again; one whose chat is
busy starts when that chat's reply ends (`afterTurn`), else a minute later, and is closed 30 minutes after
its sign-in began. A start claims the bot's reply, then holds the row under a 90-second lease with a run
id, as a lost run does (`runLease.js` `followUpCheckpoint`), and its first run turns the card `connected`
in the same transaction, so it's followed up once whichever server or release does it. The bot replies
to a prompt telling it to finish that task now, unless the chat shows it's done or no longer wanted, and
only the run holding the row posts its reply, ending the row in the same transaction. Every server
sweeps once a minute (`startSweeping`): it removes the rows waiting more than 30 minutes, and ready ones
no server could start for that long, and starts up to 20 ready rows that no server started within 10
seconds of their sign-in, or whose lease lapsed (their server stopped), never reading the rows still
waiting for a sign-in. The card
then shows "Connected". `ix_bot_messages_connecting` stays for the previous release's own check during a
deploy, and goes in the next release.

Coding hand-off (`codingTools.js`): on the person's own turn in
their own chat with their bot (not in a routine or an Apps task, which run without them, D-77), on
that chat's own computer, where only they signed in, `connect_coding_account` checks a coding tool (Claude Code or Codex)
is signed in on the computer and, if not, opens its sign-in on the screen for the bot to hand over
with `ask_for_help`; the person signs in with their own account (`computer/bot-computer.md`).
`start_coding` starts it on the bot's brief in a folder of its files, with a "… started working"
line holding the brief; `check_coding` reads its state and the end of its output (untrusted text),
or stops it. When the run ends, `botLoops.js` (`codingFollowUp`) queues a task of kind `shell` for
the bot in that chat, in its home, whose prompt (`codingReport`) carries how it ended and the end
of its output, and asks the bot to check the folder's changes and report. `POST /api/bots/:botId/secure-forms/:messageId`
with `{action: "submit", username, password | code, save}` fills the bot's page (reopening the
card's sign-in page if the computer moved on), seals the login into the vault when `save` is set,
and marks the card `submitted`; `{action: "close"}` marks it `closed`, which the model reads as a
no. The page then asks for the bot's reply. `ask_with_options` posts a question card (`choice`,
purpose `question`) whose pick comes back as the person's reply. A reply records the newest
person's message it read (`body.answers`); only such a reply counts as answering a retried
request, so a message sent mid-reply gets its own reply unless the bot already took it in (see
the agent loop above). The page keeps asking for a reply
after failed requests (every 30 seconds, up to 20 minutes). Pages finish loading before each
browser step; a click that changed nothing is retried as a click on the element Stagehand picks.

Drafts (writing as the user): `show_draft` posts a `draft` card (`{to, via, subject?,
text, status}`) the person edits; `POST /api/bots/:botId/drafts/:messageId` with `{action: "send",
text, subject?}` keeps their edits and marks it `send`, and the page asks the bot to send exactly
that text (through its browser when nothing is connected); `{action: "discard"}` marks it
`discarded`, which the model reads as don't send.

Voice memos: `send_voice_memo` speaks one message with Piper in gVisor on the
server (`apps.voiceMemo`, installed by `scripts/install-tools.sh` with one English voice) into a WAV
in `/files/mine/Voice`; the reply gets a `voice` message (`{path, seconds, waveform, words}`)
shown as an audio bubble with play, a speed pill, the waveform, the length and the transcript.

Charts: `make_chart` draws a chart on a blank slide with the slides app in the
sandbox (`apps.chartImage`) and saves a PNG in `/files/mine/Charts`; a single series of columns
shows its highest column in a second colour. The reply gets a `chart` message
(`{path, title, caption}`), shown inline and opened full-window with its caption and a download.

Hand-off: `message_bot` passes a task to another of the person's bots by name. The
sender's chat gets a "Messaged <bot>" event line; the other bot's chat a "Message from <bot>"
event, then that bot does the task as a claimed background run (waiting for a reply in progress)
and answers in its own chat, which shows as unread. Every state note lists the person's other bots.

Library: `GET /api/bots/:botId/library` lists the files, charts, pages and views a bot made
(from `files`, `chart` and `page` messages, newest first, one entry per path) with their pins: the
newest 400 things, then every older pinned one (a `pinned` message filter), so a pin never drops out;
`POST /api/bots/:botId/library/pin` (`{messageId, path, pinned}`) pins or unpins one.
`DELETE /api/bots/:botId/library/pages/:messageId` deletes a page: its file goes, with its
versions and link (`files.pages.pathChanged`, D-74), and every card of that page is marked `removed`
wherever the same file shows (`markPageRemoved`): a page in the home's shared folder in every chat of
the home, one in the bot's folder (or any page of a shared bot) in every chat and group the bot made it
in (the `madeBy` filter: the bot's own conversations, and group lines where it is the speaker), one in
the person's own folder in this chat. The Library and search leave it out and the cards show "Deleted"
and no longer open; the answer is the Library and this chat's cards. A pin merges only `pinned` into a
page's, chart's or view's card in the database (`mergeBody`), so a pin racing a delete keeps the
`removed` mark. The
Details panel's Library tab shows Pinned, then each day with five rows until "Show more", each
with its age and a hover card, a "…" menu with Pin (and Open, Share… and Delete for a page),
and opens each item in its viewer; a page opens in place of the chat, and its Share… is the page's
Share (`MercbotPageShare.vue`): a web page is the home's. Search returns `files` (up to 5 made items whose name
holds the words, matched in SQL across everything ever made, one per path, newest first) shown before
messages in the palette; choosing one opens it.

Pages (D-74, `genesis/program/files/pages.md`): `save_page` writes a page as HTML to the bot's
`/files/bot/Pages/<slug>.html` through `files.pages.save` (the same title, or the path given, updates
the same page) and tells the bot what it couldn't copy in; `keep_page_copy` saves its standalone copy
as a file card. A page file the bot changed with a command is saved again as an edit. The reply gets a
`page` card (`{path, title, summary}`) that opens the page in place of the chat. An older Markdown page
given by its `.md` path is still saved as Markdown and opens and ticks as before.

Memory: `remember` and `forget` keep lasting facts in `person_memories`, shared
by all the person's bots (the 40 newest are in every state note); chats stay private.
`GET /api/memories` and `DELETE /api/memories/:id` back Settings → Memory. One-off routines
(`bot_routines.once`) run once, then are deleted with a "Routine finished and
removed" event line; their run prompt says to apologise briefly when late.

Skills: Mercbot's own skills are Markdown files in `packages/bots/skills`,
written in our own words from part 3's behaviour by area (website guides follow one
"Looking things up on websites" pattern; "What's new in Mercbot" carries dated release notes)
(`name:`, `description:`, `pickable: yes|no`, `---`, then the guidance). A copy built on Mercbot adds skill
files of its own in the same form (`mercbot.added-skills`, optional in the bots, each `{ file }`): at start the bots
hand them to `useAddedSkills`, and from then on the library lists them with Mercbot's by file name, in the catalogue,
the picker and `read_skill`; Mercbot adds none, and a file named like one already listed is refused. The person's own
(`user_skills`, taught or saved by a bot) sit beside them. Every bot's standing instructions
carry a one-line catalogue of Mercbot's skills and the cross-skill rules (act on safe steps and
stop before paying, ordering, booking, sending, cancelling, posting or inviting; shortlist and
let the person choose; read totals back; no secrets in chat; honour known constraints; try
before saying can't; keep the person informed; one question at a time). `read_skill` opens
either kind by name; `save_skill` and `delete_skill` change the person's own, only with their
agreement, and a new skill is never run until asked. `GET /api/bot-skills` lists what the "/"
picker offers (the person's skills, `u-…`, then Mercbot's pickable ones, `b-…`). A picked skill
is sent as `<@skill:ID>`, stored with its name in `body.skills`, shown in the bubble as a book
icon and name, and reaches the model as "(Use the skill "Name" for this.)".

Attachments: in a bot's own chat each attached file is uploaded to its
`Uploads` folder and the message keeps its `path`; pictures show as themselves in the
bubble, other files as a type icon, name and size. The model is told each kept file's path
and reads it with `read_file` (documents, spreadsheets, slides and PDFs through the office
apps, text as it is), now or later in the chat. Pictures (PNG, JPEG, GIF, WebP, up to 10 MB)
attached to the message being answered reach the model as images (`withPictures`); for an
older picture or one in its files, `read_file` has the vision model describe it with the
bot's question in mind (`lookAtPicture`). HEIC is refused with a request for JPEG or PNG. A reply that
claims to hand the screen over without the card is sent back once (D-28).

Connected accounts (D-31): bots use the person's connected accounts through `calendar_events`
and `add_calendar_event` (Google Calendar, Outlook), `search_email` and `read_email` (Gmail,
Outlook; Gmail-style search words, turned into filters for Outlook), `find_contact` (Google
Contacts, Outlook), `save_to_drive` (Google Drive, OneDrive, into a Mercbot folder) and
`github_search`, `github_read` (comments, reviews, mergeability, check runs) and
`github_comment`. `connectedApps.js` picks the accounts (all of them unless one is named, by
address or label; one is needed for a single item) with an hourly key from
`connections.accessToken`; `googleApps.js`, `microsoftApps.js` and `githubApps.js` speak to
each provider. Adding an event is the approval action `add_calendar_event`: it only asks when a
rule says so, unless it invites people, which always goes through approval; `github_comment`
always asks. With several accounts of one app, reading answers per account. The
Current state note lists the connected accounts per app as "label · address"; which account a
bot uses is that bot's choice in its own chat, and `remember` refuses to save it for all bots.
An email draft with `from` set to a connected mailbox is sent from it when the person presses
Send (`settleDraft` claims it as `sending`, then marks it `sent`, or puts it back to pending if
the provider refuses); other drafts are still sent by the bot on its computer.

The rest of each external app (D-42) comes as grouped tools whose `action` picks one of
several, each action its own switch in Connect apps (`tool.action`, e.g. `mail_drafts.send`); a tool
offers only the actions still on, and none at all when every one is off:
- mail (`mailTools.js`): `mail_account` (who am I and send-as addresses, labels or Outlook folders,
  Gmail filters), `read_email` with `whole` for a conversation, `mail_drafts` (drafts saved in the
  mailbox: list, read, create, update, delete, send), `organise_email` (archive, bin, spam, read,
  star, label, move, each undoable), `mail_labels` (create, rename, delete) and `forward_email`;
- calendars: `calendar_info` (the calendars with whose they are, one event, a repeating event's
  dates, busy and free times across every calendar, events found by words);
- drives (`driveTools.js`): `drive_find` (search, a folder, details and sharing), `drive_read`
  (text, or a copy downloaded or exported into the bot's files, shown as a file card),
  `drive_change` (folders and text files, contents, moving and renaming, copying, sharing) and
  `drive_comments` (Google only). Google Drive asks for full Drive access; a drive signed in
  before that can only change files Mercbot made, and the bot asks the person to sign in again;
- GitHub (`githubTools.js`): `github_code`, `github_pulls`, `github_issues`, `github_find` and
  `github_discussions` read; `github_change` and `github_discussions` change, from one table of
  actions (GraphQL for discussions and drafts).
- apps that host their own connection point (`connectorTools.js`, D-34: Calendly, Notion, Todoist):
  `connected_app_actions` (an app's actions with their inputs and whether they change anything, the
  app's guidance, and the switched-off ones; or one action's whole description and input schema) and
  `use_connected_app` (one action with its input, as the account named or the only one). An action the
  app marks read-only runs at once, its answer marked as information only; any other is the approval
  action `connected_app_change`, which goes ahead without asking only when the person asked for exactly
  that and the app marks it non-destructive.
Every change goes through approvals as an `ACTIONS` entry and leaves an event line. Sorting mail,
saved drafts and drive changes are reversible; sending, forwarding, deleting a draft or label,
sharing, comments and every GitHub change go ahead only when the person asked for exactly that
(`personAsked`), otherwise they ask first. A reply claiming a mail, drive or GitHub change that no
tool made is sent back once; mail, GitHub and apps share words such as "labels", so a change in
one answers for them in the others. A pass sent back by any check is told what the first pass
already did, so it neither redoes nor denies it.

Test copies (D-69): what a bot sends to other people from a connected account goes out only when
this copy's `SIDE_EFFECTS` is `live`. `sendOrSimulate` (`connectedApps.js`) wraps each send at the
point it would go out: a connected mailbox's draft Send, `mail_drafts.send`, `forward_email`;
`add_calendar_event` with guests, `change_calendar_event` on an event with guests or inviting
someone, `delete_calendar_event` with guests, `answer_invitation`; `drive_change.share` (Google
Drive and OneDrive), `drive_comments.add` and `.reply` (Google Drive; OneDrive refuses comments in
both copies); `github_comment`, and in `githubActions.js` (`sends` and `simulated`)
`github_change.issue_create`, `issue_update`, `issue_labels`, `sub_issue_add`, `pr_create`,
`pr_update`, `pr_draft`, `pr_update_branch`, `pr_merge`, `review_create` with a verdict,
`review_submit`, `release_create` and `run_rerun` (a rerun can deploy or publish), and
`github_discussions.comment`, `edit`, `delete` and `answer`; and `connected_app_change` for the actions an
app's plugin.json lists in `mcp.sends`. A test copy logs a line naming the
account, the recipients, file or repository and the subject, never a body, and answers with the live
copy's event line and a result marked `simulated: true`: a share with the file's details (a read)
and the new person added, a changed issue or pull request with its own title and page and a rerun
with its run's page (reads), a new issue or pull request as `#simulated` at `…/issues/simulated` or
`…/pull/simulated`, and a release with a link ending `#simulated`; a draft card still ends `sent`.
Reads, and changes that reach nobody, run in both. The bot's computer, commands, other drive
changes, and GitHub's `branch_create`, `label_create`, `label_update`, `label_delete` and
`review_delete` aren't gated.

Pictures: `make_picture` draws portrait (3:4) pictures on the images kind of AI
(D-72; `pictureMaker.js` hands them to its provider's layer, `providers/gemini.js`, model `gemini-3.1-flash-image`), and
is always offered: without that kind, which is optional, it answers that pictures aren't set up on this copy, before
posting anything, and the bot says so. Pictures given in `from` (an earlier one or a photo the person
sent) are edited rather than drawn afresh; `variants: 2` makes two side by side. One call per reply (two variants come from that one call); its acknowledgement line is posted at once, before the 20–60 s of drawing. The pictures aren't written into the bot's history as text, and a reply that speaks of pictures the person asked for without making any is sent back once, on a copy that can make them (`run.picturesOn`). Each is saved
in the bot's `Pictures` folder and posted as a `pictures` message under the reply: 144 × 192
thumbnails that open in the viewer with the bot's one-line caption, and each is a Library entry
with a thumbnail.

Files (D-20, D-21): bots list their own and shared files, look up an office
app's tools (`app_help`), call them (`use_app`, up to 40 steps in a reply) and
move files between private and shared (`move_file`). The apps and folders belong
to the files subsystem; files saved during a reply become a `files` card after
its text, appear in the sidebar preview, and come back to the model as a note of
their paths. The state note lists the 12 newest files.

Web work: bots can open and read pages, act on the open page (an
irreversible step goes through asking first) and hand the screen to the person
for steps only they can do, such as signing in. A reply that used the web ends
with one screenshot per page. A handover posts a "your turn" card, sets the
bot's `waiting_task` (shown amber in the sidebar) and keeps the computer awake;
`POST /api/bots/:botId/handover/:messageId` records done or skipped, and the bot
then checks the page and carries on.

State first (D-14): each bot reply stores its model transcript (tool calls,
results and text) on the server, and the history replays it, so the model sees
what it actually did (results over 6,000 characters cut the same way every time;
event lines marked as Mercbot's records of tools that ran); older replies get their hand-over call rebuilt from the
card they produced. Every turn a server-written "current state" note (computer,
pending hand-over, pending approvals, routines) sits just before the latest
message. A hand-over card and the bot's `waiting_task` are written in one
transaction, and settling one clears both together. Transcripts never leave the
server. `npm run bench` runs real-model hand-over regression cases.

Routines (D-15): the bot creates and changes routines from chat with
`create_routine` and `update_routine`, each carrying a short acknowledgement that
is posted before the "Created routine" or "Updated routine" event line (clock
icon and name), then the bot confirms the schedule in plain words with the time
zone and the next run as a clock time. A routine stores a plain-words schedule, a
five-field cron pattern in an IANA time zone, its instructions and its next run
time; runs are at most every 10 minutes, and the reply route takes the
browser's `timeZone`. Every server, once listening, runs the same loop every 30 seconds: it claims
one due routine at a time with `FOR UPDATE SKIP LOCKED` and moves its next run
on before running it, so each run happens on exactly one server, and runs missed
while every server was down collapse into one. A run is an ordinary bot reply to
a scheduler prompt (stored on the message, never sent to the page); it posts an
ordinary message and marks the bot unread, posts nothing when the bot calls
`nothing_new`, and posts a short failure message if it can't finish.
A claimed run holds its routine with a run id (`run_id`, a UUID) and a 90-second lease
(`run_lease_until`, on the database's clock) that its server renews every 20 seconds
(`runLease.js`), and saves its steps in `run_steps`; a routine with a run going isn't due again.
When nothing is due, the loop takes over a run whose lease lapsed (its server stopped, D-59) with a
new run id, so the old server's heartbeat, steps and ending no longer match, and carries it on
from its saved steps; a run whose routine was paused or whose next run has come ends unrun
instead, and one tried three times is given up as failed. The result is posted in the same
transaction that ends the run by its run id (`routineCheckpoint`), so it is posted once. The lease
is also an AbortSignal handed to the agent loop (`keepLease`): it aborts, stopping the run at its
next step, once a renewal finds another server holds the run, or once no renewal has gone through
for the lease less two beats (50 seconds) on the server's steady clock (a paused server, a lost
database), so two servers never work on one run at once. A run stopped so posts nothing, counts no
failure and leaves its routine, a one-off too, to the server holding it. A draining server gives its
runs the drain's time, then stops them and ends the lease of each that stops within 5 seconds
(`handOverRuns`), so another server carries it on at once. `failures` counts failed runs in a row (the run threw, or a
model call failed, via the agent loop's `throwIf`); the fifth pauses the routine (`enabled` false,
no next run) with the bot saying so in its chat and how to resume it, plus a "Paused routine"
line (docs/usage-tracking-design.md question 4). A run that works, or resuming it, sets it to 0, and so does a run whose
work was refused (the meter's `refuseWork`, D-73, which Mercbot's own recorder never does), which isn't the routine
failing.
`GET /api/bot-events` streams that person's bot events (`working` with
`working: true|false`, and `messages`) from any server through PostgreSQL
`NOTIFY` (`@local/notices`, topic `bots`). The stream ends with its page, even one that went while the request
was still being checked, so no subscription or keep-alive outlives it (`tests/server/eventStreams.test.js`, for
Apps' and a computer's streams too). Pages then read that one bot again
(the whole list only for a bot they don't know yet) and catch up on its chat
only if its messages are loaded: each message's `changed` is the transaction
that last wrote it (set on insert, and on update by a trigger), the cursor is
`pg_snapshot_xmin(pg_current_snapshot())` taken before the rows are read, and
`since` returns the rows with `changed >= since`. That brings a changed older
message (a card answered, a reaction) and one whose transaction committed after
a later id's; a row sent twice is merged by id. A bad cursor answers 400
`bots_cursor_invalid`. Without `since`, the route returns the chat's newest 100
messages (oldest first), `more` (whether older ones are left) and the cursor;
`before=<message id>` returns the 100 before that message and `more`, without a
cursor, as the person scrolls up, so opening an old chat reads one page whatever
its length (one index read of at most 101 rows). A bad `before`, or one sent
with `since`, answers 400 `bots_before_invalid`.
Each bot keeps `read_up_to`, the last message the person had seen, which moves
on whenever the bot is marked read, and pages put the "new" divider above the
first later message for that visit.

Teach a task: `POST /api/bots/:botId/teach/start` starts recording on the
bot's computer; `POST /api/bots/:botId/teach/stop` with `discard: true` throws the
recording away and posts nothing, and otherwise posts the person's "finished"
message with a "Learn from demonstration" chip and returns it. The bot then
learns in the background on that server: it posts an acknowledgement and a
one-line summary of the sites it saw, with status lines sent as `bots` notices,
has DeepSeek write the steps, input and instructions (`{{input}}` for the part
that changes), saves them as a private skill through `mercbot.integrations`, and
posts the skill link (`skill:<id>` in Markdown), numbered steps, the input and an
offer to try it. A recording with no steps, or one it can't learn from, gets a
short explanation and no skill. The recording lives only on the finished message
on the server and is removed after learning. Bots read skills with `read_skill`
(which posts a short acknowledgement first); the Current state note lists them.

Search: `GET /api/search?q=` with no query returns every routine with its bot (the palette
reads them once, as it opens); with a query, up to 5 text messages containing it across chats and
groups, earliest match first, as plain one-line text with where they are and when, and no routines.

Find in chat: `GET /api/bots/:botId/find?q=&before=&room=` counts, case-insensitively, how many
times the words appear in the text of the conversation's messages before `before` (the oldest message
the page has) and names the newest and oldest message holding them (`{count, newest, oldest}`), so the
page never reads the whole chat to search it.

Group chats: a group is a `bots` row of kind `group` (so pins,
sections, hiding, unread, rename, delete and messages work as for bots) with 1 to 6
member bots in `bot_group_members`. `POST /api/groups` creates one from its first
message, or empty when there's none; its name lists the person and the bots, or for
one bot is the first message or the bot's name. `POST /api/groups/:id/members` and
`DELETE /api/groups/:id/members/:botId` add and remove members (the last stays). The
bot list returns each group's `members`, and a group's preview is its latest message
from anyone. Things only a bot has (computer, templates, teaching) answer 400 for a
group. A reply in a group goes to the bots the person mentioned, or to every member,
one after another, each seeing what the others said; then each bot another bot
mentioned may answer once more (`PASS` stays quiet). With several people in the group and
no bot named, no bot answers, and the turn still counts as answering the person's latest
message, so it isn't taken up again as one sent mid-reply. Each bot message records its
`speaker`, and mentions are stored as `<@bot:ID>`, `<@everyone>` or `<@app:ID>`
with the mentioned bots in `body.mentions`; the model reads and writes plain
`@Name`. Progress goes out as `bots` notices naming the working bots
(`speakers`). In a group a bot can only create or change its own routines; their
event lines and any approval card go to that bot's own chat. A bot's own replies
get a summary of its three most recent group chats from the last 14 days in the
Current state note; the group's messages never enter its 1:1 history.

A routine run reads its instructions and its own last 3 runs (`routineHistory`, `body.routine`), not the
chat or its summary (D-57), and a watch run likewise reads its own (`watch:<id>`, D-60). A finished background command's
follow-up reads the chat's last 6 text messages in words only (`recentHistory`, D-60). A person's own reply and a
button's hand-off still read the chat, routine runs included.
