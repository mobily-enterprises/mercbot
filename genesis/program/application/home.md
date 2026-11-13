# Private home

This boundary gives a signed-in person a responsive starting point and access
to account controls.

## Sources

- `src/pages/index.vue`
- `tests/e2e/help.spec.ts`
- `src/pages/w/[workspaceSlug].vue`
- `src/pages/w/[workspaceSlug]/index.vue`
- `src/components/mercbot/MercbotHomeSwitcher.vue`
- Main: `src/components/mercbot/MercbotShell.vue`
- `src/components/mercbot/useBotMessages.js`
- `src/components/mercbot/useBotWork.js`
- `src/components/mercbot/useBotEvents.js`
- `src/components/mercbot/useDrafts.js`
- `src/components/mercbot/useOnboarding.js`
- `src/components/mercbot/useChatActions.js`
- `src/components/mercbot/useNewBot.js`
- `tests/e2e/new-bot.spec.ts`
- `src/components/mercbot/usePaletteRunner.js`
- `src/components/mercbot/composerPlaceholder.js`
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
- `tests/client/finalSweep.vitest.js`
- `tests/e2e/final-sweep.spec.ts`

## Public contract

Mercbot has no sign-in page and no signed-out front page (`genesis/program/authentication/accounts.md`): its key opens
it and signs its one person in (D-81). A copy built on Mercbot that has people sign in replaces `/` with its own page.
The shell itself is private. It shows one
home at a time at `/w/<home>`; `/` opens the home used last (else the first),
and a home the person doesn't belong to shows a not-yours card. The home layout joins JSKIT's navigation
trail (D-64): its inner pages (Apps, an app, a table, Files) declare their parent in route meta and
show shell-web's Up arrow first in their own top bar, and the chat, the home's top-level page, has none.
In-app links are resolved by `usePaths().page()`. The switcher at
the top of the sidebar lists the person's homes with their role and creates a
new one by name. A person with
no bots sees the intro slides and a short transition while their first bot is
created; everyone else lands in the Mercbot shell on their bots and saved
conversations. The client waits each onboarding step's delay, then asks the
server to advance; a reload resumes at the pending step.

The chat shows rich bot replies (markdown with raw HTML disabled), accent
user bubbles, timestamps after 20-minute gaps, a "new" divider above unread
messages, routine event lines, a "Learn from demonstration" chip on the
taught-task message, skill links that open the skill in Connect apps, and in
groups near-black user bubbles (dark grey in dark theme), each bot's name above
its run and avatar beside its last bubble, mention tokens, a status line showing
the working bots, and an @ menu (everyone, member bots, apps) whose choices stay
in the message box as one-piece tokens, reactions, hover actions (react,
reply, more) beside the bubble at every width, so nothing but "Not sent." ever
takes a line under a message, right-click menus (on a message Reply, Copy and Copy request ID,
under a row of six reactions on a bot's; on a picture or chart Copy image, as PNG, and Save
image; a link or selected text keeps the browser's own menu; each menu takes the keyboard as it
opens, holding an arrow typed before it shows for its first or last row, and gives focus back as it closes), a growing composer with attachments and quote tokens, find in chat
with highlights, an add-to-chat pill for selections, and a microphone error
popover. Scrolled up, the chat stays where it is as messages arrive: the
round scroll-down button turns into an "N new messages" pill counting what came after the
last message the reader had (not their own messages or time stamps); the pill goes down to
the newest, its × dismisses it, and sending always goes down. While a bot works, a status line describes the work and the bot's
avatar changes expression (attention, thinking, working, concentrating, happy).
Avatars (D-44) are clouds, never balls, each shape with its own kind of manga
eyes; the cloud never moves and the eyes never blink: only the irises glance
around inside them. The home's Builder alone wears a propeller beanie. The
favicon, Mercbot's logo, is its own orange cloud.

New bot opens from the sidebar, the rail, Ctrl+Alt+N or the search
palette: a dialog with a live preview, a name, 28 clouds plus Mercbot's own
fixed-orange cloud and the 11-colour palette (random on open, preferring a
colour and cloud no bot in the home has). Creating shows a
placeholder row, then opens the new bot. Question cards can be multi-select with
Done; picks take the bot's colour (blue for black bots).

Voice uses the browser's own speech
recognition (Chrome, Edge and Safari; they may send audio to the browser's speech
service) and speech synthesis; there's no server speech service.
- **Dictation:** clicking the mic, or pressing Ctrl+D, toggles listening. Holding
  either one talks until release. While listening, the mic is red and the heard
  words appear live in the message box, after any text already there.
- **Voice conversation (1:1 chats only):** the call bar appears under the header
  chip. It connects by checking the microphone chosen in Settings, then takes turns:
  - it listens until you stop speaking, then sends what you said as an ordinary
    message;
  - it shows "thinking" until the reply arrives, then reads the reply aloud (tapping
    the avatar interrupts) and listens again.
- **Call bar controls:** captions show the words, mute pauses listening, and the gear
  picks the voice and speed (kept on the device).
- **Ending:** posts a "Voice conversation" event line with the duration
  (`POST /api/bots/:botId/voice-call`).
- **Errors:** a missing, refused or unsupported microphone shows a popover saying so.
  The call bar stays in its connecting state for about 0.75s first.

