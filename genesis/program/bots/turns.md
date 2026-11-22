# A chat's messages and its bots' turns

What is said in a chat, and how its bots answer (D-112, R3, R4, R5): a person's message, who it is for, each bot's own
reply on the agent loop, the cards a bot asks with and only its person answers, approvals, requests between bots,
follow-ups after a sign-in, summaries of long chats, and the news every open page hears.

## Sources

- Main: `packages/bots/src/server/chatTurns.js`
- `packages/bots/src/server/botChat.js`
- `packages/bots/src/server/botReplies.js`
- `packages/bots/src/server/chatSeats.js`
- `packages/bots/src/server/botHistory.js`
- `packages/bots/src/server/botTurns.js`
- `packages/bots/src/server/botAgent.js`
- `packages/bots/src/server/botCards.js`
- `packages/bots/src/server/approvals.js`
- `packages/bots/src/server/botActions.js`
- `packages/bots/src/server/mentions.js`
- `packages/bots/src/server/replyChecks.js`
- `packages/bots/src/server/modelInputs.js`
- `packages/bots/src/server/modelFailures.js`
- `packages/bots/src/server/botRequests.js`
- `packages/bots/src/server/botRequestTools.js`
- `packages/bots/src/server/connectFollowUps.js`
- `packages/bots/src/server/backgroundRuns.js`
- `packages/bots/src/server/backgroundWork.js`
- `packages/bots/src/server/botLoops.js`
- `packages/bots/src/server/appJobRunner.js`
- `packages/bots/src/server/runLease.js`
- `packages/bots/src/server/workPause.js`
- `packages/bots/src/server/eventMessage.js`
- `packages/bots/src/server/botWriting.js`
- `packages/bots/src/server/joiningIn.js`
- `packages/bots/src/server/discussions.js`
- `packages/bots/src/server/registerRoutes.js`
- `packages/bots/src/server/records/messageRepository.js`
- `packages/bots/src/server/records/turnRepository.js`
- `packages/bots/src/server/records/followUpRepository.js`
- `packages/bots/src/server/records/policyRepository.js`
- `packages/bots/src/server/records/workRepository.js`
- `packages/bots/src/server/records/agentTables.js`
- `packages/bots/src/server/records/rowPolicies.js`
- `migrations/20261122120000_chats_core.cjs`
- `src/components/mercbot/useChatMessages.js`
- `src/components/mercbot/useChatWork.js`
- `src/components/mercbot/useChatEvents.js`
- `src/components/mercbot/useChatActions.js`
- `src/components/mercbot/composerPlaceholder.js`
- `src/components/mercbot/MercbotTimeline.vue`
- `src/components/mercbot/MercbotTodoCard.vue`
- `src/components/mercbot/MercbotDraftCard.vue`
- `src/components/mercbot/MercbotRequestCard.vue`
- `src/components/mercbot/MercbotSecureForm.vue`
- `src/components/mercbot/MercbotHandoverCard.vue`
- `src/components/mercbot/MercbotDiscussionCard.vue`

## Public contract

**Messages** (routes under `/api/w/:workspaceSlug/chats/:chatId`, for whoever can open the chat; 404 otherwise;
archived chats refuse every write, `genesis/program/bots/chats.md`):
- `GET …/messages`: the chat's newest 100 messages (oldest first), `more` (whether older ones are left) and a cursor;
  `?before=<message id>` the 100 before it and `more`, without a cursor, as the person scrolls up (one index read of at
  most 101 rows, however long the chat); `?since=<cursor>` only the messages written or changed since. Each message's
  `changed` is the transaction that last wrote it (on insert, and on update by the `messages_changed` trigger) and the
  cursor is `pg_snapshot_xmin(pg_current_snapshot())` taken before the rows are read, so a catch-up brings a changed
  older message (a card answered, a reaction) and one whose transaction committed after a later id's; a row sent
  twice is merged by id. A bad cursor answers 400 `bots_cursor_invalid`; a bad `before`, or one sent with `since`,
  400 `bots_before_invalid`.
