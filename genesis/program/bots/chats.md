# Chats and their members

Everything in a home happens in chats (D-112): a chat holds any of the home's people and bots, is Public or Private from
the moment it's made, and is the one thing that decides who can open what is said and made in it. This boundary owns
the chat list, New chat, joining and leaving, a chat's people and bots, renaming, archiving and deleting, each person's
own place in a chat, the direct chat a bot's Message opens, the home's everyone chat, and search across the chats a
person can open.

## Sources

- Main: `packages/bots/src/server/chatMembers.js`
- `packages/bots/src/server/registerRoutes.js`
- `packages/bots/src/server/botsService.js`
- `packages/bots/src/server/BotsFeature.js`
- `packages/bots/src/server/types.js`
- `packages/bots/src/server/botRows.js`
- `packages/bots/src/server/botsError.js`
- `packages/bots/src/server/botLibrary.js`
- `packages/bots/src/server/records/chatRepository.js`
- `packages/bots/src/server/records/rowPolicies.js`
- `packages/bots/src/server/records/directory.js`
- `packages/bots/src/server/records/recordRows.js`
- `packages/bots/src/server/records/tableResources.js`
- `packages/bots/src/server/records/BotRecordsFeature.js`
- `packages/bots/src/server/records/messageRepository.js`
- `packages/bots/src/server/records/searchSchemas.js`
- `migrations/20261122120000_chats_core.cjs`
- `src/components/mercbot/chatsApi.js`
- `src/components/mercbot/chatMenus.js`
- `src/components/mercbot/chatDirectory.js`
- `src/components/mercbot/chatPlace.js`
- `src/components/mercbot/chatView.js`
- `src/components/mercbot/MercbotNewChat.vue`
- `src/components/mercbot/useNewChat.js`
- `src/components/mercbot/MercbotChatDetails.vue`

## Public contract

**What a chat is (D-112, R1, R2).** A chat is a `conversations` row of its home, `kind` `public` or `private`, chosen
when it's made and never changed. Its members are people (`chat_people`, each with their own place in it) and bots
(`chat_bots`, "this bot in this chat", which everything a bot runs in a chat hangs off: its reply runs, goal, to-do
list, job notes, computer, browser state, commands, routines, watches, app jobs and follow-ups). Everything said in it
is a `messages` row written by a person (`author_user_id`), a bot (`author_bot_id`) or Mercbot itself (neither). A
person's sidebar sections are `conversation_sections`. The migration keeps these rules in the database: a direct
chat names one person and one bot (`ux_conversations_direct`) and has no title; an app's chat (`app_id`, one per app)
and the everyone chat (one per home) are Public.

**Who can open a chat** is decided in one place, the row policies (`records/rowPolicies.js`): everyone in the home
opens a Public chat, now and later; a Private chat is opened only by its people. Everything keyed to a chat (its
messages, members, routines, requests, follow-ups, and the computers, files, commands, watches and app jobs of its bots)
is reached only where the chat is. A chat a person can't open answers 404 everywhere, as one that isn't there. Bots
are the home's: everyone in it reads every bot. An anonymous caller reads no chat. The model's reader, which every
bot turn reads through, is described in `genesis/program/bots/turns.md`.

**Who may change what.** Anyone in the home makes a chat and joins a Public one. Anyone who is one of a chat's people
adds people of the home and bots of the home that aren't archived (403 `bots_chat_join_first` otherwise). The chat's
maker and the home's owners and admins remove members, rename, archive and delete it (403
`bots_chat_manage_forbidden`); only a Public chat is archived, for everyone in it, while each person hides a Private chat
for themselves (their place's `hidden`). Anyone leaves. A direct chat takes no more members and has no title of its own (409
`bots_chat_direct`). An archived chat is read-only: every write but unarchive, delete, leave, taking a bot out, the
person's own place and read point answers 409 `bots_chat_archived` "This chat is archived. Unarchive it to continue."
(`registerRoutes.js` `guard`, which also answers 404 for a chat or bot of another home).

