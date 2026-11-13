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
- `src/components/mercbot/MercbotBotList.vue`
- `src/components/mercbot/botMenus.js`
- `src/components/mercbot/useBotDrag.js`
- `src/components/mercbot/botDirectory.js`
- `src/components/mercbot/MercbotDetailsPanel.vue`
- `src/components/mercbot/useGroupMembers.js`
- `src/components/mercbot/useBotLibrary.js`
- `src/components/mercbot/MercbotPageShare.vue`
- `src/components/mercbot/useBotNotebook.js`
- `src/components/mercbot/useBotRoutines.js`
- `src/components/mercbot/MercbotContextMenu.vue`
- `src/components/mercbot/MercbotConfirmDialog.vue`
- `src/components/mercbot/MercbotGroupPicker.vue`
- `src/components/mercbot/useGroupPicker.js`
- `src/components/mercbot/MercbotGroupAvatar.vue`
- `src/components/mercbot/shellInitials.js`
- `src/components/mercbot/MercbotConvoAvatar.vue`
- `src/components/mercbot/shellGeometry.js`
- `src/components/mercbot/shellPreferences.js`
- `src/components/mercbot/shortcuts.js`
- `index.html`
- `tests/e2e/startup.spec.ts`
- `src/placement.js`
- `src/placementTopology.js`
- `config/public.js`
- `src/main.js`
- `src/browser.js`
- `src/types.js`
- `packages/main/src/client/providers/MainClientProvider.js`

## Public contract

**Phones** (below 600 px):
- The chat fills the screen. The bot list is a drawer, opened from the menu button at the top
  left (a dot marks news in another bot); choosing a bot closes it.
- The bot's details cover the chat.
- Settings and Connect apps fill the screen. Settings shows one section with **All settings**
  to the list; Connect apps shows one column of apps.
- From 600 px up, the desktop layout applies (rail below 704 px).

- The initial document shows loading and Reload before JavaScript is available.
  Successful mounting replaces it; initialization failure retains a retry explanation.
- The `home` surface uses the app-owned Mercbot shell: sidebar or compact
  rail, chat panel and Details panel, with per-device layout choices (compact,
  widths, Details open, accent). Other surfaces keep the JSKIT shell.
- The account menu offers Settings (the account page); a copy built on Mercbot adds its own entries, such as Sign
  out (`extensions.js` `accountMenu`).
- The sidebar footer shows the account's name and a square
  Connect apps button at rest; while hovered, the avatar alone and a wide
  Connect apps pill with app icons. The account button's avatar, there and in
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
- The sidebar bot list shows pinned tiles, then rows grouped by section
  (or flat), then Hidden bots; rows sort by latest activity. Position hints, Go
  to bot, previous/next and Switch bots follow that visual order. Drafts are kept
  per bot on the device. The chat shows the bot named in the address
  (`?bot=<id>`), which choosing a bot always sets (a new bot too, once it
  exists); choosing the bot already shown names it in place, adding no history
  entry. With none named, the chat opens on the first bot in that order and keeps
  it while other bots' news reorders the list, and Back to that address shows it
  again. New bot's placeholder
  row never opens, so nothing asks the server about a bot that doesn't exist yet,
  and the new bot joins the list even when news reads the list again meanwhile.
- The Details panel shows the bot's live avatar, an in-place editable name
  and label, and Details, Library and Computer tabs; the chosen tab is shared
  across bots and saved on the device. Escape closes it when nothing else is
  open. Its top shows, for a bot, the actions a copy built on Mercbot adds there
  (`extensions.js` `botActions`), before Close; Mercbot adds none.
- The Library tab gives each row its age ("now", "5m", "3h", "4d",
  "2w", "1y") and a hover card: what it is, its name, the bot, when it was made
  and, for a page, who can open it (`pageAccess`, from its folder: Just me, the
  bot's or the home's). "…" or a right-click opens its menu: Pin or Unpin, and for
  a page Open, Share… (who can open it, with Copy text and Download) and Delete,
  which asks first in the app's own dialog.
- Routines sit as rows in one bordered box on the Details tab, each
  with an on/off switch. A click only highlights a row; right-click offers Pause
  or Resume, Edit (puts `Edit your routine "<name>": ` in the composer and
  focuses it) and Delete (after a confirmation). Right-click menus and delete
  confirmations share one menu and one dialog component with the bot list.
- Group chats: New group chat in the palette or Ctrl+Alt+G turns the chat
  panel into a recipient picker (chips, filtered suggestions with Up, Down and Enter,
  a create-a-bot offer that opens that bot's own chat, Backspace, Escape twice, at
  most 6 bots, Enter with no text starts an empty group). While picking, one bot
  lends its colour and the placeholder names the picked bots. A group shows a cluster
  avatar of the person's initials and its bots in rows, tiles, the chip (with the
  bot's name as a tag when it has one bot), Details and the palette. Its menus say
  Rename chat; Mark as unread turns into Mark as read when there's something unread.
  Deleting a group opens the main bot. Group Details has Details, Library and
  Members tabs; Members adds bots from a searchable list and removes them after a
  confirmation, and the last bot's Remove is faded and does nothing.
- The shell listens to `/api/bot-events`: a routine run plays the bot's avatar
  moods in the sidebar and its new messages are read in, marking it unread
  unless it is open. A `messages` notice reads that bot's row again and, if its
  messages are loaded, only what changed since its cursor; after a reconnect
  the list and every loaded chat catch up the same way. A chat opens on its
  newest 100 messages; scrolling within 600 px of the top reads the page before
  and puts it above, keeping the reader on the message they were reading. A
  chat's read that arrives late (a message was sent while the chat loaded) keeps
  what the page added meanwhile after the messages it read: the message, its
  reply, or "Couldn't get a reply." with Try again. A
  catch-up leaves a changed message older than the loaded pages for its page to
  bring. Find in chat searches the loaded pages on the page and counts the
  matches further back on the server (`GET /api/bots/:botId/find`); the counter
  covers both, and going to a match further back brings the pages down to it,
  as a message chosen in the search palette does. Opening an unread bot
  puts the "new" divider above the first message after its `readUpTo`, for that
  visit.
- The search palette opens with Ctrl+K (which also closes
  it), Ctrl+Shift+F or the sidebar's search button, with no motion and nothing
  remembered. It's a fixed 560×453 panel at 20% from the top over a 50% scrim.
  Empty, it lists bots and groups (unread, then pinned in tile order, then by
  latest activity; hidden bots left out), then commands: New Bot, New group chat,
  Keyboard shortcuts, Members (in a group), Settings: Profile, Preferences, Bots
  and Notifications, Connect Apps, and Theme: System, Light or Dark (ticked, applied
  at once and saved to the account). Typing matches loosely, letters in order,
  ranking by where the first letter falls, and lists bots and groups (by name or
  label), apps (by name or description; opens the app's page), hidden bots (tagged),
  commands, routines (opens the bot with Details) and up to 5 messages from
  `GET /api/search` (opens the chat with the message at the top, ringed). Contiguous
  runs are bold; five placeholder rows show while only messages are pending, then
  results or "No results". Up and Down stop at the ends.


Composer skill picker: in a bot's own chat, "/" at the start of the composer opens
up to five skills (book icon, name, grey description; one- or two-letter queries match anywhere,
longer ones the start of the name). Arrow keys, Enter or Tab choose; the chosen skill becomes a
`/Name` token in the bot's colour that is deleted as one unit. In a group, @ also offers the
person's own skills. The Settings dialog has a Files section (D-26).
