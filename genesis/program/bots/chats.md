# Chats and their members

Everything in a home happens in chats (D-112): a chat holds any of the home's people and bots, is Public or Private from
the moment it's made, and is the one thing that decides who can open what is said and made in it. A chat is a room, or
a direct chat: a person's chat with a bot, or the chat between two people, each Private and readable only from itself
(D-117). This boundary owns the chat list, New room, joining (opening a faded Public room, or writing in it) and leaving, Invite, a chat's people and bots,
renaming, archiving and deleting, each person's own place in a chat, who is typing in it, the direct chats a bot's or a person's Message
opens, the home's everyone chat, and search across the chats a person can open.

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
- `packages/bots/src/server/records/sharedChatRepository.js`
- `packages/bots/src/server/records/builderSeats.js`
- `packages/bots/src/server/botChat.js`
- `packages/bots/src/server/records/sectionRepository.js`
- `packages/bots/src/server/records/rowPolicies.js`
- `packages/bots/src/server/records/directory.js`
- `packages/bots/src/server/records/recordRows.js`
- `packages/bots/src/server/records/tableResources.js`
- `packages/bots/src/server/records/BotRecordsFeature.js`
- `packages/bots/src/server/records/messageRepository.js`
- `packages/bots/src/server/records/searchSchemas.js`
- `migrations/20261122120000_chats_core.cjs`
- `migrations/20261122150000_chat_mentions.cjs`
- `migrations/20261122160000_chat_bots_join_in.cjs`
- `migrations/20261123120000_rooms_people_bots.cjs`
- `packages/bots/src/server/handOverNotes.js`
- `src/components/mercbot/chatsApi.js`
- `src/components/mercbot/useChatTyping.js`
- `src/components/mercbot/MercbotTypingDots.vue`
- `src/components/mercbot/chatMenus.js`
- `src/components/mercbot/chatDirectory.js`
- `src/components/mercbot/chatPlace.js`
- `src/components/mercbot/chatView.js`
- `src/components/mercbot/MercbotNewChat.vue`
- `src/components/mercbot/useNewChat.js`
- `src/components/mercbot/MercbotInviteDialog.vue`
- `src/components/mercbot/MercbotChatDetails.vue`
- `src/components/mercbot/MercbotChatList.vue`
- `src/components/mercbot/MercbotChatPanel.vue`

## Public contract

**What a chat is (D-112, R1, R2).** A chat is a `conversations` row of its home, `kind` `public` or `private`, chosen
when it's made and never changed. Its members are people (`chat_people`, each with their own place in it) and bots
(`chat_bots`, "this bot in this chat", which everything a bot runs in a chat hangs off: its reply runs, goal, to-do
list, job notes, computer, browser state, commands, routines, watches, app jobs and follow-ups). Everything said in it
is a `messages` row written by a person (`author_user_id`), a bot (`author_bot_id`) or Mercbot itself (neither). A
person's sidebar sections are `conversation_sections`. The migrations keep these rules in the database: a person's
chat with a bot names one person and one bot (`ux_conversations_direct`); a chat between two people names them both,
the lower id first (`direct_user_id < direct_person_id`, one per pair in a home, `ux_conversations_person_direct`); a
direct chat names a bot or a person, never both, has no title, and is Private (`conversations_direct_private_check`);
an app's chat (`app_id`, one per app) and the everyone chat (one per home) are Public. A **room** is any chat that
isn't a direct chat.

**Who can open a chat** is decided in one place, the row policies (`records/rowPolicies.js`): everyone in the home
opens a Public chat, now and later; a Private chat is opened only by its people. Everything keyed to a chat (its
messages, members, routines, requests, follow-ups, and the computers, files, commands, watches and app jobs of its bots)
is reached only where the chat is. A chat a person can't open answers 404 everywhere, as one that isn't there. Bots
are the home's: everyone in it reads every bot. An anonymous caller reads no chat. The model's reader, which every
bot turn reads through, is described in `genesis/program/bots/turns.md`: from any other chat it never reaches a
direct chat (`readable_from`, `migrations/20261123120000_rooms_people_bots.cjs`), so no other person, no bot elsewhere
and no bot's memory reads a person's chat with a bot or a chat between two people.

