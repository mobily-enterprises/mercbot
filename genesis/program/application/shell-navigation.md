# Shell navigation

Composes the adaptive shell's navigation and status areas from placements.
Defines where top-level menu, section-navigation, identity, and status content
render across compact, medium, and expanded layouts.

## Sources

- Main: `src/components/mercbot/MercbotShell.vue`
- `src/components/mercbot/useShellLayout.js`
- `src/components/mercbot/useShellKeys.js`
- `src/components/mercbot/useSidebarCommands.js`
- `src/components/mercbot/useShellTheme.js`
- `src/components/mercbot/useShellDialogs.js`
- `src/components/ShellLayout.vue`
- `src/components/mercbot/MercbotSidebar.vue`
- `src/components/mercbot/MercbotChatList.vue`
- `src/components/mercbot/chatMenus.js`
- `src/components/mercbot/useChatDrag.js`
- `src/components/mercbot/chatDirectory.js`
- `src/components/mercbot/useShellAddress.js`
- `src/components/mercbot/MercbotDetailsPanel.vue`
- `src/components/mercbot/MercbotMemberCard.vue`
- `src/components/mercbot/MercbotChatPanel.vue`
- `src/components/mercbot/useBotLibrary.js`
- `src/components/mercbot/MercbotPageShare.vue`
- `src/components/mercbot/useBotRoutines.js`
- `src/components/mercbot/useBotInstructions.js`
- `src/components/mercbot/useChatEvents.js`
- `src/components/mercbot/useChatMessages.js`
- `src/components/mercbot/useFindInChat.js`
- `src/components/mercbot/MercbotSearchPalette.vue`
- `src/components/mercbot/paletteEntries.js`
- `src/components/mercbot/usePaletteRunner.js`
- `src/components/mercbot/useDrafts.js`
- `src/components/mercbot/MercbotContextMenu.vue`
- `src/components/mercbot/MercbotConfirmDialog.vue`
- `src/components/mercbot/MercbotChatAvatar.vue`
- `src/components/mercbot/shellInitials.js`
- `src/components/mercbot/shellGeometry.js`
- `src/components/mercbot/shellPreferences.js`
- `src/components/mercbot/shortcuts.js`
- `index.html`
- `src/placement.js`
- `src/placementTopology.js`
- `config/public.js`
- `src/main.js`
- `src/browser.js`
- `src/types.js`
- `packages/main/src/client/providers/MainClientProvider.js`

## Public contract

**Phones** (below 600 px):
- The chat fills the screen. The chat list is a drawer, opened from the menu button at the top
  left (a dot marks news in another chat); choosing a chat closes it.
- Chat details, or a member's card, cover the chat.
- Settings and Connect apps fill the screen. Settings shows one section with **All settings**
  to the list; Connect apps shows one column of apps.
- From 600 px up, the desktop layout applies (rail below 704 px).

- The initial document shows Mercbot's splash before JavaScript is available: the orange cloud (D-44), the name,
  an indeterminate bar (still under reduced motion) and "Loading Mercbot…" as a polite status, on the app's own
  background in light or dark, by the device's setting or the theme saved on the device. Reload page, a link to the
  page shown as a text button, shows only after 10 seconds (a CSS timer), or at once when the script can't be
  downloaded or initialization fails, which then says "Mercbot could not open". Successful mounting replaces it.
- The page's title, which a browser tab, a bookmark and a phone's home-screen shortcut show, is `Mercbot` from the
  initial document on; the help centre sets its own page's title while it is open and gives it back.
