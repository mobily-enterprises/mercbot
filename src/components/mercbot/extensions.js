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
// - accountMenu: items of the account menu, each { title, icon, place, run }: `place` "menu" puts it in the menu, before
//   Help and support; "support" in Help and support, after Mercbot's own items; "foot" at the menu's foot, after
//   Settings. Choosing it closes the menu and calls `run()`.
// - generalActions: buttons beside Account details in Settings → General, each { title, confirm, run }: pressing it
//   calls `run()`, once the person has confirmed when `confirm` ({ title, label }) says what to ask.
// - shellParts: components the app's shell shows, each { component, place }. Without a `place`, beside its own dialogs:
//   each gets the open `bot` (or null) and the shell's `notify` (a short confirmation) and `failure` (a message, then its
//   cause) listeners, and may use the chat (shellChat.js), whose holdKeys keeps the shell's shortcuts waiting while
//   the part's dialog is open. With `place` "notice", above the open conversation's composer: each gets `pulse`, the
//   open conversation's message count, which changes as its messages come, and may emit `open-settings` with a
//   Settings section's `value` to open it.
// - helpPageTools: tools after a help page's own (Copy for AI, Plain text), each { component }; it gets the `page`,
//   { slug, title, group }.
// - aboutUpdates: what Settings → About says about keeping this copy up to date, in place of Mercbot's own line, or null
//   for Mercbot's own.
// - appParts: parts shown at the end of an app's Overview (behind an app), each { component, visible }. The panel asks
//   `visible` once when it opens; the component gets the app as `loaded` and the home's slug as `home`, and may emit
//   "failed" (a message for the snackbar) and "narrowed" (a new live version), which the panel passes on.
// - pageShareParts: parts shown in a web page's Share, under who in the home can open it, each { component, visible }.
//   The Share asks `visible` each time it opens; the component gets the page's `botId` and `path` and may emit `copied`
//   with a short confirmation to show.
// - botActions: actions at the top of a bot's Details panel, before its Close button, each { component }; not shown for
//   a group. The component gets the `bot` as the list shows it, and may use the chat (shellChat.js).
// - messageCards: cards for kinds of message Mercbot doesn't show itself, each { kind, component }. The component gets
//   the `message` and the `bot` whose chat shows it, and may use the chat (shellChat.js).
export default {
  settingsSections: [],
  templateParts: [],
  accountMenu: [],
  generalActions: [],
  shellParts: [],
  helpPageTools: [],
  aboutUpdates: null,
  appParts: [],
  pageShareParts: [],
  botActions: [],
  messageCards: []
};
