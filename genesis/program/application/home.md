# Private home

This boundary gives a signed-in person a responsive starting point and access
to account controls.

## Sources

- `src/pages/index.vue`
- `src/pages/w/[workspaceSlug].vue`
- `src/pages/w/[workspaceSlug]/index.vue`
- `src/components/mercbot/MercbotHomeSwitcher.vue`
- Main: `src/components/mercbot/MercbotShell.vue`
- `src/components/mercbot/useChatMessages.js`
- `src/components/mercbot/useChatWork.js`
- `src/components/mercbot/useChatEvents.js`
- `src/components/mercbot/useDrafts.js`
- `src/components/mercbot/useOnboarding.js`
- `src/components/mercbot/useChatActions.js`
- `src/components/mercbot/useNewBot.js`
- `src/components/mercbot/usePaletteRunner.js`
- `src/components/mercbot/composerPlaceholder.js`
- `src/components/mercbot/chatView.js`
- `src/components/mercbot/messageAuthors.js`
- `src/components/mercbot/MercbotIntro.vue`
- `src/components/mercbot/MercbotChatPanel.vue`
- `src/components/mercbot/useComposerTokens.js`
- `src/components/mercbot/useComposerLines.js`
- `src/components/mercbot/useComposerKeys.js`
- `src/components/mercbot/useComposerFiles.js`
- `src/components/mercbot/useChatScroll.js`
- `src/components/mercbot/useSelectionPill.js`
- `src/components/mercbot/useDictation.js`
- `src/components/mercbot/useFindInChat.js`
- `src/components/mercbot/MercbotCallBar.vue`
- `src/components/mercbot/voice.js`
- `src/components/mercbot/MercbotTimeline.vue`
- `src/components/mercbot/messageMenus.js`
- `src/components/mercbot/MercbotAvatar.vue`
- `src/components/mercbot/richText.js`
- `src/components/mercbot/MercbotNewBotDialog.vue`
- `src/components/mercbot/avatarShapes.js`
- `src/theme/palettes.js`
- `src/components/mercbot/shellChat.js`
- `src/components/mercbot/MercbotSearchPalette.vue`
- `src/components/mercbot/paletteEntries.js`
- `src/components/mercbot/botsApi.js`
- `src/placement.js`
- `src/placementTopology.js`

## Public contract

Mercbot has no sign-in page and no signed-out front page (`genesis/program/authentication/accounts.md`): its key opens
it and signs its one person in (D-81). A copy built on Mercbot that has people sign in replaces `/` with its own page.
The shell itself is private. It shows one
home at a time at `/w/<home>`; `/` opens the home used last (else the first),
and a home the person doesn't belong to shows a not-yours card. The home layout joins JSKIT's navigation
trail (D-64): its inner pages (Apps, an app, a table, Files) declare their parent in route meta and show
shell-web's Up arrow first in their own top bar, which an app makes its close (D-106,
`genesis/program/apps/screens.md`), and the chat, the home's top-level page, has none. Ctrl+[ does what the arrow does,
or a page's close (`useShellPageClose`) where it has one, as an app's.
In-app links are resolved by `usePaths().page()`. The switcher at
the top of the sidebar lists the person's homes with their role, and Create a home opens New home
(`MercbotNewHomeDialog.vue`): only its name (D-109), and it opens on the person's welcome chat there. A person with
no chats in a home sees the intro slides and a short transition while their welcome chat is made
(`genesis/program/bots/onboarding.md`); everyone else lands in the Mercbot shell on their chats. The client waits
each onboarding step's delay, then asks the server to advance; a reload resumes at the pending step.