- `GET …/find?q=&before=`: Find in chat in the part the page hasn't read: how many times the words appear in the text
  of the messages before `before`, case-insensitively, and the newest and oldest message holding them
  (`{ count, newest, oldest }`), so the page never reads the whole chat to search it (400 past 200 characters,
  `bots_find_too_long`).
- `POST …/messages {clientId?, text, quotes?, attachments?, replyTo?}`: only one of the chat's people writes (403
  `bots_chat_join_first` "Join this chat to write in it."). The same `clientId` is stored once (D-19). The message
  keeps its writer (`author_user_id`) and their name as written (`body.authorName`, R2), mentions of the chat's bots
  as `<@bot:ID>` (and `<@everyone>`, `<@app:ID>`; the model reads and writes plain `@Name`), a skill picked with "/"
  (`<@skill:ID>`, stored with its name in `body.skills`), and with `replyTo` the quoted message's id, first 200
  characters and bot. Typing closes the person's own open choice card (marked inactive); another person's card stays
  theirs. It moves the welcome chat's steps on (`genesis/program/bots/onboarding.md`), resumes a goal a bot paused to
  wait for them, for the bots the message is for, marks the chat unread for its other people and tells open pages.
  Answers `{ messages, chat }`.
- `POST …/messages/:messageId/activity`: a few words for the status line and the reaction of the first bot the message
  is for (neither when no bot is, or the model doesn't answer). `PUT …/messages/:messageId/reaction {emoji}`: one
  reaction per person or bot on a message.
- `POST …/bots/:botId/voice-call {seconds}`: a "Voice conversation" event line with its length, by one of the chat's
  people for one of its bots (404 `bots_bot_not_in_chat`); the page offers a voice call only in a direct chat.

**Who speaks (R3, `addressedBots` in `botReplies.js`).** With one person in the chat, every live bot answers in
order, or only those @-mentioned. With several people, a bot answers only when named as a word, @-mentioned, replied
to (`replyTo` its message) or called with `<@everyone>`, or when the join-in judge named it (below). After a card is
answered, its bot speaks. Then one follow-up
round lets each bot another bot just mentioned answer once (`PASS` stays quiet: nothing is posted). Archived bots
never speak; a chat with only people makes no model call. The page decides how to wait (`useChatActions.js`
`answering`): no live bot, no reply asked; several people, it asks and shows a bot working only once the server says
one started (`untilStarted`, the `working` event); otherwise it waits for the reply.

**Bots join in when useful (D-115, `joiningIn.js`).** With the chat's `bots_join_in` on and several people, a
person's message that calls no bot goes through one judging call, in the background job the reply request starts:
one `generateOnce` on the chat kind of work, at most 40 tokens out, metered to the message's person and no bot, which
reads the chat's last 12 text messages (each clipped to 400 characters) through the chat's own reader and answers
`{"bot": "<name>"}` or `{"bot": null}`. Its answer is kept on the message, `body.judged` (the bot's id, or `"quiet"`),
under the message's lock, the first kept standing, so at most one bot joins per message and nothing is judged twice;
`addressedBots` counts the judged bot as called, so one busy at the time answers once it's free. Off, alone in the
chat, for a call, or in a paused home, nothing is judged. A failure or an answer in another shape stays quiet.

**Discuss (D-115, `discussions.js`, `MercbotDiscussionCard.vue`).** In a chat with two or more live bots, `POST
…/chats/:chatId/discussions {question}` (one of its people; at most 500 characters) writes a `discussion` card by
that person, whose body only the server changes, under the card's lock: the question, its bots, 1–3 rounds (2 first)
with what each may cost from `meter.estimateNano` (every turn reading the chat, a 24,000-token prefix and all said
before it, writing at most 1,200 tokens; the wrap-up 2,000), and later the cap, rounds run, spending (`spentNano`,
`spentByBot`), who passed and how it ended. `POST …/discussions/:messageId/start {rounds}` (its starter, while
proposed) fixes the cap; `/round` (while waiting with rounds left) and `/wrap` (while waiting) run the next round or
the wrap-up, each only on a press; `/cancel` (its starter, while proposed) and `/stop` (its starter or the chat's
managers, at any time) end it. A press claims each of its bots' reply runs (`claimReply`; 409 `bots_discussion_busy`
while one is still answering) and holds them, on their heartbeat, until the round ends, so a message written meanwhile
waits and is answered after (`replies.takeUpWaiting`, `answerWaiting`). A turn is `replyTurn` with its `discussion`
option: the round's prompt, no tools, no reasoning, no checks that send it back, the turn's output limit and the
round's abort signal; it may PASS, and its message carries `body.discussion` and `body.round` and answers nobody's
message. Before each turn the spending so far plus that turn's estimate must fit the cap, or it ends (`cap`); the
spending is the discussion's own turns' AI calls only, heard through `meter.counting` and each priced by
`meter.estimateNano` on the call's figures, never the person's other work with those bots. A round where every bot
passes ends it (`passed`); Stop ends the card at once and the round sees it at its next heartbeat or turn. A running
card is leased (`leaseUntil`, renewed at each heartbeat while the card says that round runs, a heartbeat past the
runs' stale time): once it lapses, every read (`botRows.js` `discussionNow`, through `toMessage`) and every press
takes it as `interrupted`; a page's read of a running card says what's left of the lease by the server's clock
(`leaseLeftMs`), which the card counts on the page's own clock (`chatView.js` `discussionState`), never against the
server's time. An interrupted card waits for One more round (not after a wrap-up was interrupted), Wrap up or Stop
like a finished round, on runs that are stale by then. Each turn is metered to the starter and the bot that speaks
(R8). The chat list shows the card as "Discussion: <question>".

**A reply** (`POST …/reply {timeZone?, language?, afterMessageId?, afterCard?}`): each speaking bot runs its own reply
in this chat, claimed in `agent_runs` under its seat (`chat_bots.id`) with a heartbeat, so a retried request or
another page never starts a second one and a reply whose server stopped beating for a minute is taken over (D-15,
D-19). The request waits up to 20 seconds, then answers `{ pending: true }`; the reply finishes as background work and
tells pages through bot events; it also answers `{ pending: true }` when the bots it would ask were all still busy
with an earlier reply in the chat, as each answers once it's free (`answerWaiting`). Only those four fields come from
the page: a turn's prompt is the server's own. A message that arrived while its bot was busy is named in the turn's
prompt ("The message … arrived while you were busy") whichever request answers it, answerWaiting or the page's own
once that reply has posted, since the bot's later words then end the chat. Bots that already answered the
person's message (`body.answers`) aren't asked twice, except the card's bot after a card while that card is still the
chat's latest (`afterCard`; asking again once it has answered gets the latest message's reply, D-19); with none left,
what was said since the page's last message is the answer. Every reply ends with a message: one that
fails, runs out of steps (8; 40 with office apps or commands; 60 with web tools) or past its deadline (15 minutes; 30
for the Builder and background work) ends with the bot's own account of what it did and what's left. A model call
that fails while a route works answers 502 `bots_model_failed` ("The AI provider couldn't answer just now. Try again
in a moment."), never the provider's own status; each failure is logged in one line with the provider's status and
the error's message. In a paused home (D-73) the bots say the pause in one line and nothing starts; routes that would
start work answer 402 `work_paused`.

**What a turn reads and acts as (D12, R4, R5).** A turn works for the person it answers (the asker), who is the only
one who can answer its cards and whose approval rules apply; background work runs as its own person (a routine's
`made_by`, a watch's creator, an app job's or follow-up's person) and stops when that person can no longer open the
chat. Every model-facing read passes the model's reader for that bot in that chat (`records.readers.forBot`,
`rowPolicies.js`): it reaches the chats in `readable_from(chat)` (the chat itself, the home's Public chats and, for a
Private chat, the Private chats whose people include all of its people) and the home's own things, never more
because of who asked. Every path that builds a model's input is one row of `modelInputs.js` (R12), whose reach is
`reader`, `public` (as a Public chat reads, for a template draft) or `none`. The bot's instructions start the same in
every chat, so the cached prefix is shared (R5); the chat's own framing is in the state note the server writes before
the latest message each turn (D-14): which chat it is and its kind, who is in it, who the bot works for now and that
only they answer its cards, the time zone, the bot's computer in this chat, a pending hand-over, approvals and
secure form, the other bots of the home, the home's connected accounts and who connected each, the asker's own
skills, the bot's folders and recent files, and its routines in this chat. History replays each reply's stored
transcript (tool calls, results and text, results over 6,000 characters cut the same way every time), every message
under its author's name. Each turn is metered to the asker and the speaking bot (R8); the Builder's own replies as
`build` work; summaries to the chat's home and one of its bots with no person.

**Cards** (only the person a card is for answers it, R4: 403 `bots_waiting_for_other` "This is waiting for <name>'s
OK."; a card whose bot left the chat 409 `bots_card_closed`): `POST …/choices/:messageId {picks}` answers a question
card (no user message; a pick comes back as the person's reply), `…/handover/:messageId` records a hand-over done or
skipped (the card and the seat's `waiting_task` are written together, and settling one clears both),
`…/secure-forms/:messageId {action: "submit", username, password | code, save} | {action: "close"}` fills the bot's
page (reopening the card's sign-in page if the computer moved on), seals the login into the home's Vault when `save`
is set and marks the card `submitted`, or `closed`, which the model reads as a no; `…/connect-cards/:messageId
{timeZone, language}` marks a Connect card `connecting` (409 `bots_connect_card_closed` once settled);
`…/drafts/:messageId {action: "send", text, subject?} | {action: "discard"}` keeps the person's edits and sends exactly
that text (from a connected mailbox, or Sedna as the person's own user, D-94; else by the bot on its computer) or
marks it `discarded`. The page then asks for the card's bot's reply (`afterCard`). The composer invites an answer
while the latest choice card waits for the person looking (`composerPlaceholder.js`).

**Asking first** (architecture §3.7): an action (routines, final steps on a web page, mail, drive, GitHub, Sedna and
connected-app changes, `change_additions`) first meets the asker's policy in this home, set in Settings →
Permissions (`bot_policies`, `approval_rules`): a matching "Always ask" rule wins, a matching "Allow without asking"
rule lets it run, otherwise auto-review (on by default) asks; reversible actions only ask when a rule says so. Rules
are matched to the action by a model call that reads only the action and the asker's rules. Asking parks the action
on a "Go ahead" / "Don't do it" card; approving claims the card in a short transaction, then runs exactly the stored
action outside it and adds its event line. A web step asks first only when it sends, buys, books, posts, deletes or
saves a change, and the reply straight after a decision takes no new actions. Routes: `GET`/`PATCH
/api/w/:workspaceSlug/bot-policy` (auto-review) and `…/bot-policy/rules` to add, edit and delete rules.

**The agent loop** (D-48, `genesis/program/bots/agent-loop.md`) for every reply, request turn, routine run and app
task:
- **Goals:** a multi-step job opens a goal (`create_goal`, `get_goal`, `update_goal`, `agent_goals` under the seat);
  while one is active each finished turn queues another round, claimed with a lease, until it's complete, blocked (not
  before round 3), at 24 rounds, or when the job's model spend since the goal began reaches `AGENT_JOB_COST_USD` (5
  dollars by default; 0 for no limit), which a "Stopped working on the goal" line reports. A reply that runs out of
  steps or time opens a goal for the request and carries on in rounds by itself. Only the person's own turn opens one.
- **Stopping short:** a reply under 600 characters that ends by announcing its next step, with no result, carries on
  once from its own steps; with a goal active, the goal's next round does instead.
- **Saved steps:** a reply or a goal round writes its steps to `agent_runs.steps` as each finishes; one whose server
  stopped is resumed from them by a page retry or by the resumer every server runs, unless the person has written
  since. A routine's, an app task's or a request's run keeps its steps on its own row instead.
- **Messages mid-reply:** what the person writes while a reply works reaches the bot with its next tool result, when
  the message is for that bot (R3), and that reply then counts as answering it.
- **To-do list and job notes:** `update_todos` keeps one `todos` card per job, updated in place
  (`MercbotTodoCard.vue`); `keep_notes` keeps the bot's own notes for the job on its seat (`chat_bots.job_notes`, up to
  30, never shown). Both are in the state note at every turn.
- **Checks on a reply:** leaked model markup carries on once and is always cleaned from what people see; a reply that
  says files are attached when no card will show, or claims a change no tool made, or reports actions its tool record
  doesn't support (one short call), is sent back once, told what the first pass already did; internal `/files/...`
  paths are taken out of what people see; a password kept in the home's Vault never shows in the chat.
- **Repeats:** the 3rd, 5th and 8th identical tool call in a row gets a `reminder` in its result.

**Requests between bots** (D-46, O22, `botRequests.js`): `ask_bot` sends another bot of the home a brief for the
person the asking bot works for and waits; `message_bot` passes the task on for the other bot to answer the person
itself, in the asking chat. Each is a `bot_requests` row (its asking seat, chat, steps and card) with one
`bot_request` card in the asking chat showing Starting, Working, Has a question, Waiting for your OK, Done, Couldn't
finish or Cancelled (`MercbotRequestCard.vue`). The asked bot works on the brief alone, with its own steps on the
request, and never reads the asking chat; what it posts, its cards and its answer go to the asking chat, under that
chat's readers (D12, D13). The first time it needs its computer it joins the asking chat with a "<Bot> joined to work
on a request" line; a direct chat takes no other bot, so there it does without and suggests a chat with both. Next
steps are claimed with a 120-second lease and SKIP LOCKED by every serving server, woken by the `bots-requests`
notice. Request turns are `viaBot`: anything needing approval asks the person, and the answer resumes the request.
Limits: passed on at most twice, no bot already in the chain, one open request per pair and person, 3 questions, 8
turns; three failed attempts fail it. `POST /api/w/:workspaceSlug/bot-requests/:requestId/cancel` is the person's it's for (404
`bots_request_not_found` otherwise); a step still running finishes, but its answer is no longer used.

**Connect follow-ups** (D-77, `connectFollowUps.js`): `suggest_connect` posts a Connect card with the task the bot will
do once the app is connected. Starting the sign-in from it keeps a `waiting` row in `connect_follow_ups` for the
card's seat. Integrations tells the bots of every account that turns connected inside the transaction that saves it
(`connections.whenConnected`), which marks `ready` the rows of that home and app whose sign-in began in the last 30
minutes. Once that commits the same server starts them: one whose chat or bot is gone is closed, one whose app isn't
connected after all waits again, one whose seat is busy starts when that reply ends, else a minute later. A start
claims the seat's reply and holds the row under a 90-second lease with a run id (`runLease.js`); its first run turns
the card `connected` in the same transaction, so it is followed up once whichever server does it. Every server sweeps
once a minute: it removes rows waiting more than 30 minutes and ready ones no server could start for that long, and
starts up to 20 ready rows nobody started within 10 seconds or whose lease lapsed.

**Long chats** (D-41): one summary per chat (`agent_summaries`, keyed by the chat), made in the background past the
agent loop's thresholds and read by every bot of the chat. It is made through the chat's own reader
(`records.readers.forChat`, acting for no one), so no read can reach past the chat; a chat's only bot reads a summary
that keeps what it did with its tools, while with several bots the summary holds each one's words and records only.

**Background work in a chat** (`backgroundRuns.js`, `botLoops.js`): a watch's run, a finished background command's
follow-up and an Apps task each run in their bot's seat in the chat, as their own person, and post nothing when that
seat, its bot or chat is gone, archived, or the person can no longer open the chat (`chatSeats.js`
`backgroundSeat`). A routine's run reads its instructions and its own last 3 runs, not the chat or its summary
(D-57); a watch run likewise its own (D-60); a finished command's follow-up the chat's last 6 text messages in words
only. A button's hand-off to a bot (Apps) runs in the presser's direct chat with that bot, made on first use. Routines
are `genesis/program/bots/routines.md`.

**Bot events** (`GET /api/w/:workspaceSlug/bot-events`, server-sent, from any server through PostgreSQL `NOTIFY`, `@local/notices` topic
`bots`): `messages` and `working` (`{ chatId, botId, working, status }`) for a chat's people, `chat` (members, title,
archive, deletion), `bot` (the home's bots changed), `computer` (who has a bot's computer in a chat) and
`home-changed`. The stream ends with its page, so no subscription or keep-alive outlives it. Pages then read that chat
again and catch up on its messages only if they're loaded (`useChatEvents.js`, `useChatMessages.js`), and put the
"new" divider above the first message after the person's read point for that visit; the status line and moods are
per chat and per working bot (`useChatWork.js`).

**For a copy built on Mercbot:** `bots.answerOnce(botId, { question, purpose }, options)` gives one answer the
person's bot writes in its own voice, kept nowhere (refused work throws the refusal, D-73; any other failure answers
""); `records.messages.rewriteCards({ botId, kind, slug, homeId }, { merge, drop }, options)` changes the cards of
one kind naming one slug in every chat of a bot in a home, answering only the cards the caller sees, each with its
chat (`chatId`).

## Proved by

- `tests/server/chatSpeaking.integration.js`
- `tests/server/chatReach.integration.js`
- `tests/server/glassWall.integration.js`
- `tests/server/glassWallPrompts.integration.js`
- `tests/server/modelInputPaths.test.js`
- `tests/server/speakingUsage.integration.js`
- `tests/server/joinInChats.integration.js`
- `tests/server/discuss.integration.js`
- `tests/server/botsTogether.test.js`
- `tests/e2e/chats-together.spec.ts`
- `tests/client/discussionCard.vitest.js`
- `tests/server/findInChat.integration.js`
- `tests/server/botRequests.integration.js`
- `tests/server/botRequestsBrief.integration.js`
- `tests/server/connectFollowUps.integration.js`
- `tests/server/compaction.integration.js`
- `tests/server/botGoals.integration.js`
- `tests/server/hearWhileWorking.integration.js`
- `tests/server/replyCheckpoints.integration.js`
- `tests/server/todos.integration.js`
- `tests/server/stopShort.integration.js`
- `tests/server/approvalAction.integration.js`
- `tests/server/approvals.test.js`
- `tests/server/backgroundPerson.integration.js`
- `tests/server/workKinds.integration.js`
- `tests/server/botModelFailures.test.js`
- `tests/server/mentions.test.js`
- `tests/server/promptPrefix.test.js`
- `tests/server/cachePrefix.test.js`
- `tests/server/turnContext.test.js`
- `tests/server/eventStreams.test.js`
- `tests/client/chatReplies.vitest.js`
- `tests/client/chatTimeline.vitest.js`
- `tests/client/chatNews.vitest.js`
- `tests/client/chatComposer.vitest.js`
- `tests/e2e/shell.spec.ts`
- `tests/server/chatCatchUp.integration.js`
- `tests/server/pausedHome.integration.js`
