# Bots' tools in a chat

What a bot can do in a turn besides talking (D-20, D-31, D-42, D-77, D-93): its files and the office apps, pages,
pictures, charts and voice memos, its computer and the web, signing in, the home's connected accounts, Sedna, coding,
skills and teaching. Every tool works in the chat the turn is in, for the person it works for, and never reaches what
that chat may not read (D12, D13, D14).

## Sources

- Main: `packages/bots/src/server/botTools.js`
- `packages/bots/src/server/fileTools.js`
- `packages/bots/src/server/roomTools.js`
- `packages/bots/src/server/botTalk.js`
- `packages/bots/src/server/commandTools.js`
- `packages/bots/src/server/webTools.js`
- `packages/bots/src/server/vaultLogins.js`
- `packages/bots/src/server/signInCodes.js`
- `packages/bots/src/server/signInSecrets.js`
- `packages/bots/src/server/codingTools.js`
- `packages/bots/src/server/cardTools.js`
- `packages/bots/src/server/draftTools.js`
- `packages/bots/src/server/accountTools.js`
- `packages/bots/src/server/connectedApps.js`
- `packages/bots/src/server/googleApi.js`
- `packages/bots/src/server/googleApps.js`
- `packages/bots/src/server/googleDrive.js`
- `packages/bots/src/server/microsoftApps.js`
- `packages/bots/src/server/githubApps.js`
- `packages/bots/src/server/githubTools.js`
- `packages/bots/src/server/githubActions.js`
- `packages/bots/src/server/mailTools.js`
- `packages/bots/src/server/calendarTools.js`
- `packages/bots/src/server/driveTools.js`
- `packages/bots/src/server/connectorTools.js`
- `packages/bots/src/server/sednaTools.js`
- `packages/bots/src/server/sednaApi.js`
- `packages/bots/src/server/sednaActions.js`
- `packages/bots/src/server/sednaChanges.js`
- `packages/bots/src/server/pictureMaker.js`
- `packages/bots/src/server/skillTools.js`
- `packages/bots/src/server/skills.js`
- `packages/bots/src/server/teaching.js`
- `packages/bots/src/server/botTeaching.js`
- `packages/bots/src/server/botActions.js`
- `packages/bots/skills/sign-in.md`
- `packages/bots/skills/pictures.md`
- `packages/bots/skills/coding.md`
- `packages/bots/skills/files-and-documents.md`
- `packages/bots/skills/writing-as-you.md`
- `packages/bots/skills/saving-skills.md`
- `src/components/mercbot/MercbotVoiceMemo.vue`

## Public contract

**Where a turn's tools come from** (`botTools.js` `buildTools`): every turn gets the file, page, picture, chart,
voice memo, card, draft, skill, request and routine tools, the web tools on the chat's computer, the tools of the
home's connected apps and the Apps tools (`genesis/program/bots/app-tools.md`). Sign-in codes and coding are offered
only on the person's own turn (not work another bot asked for, a routine's run or an Apps task, which run without
them and can be set off by what others write, D-77); there the bot uses the secure form instead. Every change that
needs approval goes through approvals as an `ACTIONS` entry (`genesis/program/bots/turns.md`) and leaves an event line.

**Files** (D-20, D-21, D13). A turn's paths are `/files/chat` (this chat's own folder), `/files/bot` (the bot's, in
every chat it's in) and `/files/shared` (the home's, for everyone and all its bots); the places are the files
subsystem's (`genesis/program/files/files.md`). `list_files` lists the three newest first (at most 300 per folder,
with `left` and `partial`), `read_file` reads documents, spreadsheets, slides and PDFs through the office apps, text as
it is and pictures by asking the vision model the bot's question; `app_help` and `use_app` (up to 40 steps a reply)
work the office apps; `send_files` attaches existing files as cards (reporting missing ones with the closest names);
`move_file` moves or renames inside one of the three folders; a move to another of them is refused, pointing at
`transfer_file` (D-120). In a Private chat the bot can't write to `/files/bot` or `/files/shared` (the files answer 403
`files_wider_needs_card`). `transfer_file {mode: "copy" | "move", from: {path, room?}, to: {folder, room?}}` copies
or moves a file or folder to another place: another of the bot's folders, or a room's or chat's `/files/chat` named by
`room` (the name the person sees it by). It checks a file of this place is there, then always asks on an approval card
for the person the bot works for, whatever approvals say (`ACTIONS.transfer_file`, `alwaysAsks`: "Copy <name> from
this chat to Home files?", "my files" for `/files/bot`, a room by its quoted name). Only that person answers it (403
`bots_waiting_for_other` for anyone else); their Go ahead runs the files' transfer (`files.transfer.transfer`,
`genesis/program/files/files.md`) as them with `confirmed: true`, a room resolved among the chats they can open
(`chatNamed`), and posts "Moved" or "Copied" with where it went, or "That didn't work" with the refusal's sentence.
Cards from before it (`share-file`, "Share it") still copy on their Yes.