**Routes** (all under `/api/w/:workspaceSlug`, for a member of the home; each change tells everyone in the chat, and
anyone it took out, a `chat` event `{ chatId, change }` on bot events, `change` one of created, members, renamed,
archived, unarchived or deleted):
- `GET …/chats` (`?hidden=1` for hidden ones, `?archived=1` for archived ones, `?after=` the page before's `next`):
  `{ chats, sections, next }`, a page of the chats the person is in: their places 100 at a time, newest chat first, an
  order no chat moves in while the pages are read (activity would move them), with the everyone chat first in its
  page (the whole list's first while it's one page); without `?archived=1` a page leaves its archived chats out, so it
  can be short. `next` is null on the last page. The page (`chatsApi.list`) reads every page and arranges the chats
  itself. Each chat is one `ChatView` (`types.js`):
  its kind, title, everyone, direct bot, app, maker, onboarding step, archived time, latest activity, people
  (`{ userId, name }`), bots (`{ chatBotId, botId, name, color, shape, archived, waitingTask }`), the person's place
  (`{ readUpTo, unread, pinPosition, sectionId, hidden, muted }`, null when they aren't in it) and its latest
  previewable message with a plain-text `preview`; the same reads for every page, whatever its chats. Sections are
  `{ id, name, position, collapsed }`.
- `GET …/chats/public`: the home's Public chats the person isn't in, newest activity first (at most 50), for New
  chat's "Or join a public chat".
- `POST …/chats {kind?, title?, people?, bots?}`: a new chat, Public unless `kind` is `private` (D15), its maker among
  its people, with the people (active members of the home, else 404 `bots_person_not_found`) and bots named, up to
  200 of each (400 `bots_chat_too_many`), and a title of up to 80 characters; a Private chat needs a person (400
  `bots_chat_needs_person`).
- `GET`, `PATCH {title}` and `DELETE …/chats/:chatId`; `POST …/archive` and `…/unarchive`, `…/join` (a Public chat
  only; a Private one is 404), `…/leave`; `POST …/people {userId}` and `DELETE …/people/:userId`; `POST …/bots {botId}`
  and `DELETE …/bots/:botId` (an archived bot can be taken out). A bot taken out of a chat takes its runs, computer,
  routines and watches there with it. Each answers `{ chat }`, except leaving a Private chat (`{ left: true }`, it's
  no longer theirs to read) and a deletion (`{ deleted: true }`). Deleting a public chat makes its bots forget it at
  once (`genesis/program/bots/knowledge.md`, D-113); leaving or archiving a chat keeps what they remember.
- Archiving (plan 5.1): a Private chat answers 409 `bots_chat_private_archive` ("A private chat is hidden for
  yourself, not archived for everyone."), the everyone chat 409 `bots_chat_everyone`, and a chat already as asked is
  answered unchanged. In one transaction, its bots' routines and watches there are paused, with a "Paused while
  archived" line naming them ("This chat was archived, so its … paused. They stay paused when it's unarchived: resume
  them here.", `workPause.js` through the turns' `pauseWork`), and then it is archived. Unarchiving leaves them paused.
  A chat archived before this rule, Private or not, can still be unarchived.
- A Private chat whose last person goes is deleted with everything in it (nobody could open it any more). Deleting a
  chat deletes its people, bots, messages and everything keyed to them, and then (`computer.chatRemoved`) puts its
  bots' computers to sleep and removes its folder, its computers' folders and its command outputs from where the
  home's files are kept; a failure is left to the computers' hourly sweep.
- `PATCH …/chats/:chatId/place {pinned?, sectionId?, hidden?, muted?, unread?}`: the person's own place, only in a chat
  they're in (404 `bots_chat_not_in`); `pinned: true` pins it last. `POST …/read {messageId}` moves their read point
  (`read_up_to`) and marks it read. `PUT …/chat-pins {chatIds}` reorders their pinned chats in one statement (409
  `bots_pins_changed` when the pinned chats aren't exactly those). `POST …/chat-sections {name, chatId?}` makes a
  section (from a chat, directly above it, holding it), `PATCH …/chat-sections/:id {name?, collapsed?}`, `POST
  …/move {direction}` and `DELETE` (its chats go back to the list's main part). Each answers the list.
- `POST …/bots/:botId/direct`: the person's direct chat with a bot, Public like any other (D15), made on first use
  (one per person and bot: two first uses at once make one), where the bot then introduces itself
  (`genesis/program/bots/onboarding.md`).
- A message by someone marks the chat unread for its other people and counts as its activity
  (`records/messageRepository.js` `append`); Mercbot's own lines do neither.

**The everyone chat** (O9). When a home's owner or admin answers the welcome chat's "Will anyone else use this home?"
with "Me and other people", the home gets one Public chat with every active member in it and the main bot, titled with
the home's name. It is first in everyone's list and counts as pinned for each of them, with no position; `pinned`
doesn't move it. Nobody leaves it or is taken out of it, and it isn't archived (409 `bots_chat_everyone`), but by leaving the
home; its bots can be taken out. The page offers no Leave, Unpin, Archive, Unarchive or Delete for it (`chatMenus.js`
`chatRights`); the server refuses taking a person out and archiving, but not deleting it.

**The home's people changing** (R2). JSKIT tells the bots when a home's members change (`BotsFeature`,
`homeChanged`): whoever joined is seated in the everyone chat; whoever left first has the routines and watches they
made paused with a "Paused: its maker left" line in each chat (they ran as them, R4, `workPause.js`), then is taken out
of every chat (`records.chats.personLeft`), and their Private chats with no one else are deleted with their computers
and files. Their messages stay, under their name. Everyone in a chat that changed hears, the person who left too; a
failure is caught up at the home's next change of people. `records.chats.personJoined` seats someone in the everyone
chat for a copy built on Mercbot that adds people its own way.

**Search** (`GET …/search?q=`, `botLibrary.js` `search`), across the chats the person can open that aren't archived:
with no query, every routine there with its bot and chat ("Paused" for its schedule while it's off), which the palette
reads once as it opens; with a query of two characters or more, up to 5 messages containing it (earliest match in the
text first, each with its author and chat), the things bots made whose name holds the words, and up to 5 of the home's
views by name (every view is the home's, whichever chat made it, D-66), views first. Each result names its chat (a
direct chat by its bot, with the person's name when it's someone else's), which it opens. A fixed number of reads,
whatever it finds.

**New chat** (`MercbotNewChat.vue`, `useNewChat.js`; Ctrl+Alt+G, the sidebar's "New chat or bots" menu, the
palette). Title "New chat". Two choices, Public chosen by default: "Public", "Everyone in <home> can open it, and its
bots remember what's said here in their other chats.", and "Private", "Only its members can open it, and nothing in it
reaches other chats.", with "You can't change this once the chat has started." under them (`chatView.js`
`KIND_MEANS`). "To:" takes people and bots of the home as chips ("People", "Bots"; "No one in <home> by that name."),
"Title (optional)" (placeholder "Its members' names"), then "Write the first message below, or press Enter there to
start it empty." and Start. Under it, "Or join a public chat", each with its people count and Join. A person's
Message on Team opens New chat with them on To:. Chats made without New chat (a bot's Message, a new bot's greeting,
the welcome chat, an app's Builder chat, the everyone chat) are Public.

**Chat details** (`MercbotChatDetails.vue`; any chat but a direct one, whose details are its bot's card). Its title,
with a rename pencil for whoever may, "Public" or "Private" (" · Archived") and what that kind means; tabs "Chat",
"Files" (the chat's folder, labelled "This chat") and "Computers" (`genesis/program/computer/bot-computer.md`). The
Chat tab lists "People" (each opens their card; "(you)"), with an × for whoever may remove them, "Bots" (" ·
archived"), "Routines" (`genesis/program/bots/routines.md`), and Leave chat, Archive (a Public chat) or Unarchive,
Hide from sidebar (a Private chat the person is in and hasn't hidden) and Delete chat for whoever may; the everyone chat says "Everyone in <home> is in this chat, for as long as they're in the home."

## Proved by

- `tests/server/chatMembers.integration.js`
- `tests/server/chatVisibility.integration.js`
- `tests/server/chatsSchema.integration.js`
- `tests/server/firstUse.integration.js`
- `tests/server/botsRouteGuard.test.js`
- `tests/server/botRecordsScoped.integration.js`
- `tests/server/botLibrary.integration.js`
- `tests/client/newChat.vitest.js`
- `tests/client/chatDetails.vitest.js`
- `tests/client/chatDirectory.vitest.js`
- `tests/e2e/chats-people.spec.ts`
- `tests/e2e/chats-archive.spec.ts`
- `tests/server/archiveChats.integration.js`
- `tests/client/shellParts.vitest.js`
- `tests/server/acrossHomesReads.integration.js`
- `tests/server/botsNarrowReads.integration.js`
- `tests/server/homes.integration.js`
