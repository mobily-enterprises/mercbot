# The home's team: its bots and their cards

Bots are members of the home, as people are (D-112): everyone in the home sees every bot and can bring it into a
chat. This boundary owns Team, a bot's card, renaming, archiving and deleting a bot, the main bot, and a bot's Library
of what it made in the chats the person can open. Making bots is the bot templates module
(`genesis/program/bots/templates.md`).

## Sources

- Main: `packages/bots/src/server/botList.js`
- `packages/bots/src/server/botSettings.js`
- `packages/bots/src/server/botArchive.js`
- `packages/bots/src/server/botLibrary.js`
- `packages/bots/src/server/workPause.js`
- `packages/bots/src/server/botRows.js`
- `packages/bots/src/server/botsError.js`
- `packages/bots/src/server/botsService.js`
- `packages/bots/src/server/registerRoutes.js`
- `packages/bots/src/server/records/botRepository.js`
- `packages/bots/src/server/records/archiveRepository.js`
- `packages/bots/src/server/records/makerRepository.js`
- `packages/bots/src/server/records/messageRepository.js`
- `migrations/20261122120000_chats_core.cjs`
- `migrations/20261121220000_archived_bots.cjs`
- `src/components/mercbot/MercbotTeamPage.vue`
- `src/components/mercbot/MercbotMemberCard.vue`
- `src/components/mercbot/MercbotDetailsPanel.vue`
- `src/components/mercbot/useTeam.js`
- `src/components/mercbot/useBotLibrary.js`
- `src/components/mercbot/archiveBot.js`
- `src/components/mercbot/MercbotBotArchive.vue`
- `src/components/mercbot/MercbotArchivedBotBanner.vue`
- `src/components/mercbot/botsApi.js`

## Public contract