**Rooms a bot starts** (D-122). In the person's own turn (not a routine's, a request's or an Apps task's run) a bot has
`start_room {title (1–80), kind: "private" | "public" (default private), bots: [name], people: [name], brief (up to
8,000 characters)}`, for a job that needs others, above all bringing in the home's Builder for a database or an app.
Names are resolved when it's called, as the model knows them: bots among the home's (case aside; an unknown or archived
one is a tool error the model sees), people among the home's active members (one read of them and their names; an
unknown or ambiguous name is a tool error). The proposing bot and the person are always members. It always asks on an
approval card for the person (`ACTIONS.start_room`, `alwaysAsks`: "Start the private room "<title>" with you, <people>
and <bots>?"), whose args carry the title, kind, `bots` and `people` as `{id, name}` and the brief, which the card shows
in full: until the yes the brief, which may carry the chat's own words, is nowhere but on that card. Only that person
answers it (403 `bots_waiting_for_other`); "Don't do it" makes nothing. Their Go ahead makes the room as them through the
chats' create (`chatMembers.create`, the same as New room's), with exactly the card's members, in one transaction with
its two first messages: "<Person> started this room." and then the brief as the proposing bot's message (`body.brief`).
The brief is for one bot of the room (D-124, `briefFor`): the home's Builder when the card names it, else the first other
bot it names, kept on the card as `to`; the brief @-mentions it ("Mercbot, …" reads "@Mercbot, …", and a brief that
never names it starts with the mention) and is stored with its mention markers (`body.mentions`). Once the room is
made, that bot answers the brief there by itself, once, in the background (`botTalk.js` `briefAnswerer`, through the
replies' own turns, as a reply to the proposing bot that counts toward the bot-to-bot limit, turns.md); the proposing
bot doesn't answer its own brief, and a room with no other bot gets no reply.
The card gets `done: {chatId}` and shows "Open the room"; the chat gets "Started the room <title>". A bot archived or a
person who left the home since the card is refused by the create, and the chat gets "The room wasn't started" with why. Files saved during a reply become a
`files` card after its text and come back to the model as a note of their paths; the state note lists the 12 newest.
An attached file is uploaded to `/files/chat/Uploads` and the message keeps its `path`; pictures (PNG, JPEG, GIF,
WebP, up to 10 MB) attached to the message being answered reach the model as images; HEIC is refused with a request
for JPEG or PNG. Commands (`run_command`, `check_command`, `read_command_output`) run on the bot's command line in
this chat with the same three folders, `/files/bot` and `/files/shared` read-only in a Private chat and for work
another bot asked for (`genesis/program/files/shell.md`); a cut result says so and the whole output is
`/runs/<run>.log`.

**Pages** (D-74, `genesis/program/files/pages.md`): `save_page` writes a page as HTML at `/files/bot/Pages/<slug>.html`
(the same title, or the path given, updates it) and the reply gets a `page` card; in a Private chat it is kept at
`/files/chat/Pages/<slug>.html` with a card asking "Make "<title>" a page in this bot's files?", and becomes a page only
on the person's Yes. `keep_page_copy` saves a standalone copy in `/files/chat/Copies` as a file card.

**Pictures, charts and voice memos.** `make_picture` draws portrait (3:4) pictures on the images kind of AI (D-72,
`pictureMaker.js`), editing the pictures given in `from`, two side by side with `variants: 2`, once a reply, its
acknowledgement posted first; each is saved in `/files/chat/Pictures` and posted as a `pictures` message, and is a
Library entry. Without that kind, which is optional, it says pictures aren't set up on this copy. A copy that checks
pictures (D-90) checks the prompt before anything is drawn and each picture before it's kept or shown; one not
allowed is neither, and the bot says why in one line. The files a reply saved, and the screenshots it shows, are
queued for that copy's check when the reply closes; one that can't be queued isn't shown. `make_chart` draws a chart
with the slides app into `/files/chat/Charts` (a single series of columns shows its highest in a second colour) as a
`chart` message. `send_voice_memo` speaks one message with Piper in gVisor into `/files/chat/Voice/memo-*.wav`, posted
as a `voice` message shown as an audio bubble with the waveform, length and transcript (`MercbotVoiceMemo.vue`).

**Web work on the chat's computer** (D14, `webTools.js`; the computer is `genesis/program/computer/bot-computer.md`):
`open_web_page`, `use_web_page` (an irreversible step asks first), `ask_for_help` (hands the screen to the person with
a hand-over card and the seat's `waiting_task`, keeping the computer awake) and the sign-ins. A reply that used the web
ends with one screenshot per page. Sign-ins, in order: a login the person gave for the task, `sign_in_with_saved_login`
(a login from the home's Vault, D8, filled by the computer and never shown to the model), `ask_for_login` (a
`secure_form` card), then `ask_for_help`. At each sign-in the chat gets D14's one line, "Everyone who can open this
chat can use this sign-in.", and the computer notes it in its sign-ins list.

**Sign-in codes** (`signInCodes.js`, D6, D-77): `fill_sign_in_code` first checks the computer's page is registered as
the site the bot names (the Public Suffix List through `tldts`, with private suffixes, so two sites under ltd.uk or
github.io are never one), then reads only the mailboxes the asker connected (never another person's in the home,
with the mail action's switch), for mail of the last 10 minutes from that site, waiting up to a minute. The code is
never returned to the model or shown; an event line says only that it was typed, from which mailbox, into which
address and from which sign-in. `start_sign_in` opens a sign-in only for a site the asker named in their last 10
messages in this chat (nobody else's words ask for their sign-in), only at its front page or an address they wrote,
and the computer keeps that sign-in's chain: a code is typed by itself only on a page of that chain; anywhere else the
bot asks on an approval card ("Shall I type the sign-in code from <sender> into this page?") with the page's full
address, and types it only while that address is still in front. A turn that ends with nothing waiting on the person
ends the sign-in.

**The home's connected accounts** (D-31, D-111): every account is the home's, used in any chat as the person who
asked; the state note names who connected each ("connected by them", or by <name>). Tools: `calendar_events`,
`add_calendar_event`, `change_calendar_event`, `delete_calendar_event`, `answer_invitation` and `calendar_info`
(Google Calendar, Outlook); `search_email`, `read_email` (with `whole` for a
conversation), `mail_account`, `mail_drafts`, `organise_email`, `mail_labels` and `forward_email` (Gmail, Outlook);
`find_contact`; `save_to_drive`, `list_drive_files`, `create_drive_document`, `bin_drive_file`, `drive_find`,
`drive_read` (a copy into `/files/chat/Drive`), `drive_change` and `drive_comments` (Google Drive, OneDrive); `github_search`,
`github_read`, `github_activity`, `github_comment`, `github_code`, `github_pulls`, `github_issues`, `github_find`,
`github_discussions` and `github_change`; and for apps that host their own connection point (D-34)
`connected_app_actions` and `use_connected_app`. `connectedApps.js` picks the accounts (all of them unless one is
named) with a key from `connections.accessToken`. A grouped tool's `action` picks one of several, each its own switch
in Connect apps; a tool offers only the actions still on. Sorting mail, saved drafts and drive changes are
reversible; sending, forwarding, deleting a draft or label, sharing, comments and every GitHub change go ahead only
when the person asked for exactly that, otherwise they ask first. Reading a mailbox someone else in the home
connected hides sign-in codes and links (`signInSecrets.js`: "[sign-in code hidden]", "[sign-in link hidden]", with
`signInHidden` telling the bot why), erring towards hiding. `show_draft` posts a `draft` card the person edits
(`MercbotDraftCard.vue`); a draft from a connected mailbox is sent from it on Send.

**Sedna** (D-93, D-94, `sednaTools.js`, `sednaApi.js`, `sednaChanges.js`, `sednaActions.js`): in any chat once the
home connected Sedna, as the asking person's own Sedna user (a person who is no one in Sedna is told why). Reads:
`sedna_messages`, `sedna_lists` and `sedna_attachments` (saved into `/files/chat/Sedna/<subject>/`, at most 10 files
or 60 MB a call), each kept to the person's teams before anything is shown; Sedna's reads hide nothing. Writes, each an
approval action through `sendOrSimulate`: `sedna_draft` (one draft card a reply, sent from Sedna on Send, in any chat),
`sedna_mail`, `sedna_sort`, `sedna_assign` and `sedna_contacts`, always from the person and one of their teams. A
routine's run also gets `sedna_inbox`, new messages since its last good run (at most 10 a run, `bot_routines.feeds`).
A change Sedna didn't answer is never tried again.

**Test copies** (D-69, D-87): what a bot sends to other people from a connected account goes out only when this
copy's `APP_ENV` is `production`; development, test and staging log it with JSKIT's line and answer with the live
copy's event line and `simulated: true`; a copy without `APP_ENV` is refused (`sendOrSimulate` in
`connectedApps.js`, `githubActions.js` `sends` and `simulated`, and the `mcp.sends` an app's plugin.json lists). Reads,
and changes that reach nobody, run in both.

**Coding** (`codingTools.js`, D-77, D14), on the person's own turn in any chat, on that chat's computer:
`connect_coding_account` checks Claude Code or Codex is signed in there and, if not, opens its sign-in for the person
to sign in with their own account (D14's line follows); `start_coding` starts it on the bot's brief in a folder of its
files (such as `/files/chat/website`) with a "… started working" line; `check_coding` reads its state and the end of
its output, or stops it. When the run ends the bot is woken in this chat to check the folder's changes and report
(`botLoops.js`).

**Skills** (`skills.js`, `skillTools.js`): Mercbot's own skills are Markdown files in `packages/bots/skills` (`name:`,
`description:`, `pickable: yes|no`, `---`, then the guidance); a copy built on Mercbot adds its own
(`mercbot.added-skills`, a name already listed refused). Every bot's standing instructions carry a one-line catalogue
of them and the cross-skill rules. The person's own skills (`user_skills`, theirs in each home, taught or saved by a
bot) are read only by them, and by a bot only in a Private chat whose one person they are (`personalRule`).
`read_skill` opens either kind by name; `save_skill` and `delete_skill` change the person's own, only with their
agreement. `GET /api/w/:workspaceSlug/bot-skills?chat=<chatId>` lists what the "/" picker offers in that chat:
Mercbot's pickable skills, and the person's own first only by the same rule (`ownSkillsIn`); a message that picks
one keeps it only there. `change_additions` changes the
bot's additions (`genesis/program/bots/templates.md`), offered on a person's own turn as an action that always asks.

**Teaching a task** (`botTeaching.js`, `teaching.js`): `POST /api/w/:workspaceSlug/chats/:chatId/bots/:botId/teach/start`
records the person on the bot's computer in that chat (they take it over, D16; 404 `bots_bot_not_in_chat`); `…/stop`
with `discard: true` throws the recording away and posts nothing (409 `bots_recording_missing` with none), and
otherwise posts the person's "finished" message and learns in the background: steps, input and instructions written
by a model and saved as the person's own skill in the home, then the skill link, numbered steps, the input and an
offer to try it. A recording it can't learn from gets a short explanation and no skill.

## Proved by

- `tests/server/transferFileCard.integration.js`
- `tests/server/startRoomCard.integration.js`
- `tests/server/botTalk.integration.js`
- `tests/server/botTalk.test.js`
- `tests/server/standInRooms.test.js`
- `tests/server/truthfulFiles.test.js`
- `tests/server/readFileParts.test.js`
- `tests/server/commandOutput.integration.js`
- `tests/server/pictureChecks.test.js`
- `tests/server/screenshotChecks.test.js`
- `tests/server/signInCodes.test.js`
- `tests/server/signInSecrets.test.js`
- `tests/server/signInChain.test.js`
- `tests/server/mailTools.test.js`
- `tests/server/calendarInfo.test.js`
- `tests/server/driveTools.test.js`
- `tests/server/githubTools.test.js`
- `tests/server/googleApps.test.js`
- `tests/server/connectorTools.test.js`
- `tests/server/sednaTools.test.js`
- `tests/server/sednaWrites.test.js`
- `tests/server/sednaWrites.integration.js`
- `tests/server/testCopySends.test.js`
- `tests/server/skills.test.js`
- `tests/server/teaching.test.js`
- `tests/e2e/sign-in-chain.spec.ts`
- `tests/e2e/sedna.spec.ts`