The chat shows rich bot replies (markdown with raw HTML disabled), accent
user bubbles, timestamps after 20-minute gaps, a "new" divider above unread
messages, routine event lines, a "Learn from demonstration" chip on the
taught-task message, skill links that open the skill in Connect apps, and in
a chat of several people or bots (`messageAuthors.js`) the person's own messages on the right and everyone else's on
the left, each run of one author's bubbles with their name above the first and their face (a bot's) or initials (a
person's) beside the last, the name they wrote under once they've left (R2), mention tokens, a status line showing
the working bots, and an @ menu (everyone, the chat's other people, its bots, apps; D-114) whose choices stay
in the message box as one-piece tokens, reactions, hover actions (react,
reply, more) beside the bubble at every width, so nothing but "Not sent." ever
takes a line under a message, right-click menus (on a message Reply, Copy and Copy request ID,
under a row of six reactions on a bot's or another person's; on a picture or chart Copy image, as PNG, and Save
image; a link or selected text keeps the browser's own menu; each menu takes the keyboard as it
opens, holding an arrow typed before it shows for its first or last row, and gives focus back as it closes), a growing composer with attachments and quote tokens (its lines counted again as its text or its laid-out width changes, and once more as it moves above its buttons or back, `useComposerLines.js`), find in chat
with highlights, an add-to-chat pill for selections, and a microphone error
popover. Scrolled up, the chat stays where it is as messages arrive: the
round scroll-down button turns into an "N new messages" pill counting what came after the
last message the reader had (not their own messages or time stamps); the pill goes down to
the newest, its × dismisses it, and sending always goes down. While a bot works, a status line describes the work and the bot's
avatar changes expression (attention, thinking, working, concentrating, happy). In a chat with several people, where
a bot may stay quiet (R3, D-129), the sender's page shows a bot working only once the server says it started
(`useChatWork.js` `requestReply` `untilStarted`, `workStarted`). Everyone else in the chat sees it too (`working`
events, `useChatEvents.js` `onWorking`): "Thinking it over" with the working bots' faces until the last of them stops,
leaving the asker's own wording and a status a bot names as they are. Under the composer a line says who can read the chat
(`chatView.js` `readersLine`): "Everyone in <home> can read this · Chef remembers it" in a Public chat, naming its
bots, which remember it (D-113; "Chef, Ada and 2 more remember it" past three, no second part with no bots; "Everyone
can read this" on a phone), "Only <names> can read this" in a Private one ("Only this chat's members
can read this" past four); a direct chat is Private, its line naming the two of them. The first time a person is in a
Public room a notice says "This room is public. …" ("… For something only some of you should see, start a private
room.") with Got it. While a question card waits for the person looking, the composer's placeholder invites an answer.
Avatars (D-44) are clouds, never balls, each shape with its own kind of manga
eyes; the cloud never moves and the eyes never blink: only the irises glance
around inside them. The home's Builder alone wears a propeller beanie. The
favicon, Mercbot's logo, is its own orange cloud.

Add bots (D-109, which was New bot) opens from the sidebar's Bots + ("Add bots"), Ctrl+Alt+N or the search
palette, or from a template's link (`?template=`, with that template chosen): Describe what you need (Suggested bots,
Bot templates), or choose yourself, One bot or A ready-made set. One bot asks "What will it do?" (the General
helper, the home's templates, Mercbot's library with an Area menu, and Describe the bot you need when nothing fits;
D-98), a chosen template shown whole, then a live preview, a name, 28 clouds plus Mercbot's own
fixed-orange cloud and the 11-colour palette (random on open, preferring a
colour and cloud no bot in the home has; a library template's own to start). One bot joins the home and opens the
person's direct chat with it, where it has said hello; a ready-made set or Suggested bots join the home, under Bots,
and make no chats (`useNewBot.js`). Question cards can be multi-select with
Done; picks take the bot's colour (blue for black bots).

Voice uses the browser's own speech
recognition (Chrome, Edge and Safari; they may send audio to the browser's speech
service) and speech synthesis; there's no server speech service.
- **Dictation:** clicking the mic, or pressing Ctrl+D, toggles listening. Holding
  either one talks until release. While listening, the mic is red and the heard
  words appear live in the message box, after any text already there.
- **Voice conversation (a direct chat only, `useDictation.js` `canCall`):** the call bar appears under the header
  chip. It connects by checking the microphone chosen in Settings, then takes turns:
  - it listens until you stop speaking, then sends what you said as an ordinary
    message;
  - it shows "thinking" until the reply arrives, then reads the reply aloud (tapping
    the avatar interrupts) and listens again.
- **Call bar controls:** captions show the words, mute pauses listening, and the gear
  picks the voice and speed (kept on the device).
- **Ending:** posts a "Voice conversation" event line with the duration
  (`POST /api/w/:workspaceSlug/chats/:chatId/bots/:botId/voice-call`).
- **Errors:** a missing, refused or unsupported microphone shows a popover saying so.
  The call bar stays in its connecting state for about 0.75s first.

## Proved by

- `tests/e2e/help.spec.ts`
- `tests/e2e/new-bot.spec.ts`
- `tests/client/finalSweep.vitest.js`
- `tests/e2e/final-sweep.spec.ts`
- `tests/client/chatTimeline.vitest.js`
- `tests/client/chatComposer.vitest.js`