**A bot** is a `bots` row of its home: name, shape, palette colour, whether it's the main bot (`is_main`, one per home),
who made it (`made_by`, kept null once that account goes, so a person's account going deletes nothing they made), its
template and additions (D-98) and since when it's archived (`archived_at`, `archived_by`, D-108). It has no mode and
no person of its own: what it sees is decided by the chat it's in (`genesis/program/bots/chats.md`). Every route is
under `/api/w/:workspaceSlug`, for a member of the home; a bot of another home answers 404.

**Reading the team** (`botList.js`): `GET …/bots` lists the home's bots, archived ones too, each as Team shows it
(`toBot`: its look, `isMain`, `madeBy`, its template's chip, whether it has additions and their first line,
`archivedAt`), with who made it (`madeByName`, "you" for the person), who archived it, whether it builds the home's
apps (`isBuilder`) and whether the person may archive and unarchive it (`canArchive`): three reads whatever the
number of bots. `GET …/bots/:botId` answers one bot the same way (`{ bot }`). Everyone in the home hears a `bot` event
(`{ botId, change }`) when bots change, on any server.

**Changing a bot** (`botSettings.js`): `PATCH …/bots/:botId {name?, additions?, main?}`: anyone in the home renames it;
its additions are for its maker and the home's owners and admins (403 `bots_additions_forbidden`); `main: true` makes
it the home's main bot, only for owners and admins (403 `bots_main_bot_manage_forbidden` "Only the home's owners and
admins can replace the main bot."). An archived bot is refused (409 `bots_bot_archived` "<Bot> is archived. Unarchive
it to continue."). `DELETE …/bots/:botId` deletes it for everyone in the home, by its maker and the home's owners and
admins (403 `bots_delete_forbidden`), never the main bot (409 `bots_main_bot_delete` "Your main bot can't be
deleted."). Its seats in every chat go with it, and so does each person's direct chat with it (those chats' computers
and folders are removed, its other computers put to sleep); what it wrote elsewhere stays, its author gone. Everyone
in the home hears it, and each person who had a direct chat with it that the chat is gone. The page offers neither
Delete nor Make main bot today.

**Archiving a bot** (D-108, `botArchive.js`): `POST …/bots/:botId/archive` and `…/unarchive`, for its maker and the
home's owners and admins (403 `bots_archive_forbidden`, decided before anything about the bot is said). The main bot
(409 `bots_archive_main` "<Bot> is this home's main bot, so it can't be archived. Make another bot the main bot
first.") and the Builder (409 `bots_archive_builder` "… Choose another Builder in Apps first.") aren't archived.
Archiving pauses its routines and watches in every chat it's in, the Private ones the person can't open too, with a
"Paused while archived" line there, and puts its computers to sleep; archiving one already archived changes nothing.
An archived bot never speaks, takes no requests, isn't added to chats and isn't offered in pickers; its direct chat
shows "<Bot> has left <home>" with who archived it and Resume for whoever may (`MercbotArchivedBotBanner.vue`).
Unarchiving brings it back in every chat it was in, as it was; its paused routines and watches wait for someone to
resume them. Each answers the bot as Team lists it; everyone in the home hears it.

**Library** (`botLibrary.js`): `GET …/bots/:botId/library` lists what the bot made (files, charts, pictures, pages and
views, one entry per path) in every chat the person can open, and nothing from the others: the newest 400, then every
older pinned one, so a pin never drops out (two reads). `POST …/library/pin {messageId, path, pinned}` pins or unpins
one, by anyone who can open its chat (404 `bots_library_entry_not_found` otherwise); a card's own pin is merged in by
the database, so a delete that marked it meanwhile isn't undone. `DELETE …/library/pages/:messageId` deletes a page,
after the person confirmed, by anyone who can open the chat it was made in: its file goes with its versions and link
(D-74), and every card of it is marked deleted wherever the same file shows (the home's shared folder is everyone's,
the bot's folder the bot's in all its chats, a chat's folder that chat's). It's the person's own action, so it
reaches the bot's and the home's folders even from a Private chat (D13). It answers the Library and the cards in the
page's chat.

**For other features:** `mercbot.bots.records`' `makers.botsMadeBy(userId, limit, options)` answers the bots a person
made, newest first, with their homes, and `makers.chatsOf(userId, workspaceIds, limit, options)` the chats a person is
in, latest activity first (only which chat, its kind, where and when, never a title or a message), in every home the
options reach (a system context's every home; a request's its own).

**Team** (`MercbotTeamPage.vue`, `useTeam.js`; the sidebar's Team entry, the palette): "Team · <home>" with Add bots
(and what a copy adds beside it, such as an invite). People: name ("(you)"), role and Message, which opens New chat
with them on To:. Bots: name with its template's tag, "Bot · made by you" or "Bot · made by <name>" with its
description, and Message, which opens the person's direct chat with it. Under "Archived", each archived bot with when
it left and Resume for whoever may. A home with no one else says "Just you here so far. Add bots to start your
team." The home's people come from JSKIT's members list, a page of 100 at a time.

**A member's card** (`MercbotMemberCard.vue`, opened from Team, from a chat's people and bots, and as a direct chat's
details; `?team=1&member=bot:<id>` or `person:<id>`): a person's name, role, Message and "Chats you share" ("No chats
with <name> yet."). A bot's name (editable by whoever may), template tag and Message, with tabs "Details"
(Instructions, Knowledge, the apps it uses, Routines, each naming its chat, and Archive, `MercbotBotArchive.vue`),
"Files" ("This chat" when opened from a chat, "<Bot>'s files" and the home's), "Library" (Pinned, then each day, each
item with Pin, and Open, Share… and Delete for a page; empty: "Anything <Bot> makes in the chats you can open, like
pages, files and apps, will be kept here.") and "Computer" ("<Bot> has its own computer in each chat it's in. Open one
from that chat's details." with the chats the person shares with it). Archive asks first (`archiveBot.js`) and says
why not where the bot can't be archived.

## Proved by

- `tests/server/archiveBots.integration.js`
- `tests/server/botLibrary.integration.js`
- `tests/server/botAdditions.test.js`
- `tests/client/teamPage.vitest.js`
- `tests/client/teamReads.vitest.js`
- `tests/client/archiveBots.vitest.js`
- `tests/e2e/archive-bots.spec.ts`
- `tests/e2e/instructions.spec.ts`
- `tests/server/botAdditions.integration.js`