**Who may change what.** Anyone in the home makes a room, and joins a Public room by writing in it. Anyone who is one
of a room's people adds people of the home (403 `bots_chat_join_first` otherwise). Bots of the home that aren't
archived are invited into a Public room, and taken out, by anyone in the home, and into a Private room by its people.
The room's maker and the home's owners and admins remove people, rename, archive and delete it (403
`bots_chat_manage_forbidden`); only a Public room is archived, for everyone in it, while each person hides a Private
chat for themselves (their place's `hidden`). Anyone leaves. A direct chat takes no more members and no title (409
`bots_chat_direct`: "A direct chat is one person's with one bot. Continue with others to bring others in.", or for a
chat between two people "A private chat between two people takes nobody else."). An archived chat is read-only: every write but unarchive, delete, leave, taking a bot out, the
person's own place and read point answers 409 `bots_chat_archived` "This chat is archived. Unarchive it to continue."
(`registerRoutes.js` `guard`, which also answers 404 for a chat or bot of another home).

**Routes** (all under `/api/w/:workspaceSlug`, for a member of the home; each change tells everyone in the chat, and
anyone it took out, a `chat` event `{ chatId, change }` on bot events, `change` one of created, members, renamed,
settings (its bots joining in), archived, unarchived or deleted; a Public room's created, renamed, archived, unarchived
and deleted reach every active member of the home, from one read of them, so a room they aren't in appears and goes
without a reload):
- `GET …/chats` (`?hidden=1` for hidden ones, `?archived=1` for archived ones, `?after=` the page before's `next`):
  `{ chats, sections, next }`, a page of the chats the person is in: their places 100 at a time, newest chat first, an
  order no chat moves in while the pages are read (activity would move them), with the everyone chat first in its
  page (the whole list's first while it's one page); without `?archived=1` a page leaves its archived chats out, so it
  can be short. `next` is null on the last page. The page (`chatsApi.list`) reads every page and arranges the chats
  itself. Each chat is one `ChatView` (`types.js`):
  its kind, title, everyone, direct bot, the other person of a chat between two (`directPerson`), app, maker, onboarding step, archived time, latest activity, people
  (`{ userId, name }`), bots (`{ chatBotId, botId, name, color, shape, archived, waitingTask }`), the person's place
  (`{ readUpTo, unread, mentioned, pinPosition, sectionId, hidden, muted }`, null when they aren't in it) and its latest
  previewable message with a plain-text `preview`; the same reads for every page, whatever its chats. Sections are
  `{ id, name, position, collapsed }`.
- `GET …/chats/public` (`?after=` the page before's `next`): `{ chats, next }`, a page of the home's Public rooms the
  person isn't in (no direct chat, none archived), 100 at a time, newest made first, an order no room moves in while
  the pages are read: the rooms the sidebar lists faded. The same reads for every page.
- `GET …/chats/shared?withBot=<botId>` or `?withPerson=<userId>` (exactly one, else 400 `bots_shared_needs_one`;
  `&after=` the page before's `next`): `{ chats, next }`, a page of the person's own hidden or archived chats (their
  place `hidden`, or the chat archived) that bot (a seat of it) or person (a place of theirs) is in too, 20 at a time,
  newest chat first, an order no chat moves in while the pages are read: what a member's card adds under "Show hidden
  and archived" (`genesis/program/bots/team.md`). Narrowed in one statement (`records/sharedChatRepository.js`), then
  the page's chats and the person's places in them, each a `ChatView` as the list's, the same reads for every page. A
  bot that isn't the home's answers 404 `bots_bot_not_found`, a person who isn't an active member of it 404
  `bots_person_not_found`.
- `POST …/chats {kind?, title, people?, bots?}`: a new room (New room's Create), Public unless `kind` is `private`
  (D15), named (trimmed, up to 80 characters; 400 `bots_chat_needs_title` "Give the room a name."), its maker among its
  people, with the people (active members of the home, else 404 `bots_person_not_found`) and bots named, up to 200 of
  each (400 `bots_chat_too_many`). In the same transaction its maker's start line is written: "<Name> started this
  room.", an event line by the maker (`body.event: "room_started"`), drawn as a centred line, which counts as the
  room's activity and which no bot answers or judges (only a person's text message starts a reply). Chats made
  elsewhere (direct chats, the welcome chat, an app's Builder chat, the everyone chat) don't come this way.
- `POST …/chats/:chatId/messages` by a person of the home who isn't in a Public room seats them in it in the message's
  own transaction (`records.chats.joinByWriting`), and everyone in it hears: writing is how a person joins a room. A
  Private chat they aren't in is a 404.
- `GET`, `PATCH {title?, botsJoinIn?}` and `DELETE …/chats/:chatId` (`botsJoinIn`, a boolean, by whoever may rename
  it, never in a direct chat: D-115, `bots_join_in_invalid` for another value; with neither field it renames); `POST …/archive` and `…/unarchive`, `…/join` (a Public room
  only; a Private one is 404, an archived one 409 `bots_chat_archived`; the page calls it when the person opens a faded
  Public room that isn't the everyone chat or archived, `useRoomJoin.js`, following the chat shown, so a room just
  left stays left while it's open; a chat's news, `messages` and `working`, goes only to its people, so a faded room
  sends nothing until it's joined, D-125), `…/leave`; `POST …/people {userId}` and
  `DELETE …/people/:userId`; `POST …/bots {botId}` and `DELETE …/bots/:botId` (an archived bot can be taken out). A bot
  taken out of a chat takes its runs, computer, routines and watches there with it. A bot invited into a room reads it
  from its seat's start (`chat_bots.reads_from_message_id`, `records/seatWindows.js`): the room's 30th-newest message,
  or its beginning (null) when it has 30 or fewer; when there were more, a line of Mercbot's own (no one's, so it marks
  nothing unread) says "<Bot> joined. It reads the last 30 messages; ask it to read further back.", in the same
  transaction. A bot invited again after it left gets a fresh start (`genesis/program/bots/turns.md`). Each answers `{ chat }`, except leaving a Private chat (`{ left: true }`, it's
  no longer theirs to read) and a deletion (`{ deleted: true }`). Deleting a public chat makes its bots forget it at
  once (`genesis/program/bots/knowledge.md`, D-113); leaving or archiving a chat keeps what they remember.
- Archiving (plan 5.1): a Private chat answers 409 `bots_chat_private_archive` ("A private chat is hidden for
  yourself, not archived for everyone."), the everyone chat 409 `bots_chat_everyone`, and a chat already as asked is
  answered unchanged. In one transaction, its bots' routines and watches there are paused, with a "Paused while
  archived" line naming them ("This chat was archived, so its … paused. They stay paused when it's unarchived: resume
  them here.", `workPause.js` through the turns' `pauseWork`), and then it is archived. Unarchiving leaves them paused.
  A chat archived before this rule, Private or not, can still be unarchived.
- A Private chat whose last person goes is deleted with everything in it (nobody could open it any more); a Public
  room with nobody left stays, listed faded for everyone, and its maker can still rename, archive and delete it. Deleting a
  chat deletes its people, bots, messages and everything keyed to them, and then (`computer.chatRemoved`) puts its
  bots' computers to sleep and removes its folder, its computers' folders and its command outputs from where the
  home's files are kept; a failure is left to the computers' hourly sweep.
- `PATCH …/chats/:chatId/place {pinned?, sectionId?, hidden?, muted?, unread?}`: the person's own place, only in a chat
  they're in (404 `bots_chat_not_in`); `pinned: true` pins it last. `POST …/read {messageId}` moves their read point
  (`read_up_to`) and marks it read. `POST …/typing {typing}` (true or false, else 400 `bots_typing_invalid`; only one
  of the chat's people, else 403 `bots_chat_join_first`; at most 120 a minute per client address, past which JSKIT
  answers 429) tells the chat's other people at once, as a `typing` event `{chatId, userId, typing}` on bot-events, and
  keeps nothing. A page says so at the person's first word in the box and again every 3 seconds while they type, and
  that they stopped when they send, empty it, pause for 5 seconds, or leave the chat; opening a chat with a draft isn't
  typing, and a chat with nobody else hears nothing. The others' pages show it for 7 seconds after the last word unless
  told again: a pill over the bottom of the chat, by the box, so nothing moves ("Ana is typing", "Ana and Max are
  typing", "Ana, Max and Lee are typing", "Several people are typing", with dots that rise in turn, still for people
  who ask for less motion), and dots on the chat's row in the sidebar (`useChatTyping.js`). `PUT …/chat-pins {chatIds}` reorders their pinned chats in one statement (409
  `bots_pins_changed` when the pinned chats aren't exactly those). `POST …/chat-sections {name, chatId?}` makes a
  section (from a chat, directly above it, holding it), `PATCH …/chat-sections/:id {name?, collapsed?}`, `POST
  …/move {direction}` and `DELETE` (its chats go back to the list's main part). Each answers the list.
- `POST …/bots/:botId/direct`: the person's direct chat with a bot, Private and readable only from itself (D-117),
  made on first use (one per person and bot: two first uses at once make one), where the bot then introduces itself
  (`genesis/program/bots/onboarding.md`). Every chat with a bot is made this way (`records.chats.direct`): a bot's
  Message, the welcome chat, a new bot's greeting, an Apps hand-off. Another person gets 404 on it and on everything
  keyed to it, and search never returns it.
- `POST …/people/:userId/direct`: `{ chat }`, the person's chat with another person of the home (People, a person's
  Message), Private and readable only from itself, with no bot, made on first use: an insert that skips the pair when
  it's there, then a read of it, both seated in the same transaction, so two first uses at once make one; someone who
  left it is seated again. 404 `bots_person_not_found` for someone who isn't an active member of the home, 400
  `bots_direct_self` "That's you." for themselves. Adding anyone to it, or renaming it, answers 409 `bots_chat_direct`;
  either person may leave it, and it is deleted once both have. The chat view names the other person (`directPerson`,
  `{ userId, name }`, one read of names for any number of such chats).
- A message by someone marks the chat unread for its other people and counts as its activity
  (`records/messageRepository.js` `append`); Mercbot's own lines do neither.
- **Mentions (D-114).** A message that mentions some of the chat's other people (`body.mentionedPeople`,
  `genesis/program/bots/turns.md`) sets their place's `mentioned_at` in its transaction, in one UPDATE for all of
  them, where it isn't set (`records.chats.markMentioned`); reading the chat or marking it read clears it, as it
  clears `unread`, and nothing else sets it (`PATCH …/place` doesn't take it). The place answers `mentioned`, and the
  chat list shows "@" (labelled "Mentioned you") on the chat's row and tile in place of the unread dot.
- **Continue with others (D-114).** `POST …/chats/:chatId/hand-over-note` answers `{ note }`, the direct chat's bot's
  note for the people it goes on with: only for a direct chat (409 `bots_chat_not_direct`) and its own person (403
  `bots_chat_not_yours`), a write the guard refuses in an archived chat and a paused home (402 `work_paused`), and 409
  `bots_bot_archived` for an archived bot. It reads the chat's newest page (100 messages) as people see it, each line
  "Name: what they said" with a card's one line and files by name, through the model's reader for the bot in that
  chat, never a transcript, trigger, summary or the bot's state there, in one billed call (`meter.track`, chat work);
  a chat with nothing said answers `""` without one (`handOverNotes.js`, an R12 row). A chat with a bot's header
  offers "Continue with others…" (a phone's too), which opens New room for it (`useNewChat.js` `continueWithOthers`):
  Public, "<Bot> comes along, and its note for the others is ready to send.", and the room's name. Create makes the
  room with the bot in it (its maker's start line first), opens it, and puts the note in the message box unless the
  person has typed there, to read, change and send as their first message. Nothing links the new room to the direct
  chat, which stays as it was.

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
chat with a bot by its bot, a chat between two people by the other person), which it opens. A fixed number of reads,
whatever it finds.

**New room** (`MercbotNewChat.vue`, `useNewChat.js`; Rooms' +, "+ New room" while there are none, Ctrl+Alt+G, the
palette). Title "New room". Two choices, Public chosen by default: "Public", "Everyone in <home> can open it, and its
bots remember what's said here in their other chats.", and "Private", "Only its members can open it, and nothing in it
reaches other chats.", with "You can't change this once the room has started." under them (`chatView.js`
`KIND_MEANS`); then a required "Name" (up to 80 characters, "For example, Kitchen renovation"), with the server's 400
shown under it, and Cancel and Create ("Creating…"). Create makes the room with only its maker in it and opens it; a
Private room then opens Invite. On a phone it fills the screen.

**Invite** (`MercbotInviteDialog.vue`, `chatMenus.js` `inviteChoices`; the room's header, and right after a Private room
is made). In a Private room, "Invite": the home's people and active bots not in it yet ("People and bots", people
first, then bots, each by name), with "Whoever you invite to “<room>” sees everything said here, from its start."; in a
Public room, "Invite a bot": its active bots not in it ("Bots"), with "Everyone in the home can open “<room>” already. A
bot you invite answers here, and can be taken out again." Picks are chips in one field that filters on the page over
the home's people and bots already loaded (`useTeam.js`); Add adds each through `POST …/people` and `POST …/bots`.
Neither shows in a direct chat.

**Chat details** (`MercbotChatDetails.vue`; a room: a chat with a bot shows its bot's card, a chat between two people
the other person's). Its title,
with a rename pencil for whoever may, "Public" or "Private" (" · Archived") and what that kind means; tabs "Chat",
"Files" (the chat's folder, labelled "This chat") and "Computers" (`genesis/program/computer/bot-computer.md`). The
Chat tab lists "People" (each opens their card; "(you)"), with an × for whoever may remove them, "Bots" (" ·
archived", with an × for whoever may take a bot out: anyone in a Public room, its people in a Private one), "Routines" (`genesis/program/bots/routines.md`), and Leave chat (also a labelled, outlined **Leave room** button in the
header of a Public room the person is in, "Leave" on a phone, asking the same question, D-125), Archive (a Public chat) or Unarchive,
Hide from sidebar (a Private chat the person is in and hasn't hidden) and Delete chat for whoever may; the everyone chat says "Everyone in <home> is in this chat, for as long as they're in the home."
Under Bots, a chat with bots shows **Bots join in when useful** (D-115, the chat view's `botsJoinIn`, off by default),
a switch for whoever may rename it (`chatRights` `joinIn`), with "When someone writes without calling a bot, one bot
may answer if it can help. Off, bots answer only when called."; for anyone else it is shown but disabled, with "Only
the person who started this chat and the home's owners and admins can change this."

## Proved by

- `tests/server/chatMembers.integration.js`
- `tests/server/sharedTuckedAway.integration.js`
- `tests/server/rooms.integration.js`
- `tests/server/chatVisibility.integration.js`
- `tests/server/chatsSchema.integration.js`
- `tests/server/firstUse.integration.js`
- `tests/server/botsRouteGuard.test.js`
- `tests/server/botRecordsScoped.integration.js`
- `tests/server/botLibrary.integration.js`
- `tests/client/newChat.vitest.js`
- `tests/client/inviteDialog.vitest.js`
- `tests/client/chatHeader.vitest.js`
- `tests/client/chatDetails.vitest.js`
- `tests/server/joinInChats.integration.js`
- `tests/client/chatDirectory.vitest.js`
- `tests/e2e/chats-people.spec.ts`
- `tests/e2e/chats-archive.spec.ts`
- `tests/server/archiveChats.integration.js`
- `tests/client/shellParts.vitest.js`
- `tests/server/acrossHomesReads.integration.js`
- `tests/server/botsNarrowReads.integration.js`
- `tests/server/homes.integration.js`
- `tests/server/personMentions.integration.js`
- `tests/server/continueWithOthers.integration.js`
- `tests/client/personMentions.vitest.js`
- `tests/e2e/people-in-chats.spec.ts`