- The `home` surface uses the app-owned Mercbot shell: sidebar or compact
  rail, chat panel and the details panel (`MercbotDetailsPanel.vue`: Chat details, or a member's card for a direct
  chat's bot and on Team), with per-device layout choices (compact, widths, details open, accent). Other surfaces keep the JSKIT shell.
- The account menu offers Settings (the account page); a copy built on Mercbot adds its own entries, such as Sign
  out (`extensions.js` `accountMenu`).
- The sidebar footer shows the account's name and square Skills (a book) and
  Connect apps buttons at rest; while hovered, the avatar alone, Skills and a wide
  Connect apps pill with app icons. The rail has both below "New chat or bots". Skills, also
  Ctrl+Alt+W and the palette's Skills, opens Connect apps on Your apps and skills
  (`startPage: "manage"`), scrolled to Private skills. The account button's avatar, there and in
  the rail, is the picture the person uploaded in account settings
  (`GET /api/settings/profile/avatar`), else their initials. It comes from the
  placement context's user, as JSKIT's account bar reads it (JSKIT's own
  fallback there, a Gravatar address, doesn't count), which JSKIT reads again
  as the person comes back from their settings, so a changed or removed
  picture shows with no reload; one that doesn't load shows the initials.
- Global shortcuts are listed in the shortcuts sheet; where the browser keeps a
  key for itself, Mercbot uses its own replacement (D-2). Back and forward are the
  browser's own (D-64): Mercbot binds no key for them. Ctrl+[ is the Up
  arrow's key: on Apps, an app, a table and Files the home layout
  (`src/pages/w/[workspaceSlug].vue`) runs JSKIT's Up for it.
- The Follow System / Light / Dark theme preference applies at startup and
  tracks live system changes.
- The sidebar (`MercbotSidebar.vue`) has Search and a "New chat or bots" button (+) whose menu is New chat and Add
  bots, then Team, Files and Apps above the person's chats (`MercbotChatList.vue`, `chatDirectory.js`): pinned tiles
  ("Pinned chats", the home's everyone chat first), the person's sections, "Unassigned", "Hidden chats" and
  "Archived chats" (newest archived first, "Archived · read-only"); rows sort by latest activity. A direct chat shows
  its bot's face and name; any other its members' faces, its title and a globe (Public) or a lock (Private), with
  "Waiting for you: <task>" or "Draft:" where so. With no chats: "No chats yet." and Start a chat. Position hints, Go
  to chat (Ctrl+Alt+1…9), previous/next (Alt+Up/Down) and Switch chats follow that visual order. A row's menu
  (`chatMenus.js`, on right-click) has Pin, Move to (the sections, Unassigned, Create section) or Move
  to new section, Mark as read or unread, Rename chat (its maker and the home's owners and admins; not a direct chat),
  Copy chat ID, Hide from sidebar, Leave chat (not the everyone chat or a direct chat), Archive (a Public chat only)
  and Delete (its maker and the home's owners and admins; not the everyone chat; `chatMenus.js` `chatRights`), each change on the person's own place or the chat
  (`genesis/program/bots/chats.md`); Archive ("Archive “<title>”?", "It stays readable for everyone in it, and no one
  can write in it until it's unarchived."), Leave and Delete ("This chat goes for everyone in it, with its whole
  history, its files and its bots' computers. Its bots stay on your team. This can't be undone.") ask first. Hidden
  rows offer Show in sidebar, archived ones Unarchive. Rows and tiles drag to reorder pins and move between sections
  (`useChatDrag.js`). Drafts are kept per chat on the device.
- The address names what's shown (`useShellAddress.js`): `?chat=<id>` the open chat, which choosing a chat always sets
  (choosing the one already shown names it in place, adding no history entry), `?team=1` Team, and
  `&member=bot:<id>` or `person:<id>` a member's card beside it. Links from elsewhere name a bot: `?bot=<id>` opens the
  person's direct chat with it (made on first use), and `?bot=<id>&files=1` its card on Team at Files. A chat the
  person can't open is a 404 and the first chat opens; with none named, the chat opens on the first chat in the
  list's order and keeps it while news reorders the list. A Public chat the person isn't in opens to read, with
  "You're reading a public chat you're not in. Join it to write here." and Join, and isn't listed.
- The chat's header (`MercbotChatPanel.vue`) shows its title, "Public" or "Private" with its members, "Add people or
  bots" (not in a direct chat) and Chat details (i); an archived chat says "This chat is archived, so it's
  read-only." with Unarchive for whoever may. The composer's + offers Attach files and, in a chat with one bot,
  "Teach <Bot> a task"; "/" picks skills in a chat with one bot, "@" mentions in a chat of several.
- The details panel shows Chat details (`genesis/program/bots/chats.md`) or, for a direct chat's bot and on Team, the
  member's card (`genesis/program/bots/team.md`) with the bot's live avatar, an in-place editable name and its
  template's tag (`MercbotTemplateTag.vue`, a button to its Instructions), and Details, Files, Library and Computer
  tabs; the chosen tab is saved on the device. Ctrl+Alt+B opens it; Escape closes it when nothing else is open. Its
  top shows, for a bot, the actions a copy built on Mercbot adds there (`extensions.js` `botActions`), before Close;
  Mercbot adds none.
- The Library tab gives each row its age ("now", "5m", "3h", "4d",
  "2w", "1y") and a hover card: what it is, its name, the bot, when it was made
  and, for a page, who can open it (`pageAccess`, from its folder: this chat's, the bot's or the home's).
  "…" or a right-click opens its menu: Pin or Unpin, and for
  a page Open, Share… (who can open it, with Copy text and Download) and Delete,
  which asks first in the app's own dialog.
- Instructions come first on the Details tab (`useBotInstructions.js`, D-98):
  "This bot is a <tag> bot, plus its own additions.", the template's box
  (read-only with a lock: its source, Tested day, the newest change, its
  instructions with Show all, its skills, and Change template, which opens
  `MercbotChangeTemplateDialog.vue`: the home's templates and Mercbot's in the
  template browser, then a confirm with the template in full and the additions
  that stay; Escape goes back), then the Additions box: its maker and the
  home's owners and admins select it to edit in a text box
  with Cancel and Save (pills, as Settings' forms); a refusal shows under the box
  in the server's words, and a note says who
  can change them. They're read again as the bot's activity changes, so an
  approved change card shows there too. An approval card that carries a
  `change` shows it as Before and After.
- A bot's routines sit as rows in one bordered box on its card's Details tab, each naming its chat,
  with an on/off switch (`genesis/program/bots/routines.md`). A click only highlights a row; right-click offers Pause
  or Resume, Edit (puts `Edit your routine "<name>": ` in the composer and
  focuses it) and Delete (after a confirmation). Right-click menus and delete
  confirmations share one menu and one dialog component with the chat list.
- The shell listens to `/api/w/:workspaceSlug/bot-events` (`useChatEvents.js`): a bot's work plays its avatar's
  moods on the chat's row and its new messages are read in, marking the chat unread unless it is open. A `messages`
  notice reads that chat's row again and, if its messages are loaded, only what changed since its cursor; a `chat`
  notice reads the chat again or, when it's gone for the person, takes it off the list (and opens the first chat
  if it was the one shown); after a reconnect
  the list and every loaded chat catch up the same way. A chat opens on its
  newest 100 messages; scrolling within 600 px of the top reads the page before
  and puts it above, keeping the reader on the message they were reading. A
  chat's read that arrives late (a message was sent while the chat loaded) keeps
  what the page added meanwhile after the messages it read: the message, its
  reply, or "Couldn't get a reply." with Try again. A
  catch-up leaves a changed message older than the loaded pages for its page to
  bring. Find in chat searches the loaded pages on the page and counts the
  matches further back on the server (`GET …/chats/:chatId/find`); the counter
  covers both, and going to a match further back brings the pages down to it,
  as a message chosen in the search palette does. Opening an unread chat
  puts the "new" divider above the first message after the person's `readUpTo`, for that
  visit.
- The search palette opens with Ctrl+K (which also closes
  it), Ctrl+Shift+F or the sidebar's search button, with no motion and nothing
  remembered. It's a fixed 560×453 panel at 20% from the top over a 50% scrim.
  Empty, it lists the person's chats, then commands: Add bots, New chat, Team,
  Keyboard shortcuts, Settings: <section>, Connect Apps, Skills, and Theme: System, Light or Dark (ticked, applied
  at once and saved to the account). Typing matches loosely, letters in order,
  ranking by where the first letter falls, and lists chats (by name or who's in them), the home's bots (by name or
  template tag; opens the direct chat) and people (with their role), apps (by name or description; opens the app's
  page), hidden and archived chats, commands, routines, made files and up to 5 messages from
  `GET …/search` (each in its chat: "In <chat> · <when>"; opens the chat with the message at the top, ringed;
  `genesis/program/bots/chats.md`). Contiguous
  runs are bold; five placeholder rows show while only messages are pending, then
  results or "No results". Up and Down stop at the ends.


Composer skill picker: in a chat with one bot, "/" at the start of the composer opens
up to five skills (book icon, name, grey description; one- or two-letter queries match anywhere,
longer ones the start of the name). Arrow keys, Enter or Tab choose; the chosen skill becomes a
`/Name` token in the bot's colour that is deleted as one unit. The Settings dialog has a Files section (D-26).

## Proved by

- `tests/e2e/startup.spec.ts`
- `tests/e2e/instructions.spec.ts`
- `tests/client/chatList.vitest.js`
- `tests/client/chatDirectory.vitest.js`
- `tests/client/chatNews.vitest.js`
- `tests/client/chatPages.vitest.js`
- `tests/client/mercbotShell.vitest.js`
- `tests/client/shellParts.vitest.js`
- `tests/client/shellChat.vitest.js`
- `tests/e2e/shell.spec.ts`
