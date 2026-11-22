# The welcome chat and a bot's first chat

A person's first visit to a home opens their welcome chat with the home's main bot, and every bot's first chat with a
person opens with its greeting (D-10, D-109, D-112). In a new home the main bot is made here and named by the person,
then asks what the home is for and whether anyone else will use it, which makes the home's everyone chat.

## Sources

- Main: `packages/bots/src/server/onboarding.js`
- `packages/bots/src/server/botWriting.js`
- `packages/bots/src/server/botTeams.js`
- `packages/bots/src/server/botList.js`
- `packages/bots/src/server/botCards.js`
- `packages/bots/src/server/botChat.js`
- `packages/bots/src/server/registerRoutes.js`
- `packages/bots/src/server/records/chatRepository.js`
- `src/components/mercbot/useOnboarding.js`
- `src/pages/w/[workspaceSlug]/index.vue`
- `src/components/mercbot/MercbotIntro.vue`
- `src/components/mercbot/useChatActions.js`

## Public contract

**The welcome chat** (`POST /api/w/:workspaceSlug/chats/welcome`, the page's first visit): the person's direct chat
with the home's main bot, Private and readable only from itself like every chat with a bot (D-117), made once (two first visits at once make one), answered as the
chat list shows it. In a home with no bot yet, the main bot comes with it ("Mercbot", colour `#1C1C1C`, on Mercbot's
general template) and the chat's script starts at `start`; in a home that has one, a newcomer is greeted at
`intro-greet`. The chat's `onboarding_step` names where the script is.

**The script** (`ONBOARDING_STEPS`): each step appends messages and names the next; the page waits the step's delay,
then asks `POST …/chats/:chatId/onboarding/advance {step}`, which runs only while the chat is still at that step
(another page may have moved it on). Each step's words come first, outside the transaction (a model call is never held
under the chat's lock), and a paused home (D-73) gets the steps' own words with no AI call.
- `start`: "Good to have you here, <first name>. From now on I'll be looking after things for you, at work and at
  home." and a name card ("First things first: pick a name for me. You're free to rename me any time.") with name
  ideas; `POST …/onboarding/name {name}` answers it (409 `bots_choice_closed` once it isn't open), then `confirm`
  ("<Name> it is. Nice to meet you properly, <first name>!") and `rename`, which renames the bot for everyone in the
  home with a "Renamed to <Name>" line.
- While the home has no bot but its main one, a `home-for` card: "What's this home for? I can suggest a few bots to
  help with it." with "Describe what I need", "Show me ready-made teams" and "Not now" ("You see them before anything
  is added, or just type to skip."). Answering it answers `addBots` (`describe`, `teams`, or null), which opens Add
  bots on the page (`useChatActions.js`); nothing is added until the person says so there, and the teams are never
  listed in the chat.
- For the home's owners and admins while it has no everyone chat, a `home-people` card: "Will anyone else use this
  home?" with "Just me" and "Me and other people" ("With other people, everyone in the home gets a chat together, with
  me in it."). "Me and other people" makes the home's everyone chat, Public, named after the home, with every active
  member and the main bot, pinned for each person (O9, `genesis/program/bots/chats.md`); "Just me" makes nothing.
- `about` ("A bit about how I work:" and the offer to connect email), `connect` (a Gmail Connect card) and, once the
  person has done nothing more, `await-nudge` ("Whenever you're ready, the Gmail card above is still there to
  connect.").
- Typing at a step waiting on a card (`ask-name`, `home-for`, `home-people`) passes the card over and moves on to
  `about`, without a rename, bots offered or the everyone chat; typing makes the Gmail nudge unneeded.

**A bot's first chat** with a person (a new bot's direct chat with its maker, a bot opened from the sidebar's Bots, the
main bot meeting someone new), Private like the welcome chat: `intro-greet` greets with its template's greeting, which starts its setup questions; a bot on
Mercbot's general template writes a greeting instead (falling back on "Hi <first name>, I'm <Bot>. Happy to get started
whenever you are."), then `intro-ask` posts a generated first question as a `first-task` card (single or several picks,
with "Something else"; falling back on "Where should I start helping?"). A first question is dropped once the person
has already asked for something.

**Bots added together** (a team, or Add bots' batch, D-105, D-109) are introduced in the person's welcome chat by the
main bot as one message, "Your team's here: <names>. Start a chat with one of them whenever you like.", with a Message
for each (`team`); they open no chats of their own.

**On the page** (`src/pages/w/[workspaceSlug]/index.vue`, `MercbotIntro.vue`, `useOnboarding.js`): a person's first
visit to a home with no chats yet makes their welcome chat, shows the intro slides, then opens the shell on it; opening
a chat at a step advances it after the step's delay, and an archived chat's steps wait until it's back in use.

## Proved by

- `tests/server/welcomeChat.integration.js`
- `tests/server/onboarding.test.js`
- `tests/server/firstUse.integration.js`
- `tests/client/welcomeAnswers.vitest.js`
- `tests/e2e/chats-first-run.spec.ts`
- `tests/e2e/new-home.spec.ts`
