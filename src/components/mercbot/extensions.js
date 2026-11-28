// What a copy built on Mercbot adds to screens Mercbot owns, each list empty here. Such a copy replaces this file whole.
// Every entry has the component that shows it, or what it does, and, when it isn't for everyone, `visible`: an async
// function answering whether the person sees it. Its screen asks it as below; a failed answer hides the entry until the
// next time.
// - settingsSections: Settings sections, each { value, title, icon, component, visible, after }. One whose `value` is
//   one of Mercbot's own sections takes that section's place (Mercbot's own shows while it's hidden); the others are
//   listed right after the section `after` names, else after Mercbot's own. Settings asks each section's `visible` once,
//   the first time it opens. The section's component gets the `failure` and `notify` listeners Mercbot's own sections
//   get.
// - templateParts: parts shown on a team template's page, under its badge, to someone signed in, each
//   { component, visible }. The page asks `visible` once per template; the component gets the `template`.
// - accountMenu: items of the account menu, each { title, icon, place, run, visible }: `place` "menu" puts it in the
//   menu, before Help and support; "support" in Help and support, after Mercbot's own items; "foot" at the menu's foot,
//   after Settings. Choosing it closes the menu and calls `run()`. The menu asks `visible` once, the first time it opens.
// - generalActions: buttons beside Account details in Settings → General, each { title, confirm, run }: pressing it
//   calls `run()`, once the person has confirmed when `confirm` ({ title, label }) says what to ask.
// - shellParts: components the app's shell shows, each { component, place }. Without a `place`, beside its own dialogs:
//   each gets the open `chat` (or null) and the shell's `notify` (a short confirmation) and `failure` (a message, then its
//   cause) listeners, and may use the chat (shellChat.js), whose holdKeys keeps the shell's shortcuts waiting while
//   the part's dialog is open. With `place` "notice", above the open chat's composer: each gets `pulse`, the open
//   chat's message count, which changes as its messages come, and may emit `open-settings` with a Settings section's
//   `value` to open it.
// - beforeShell: reads a home's page waits for before it shows the shell, each an async function, started with the
//   home's chats and waited for with them, its loading surface staying meanwhile (shellChat.js beforeShell), so a shell
//   part can know what to show from its first frame. The home is the page's (homeApi.js currentHome()); a read that
//   fails doesn't hold the shell.
// - helpPageTools: tools after a help page's own (Copy for AI, Plain text), each { component }; it gets the `page`,
//   { slug, title, group }.
// - aboutUpdates: what Settings → About says about keeping this copy up to date, in place of Mercbot's own line, or null
//   for Mercbot's own.
// - appParts: parts shown at the end of an app's Overview (behind an app), each { component, visible }. The panel asks
//   `visible` once when it opens; the component gets the app as `loaded` and the home's slug as `home`, and may emit
//   "failed" (a message for the snackbar) and "narrowed" (a new live version), which the panel passes on.
// - pageShareParts: parts shown in a web page's Share, under who in the home can open it, each { component, visible }.
//   The Share asks `visible` each time it opens; the component gets the page's `botId`, `chatId` (the chat whose page it
//   is, or null) and `path` and may emit `copied` with a short confirmation to show.
// - botActions: actions at the top of a bot's card (in a direct chat's details, and beside any chat), each
//   { component }. The component gets the `bot` as the home has it, and may use the chat (shellChat.js).
// - messageCards: cards for kinds of message Mercbot doesn't show itself, each { kind, component }. The component gets
//   the `message` and the `chat` that shows it, and may use the chat (shellChat.js).
// - introSlides: whether a person's first visit to their first home shows Mercbot's intro slides before the shell
//   (true), or goes straight to the shell (false), for a copy whose own first-run screens take their place (D-142).
// - peopleActions: the People section's + in the sidebar, at most one, { component, visible }. The shell asks
//   `visible` once when the sidebar opens; the component gets `homeName` and renders the + itself, with its own dialog
//   (the + is `<v-btn icon="$add" variant="text" size="small" density="comfortable" aria-label="...">`, as Rooms' and
//   Bots' are). Without one, People has no +.
export default {
  settingsSections: [],
  templateParts: [],
  accountMenu: [],
  generalActions: [],
  shellParts: [],
  beforeShell: [],
  helpPageTools: [],
  aboutUpdates: null,
  appParts: [],
  pageShareParts: [],
  botActions: [],
  messageCards: [],
  peopleActions: [],
  introSlides: true
};
