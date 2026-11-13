# Decisions

Mercbot's design decisions, newest last, each with its date. Code and documents cite them as D-N. Numbers are
stable: a decision that later changes says so where it changes, and a missing number is not part of this
repository's product. Add every new decision here.

## D-1 — Mercbot is a web app (2026-10-24)

Mercbot runs in the browser, not as a desktop app:

- Don't draw window controls (minimise, maximise, close), and don't reserve
  space for them.
- The desktop layout has a narrowest width it is designed for (512 px; phones
  have their own layout since D-38).
- Leave zoom and full screen to the browser.

## D-2 — Browser-reserved shortcuts (2026-10-24)

Where the browser won't let a page use a shortcut (for example Ctrl+N,
Ctrl+Shift+N, Ctrl+Shift+W, Ctrl+Tab), Mercbot uses its own replacement, and
the shortcuts sheet shows the real keys.

## D-5 — Built directly, committed regularly (2026-10-24)

Changes are built directly, without a saved plan waiting for approval first, and
committed regularly.

## D-6 — Architecture brief (2026-10-24)

Mercbot's technical and architectural decisions (product definition, stack,
architecture, rules, milestones, licensing) are in
[architecture.md](architecture.md), the architecture source `AGENTS.md` refers to.

## D-8 — Real bots and chats from the start (2026-10-24)

The first slice saves bots and conversations in PostgreSQL, and anything the
person types gets a real reply from the model (D-6), never a canned one.

## D-10 — Scripted onboarding (2026-10-24)

The first-run conversation uses fixed text we write, on fixed timings, so it's
reliable and testable. The model answers only what the person types.

## D-11 — The bot's computer uses Vibe64's Chrome on our own Xvfb (2026-10-24)

For now, use the Chrome that Vibe64 already has on the host; don't download a
browser. `puppeteer-core` is the dependency (it never downloads one). Chrome is
found at startup with the glob
`/opt/vibe64/runtime-packs/playwright/browsers/chromium-*/chrome-linux64/chrome`
(never hardcode the version), and `MERCBOT_CHROME` overrides the path so a
project-owned Chrome can replace it later without code changes. Chrome runs
headful (`headless: false`) on our own Xvfb display, one per bot computer:
`Xvfb :N -screen 0 1280x800x24` with `DISPLAY=:N`. Stagehand can connect over
CDP. If Chrome or Xvfb fails to start, report the exact error and don't work
around it. *Since D-68 a computer's browser is the toolbox's Chrome in gVisor.*

## D-12 — Stagehand launches the bot's Chrome (2026-10-24)

Amends D-11. Stagehand 4.3 couldn't attach over CDP to a Chrome we had already
started ("Stagehand initialization timed out after 60000ms"; its extension page
never finished starting). So Stagehand launches the Chrome itself:
`executablePath` from the D-11 lookup, `headless: false`, `--display=:N` on our
own Xvfb, and a fixed debugging port that we attach to for the live stream and
the person's input. Everything else in D-11 stands.

## D-13 — Each bot's computer is a small desktop shown over VNC (2026-10-24)

Builds on D-11 and D-12.

1. Stagehand launches the Chrome (path from the `chromium-*` glob, overridable
   with `MERCBOT_CHROME`), headful.
2. Each bot's computer is a small desktop: its own Xvfb display, a light window
   manager (openbox) and the Chrome Stagehand launches on it. The live view and
   the thumbnail stream the whole display over VNC (x11vnc on that display,
   shown in the page with noVNC), so tabs, address bar and windows are visible.
   Take control sends the person's mouse and keyboard through the same VNC
   connection. Stagehand stays for the bot's own browsing, and the design must
   leave room for a later screenshot-and-click mode with a vision model.
3. Everything (Chrome's debugging port, VNC) binds to 127.0.0.1 only. Each
   computer picks its own free ports and display number when it starts, never
   fixed numbers, and keeps them in its own state.
4. When a computer sleeps, or Mercbot stops or restarts, its Chrome (through
   Stagehand), VNC, window manager and Xvfb all shut down.
5. If openbox or x11vnc is missing, stop and say so; don't work around it.

Sign-in: takeover in the bot's browser for sites without an app connection;
OAuth in the person's own browser for Connect apps.

## D-14 — State first: the server's state is the truth, not chat text (2026-10-24)

Cards, the waiting (amber) state and buttons are drawn only from server state.
The model only requests changes through tools; its words can't create, claim or
cancel anything. Every turn the model receives a "current state" note written by
the server (its computer, any pending hand-over or approval, its routines) and
treats it as the truth over earlier messages. Hand-over records and their cards
are written together. Real-model regression tests cover the hand-over cases.

## D-15 — Several servers behind a proxy (2026-10-24)

Mercbot installs as a standard Node application with a PostgreSQL database and
must run as several servers behind a proxy, like any other Node program. Servers
may have extra system software installed (Xvfb, openbox, x11vnc, Chrome), but the
server process itself must be ready for multiple servers by definition: shared
state lives in PostgreSQL, and no feature may assume a single process.

Order: routines are built multi-server safe from the start. The bot computer,
VNC tickets, live stream and screenshots are made multi-server safe straight
after.

Done after routines: each bot computer's owner, state, tickets and screenshots
are in PostgreSQL, and any server passes work and the VNC connection to the
owner.

Browser profiles no longer stay on one machine: see D-19.

## D-16 — The copy's own keys, no plans (2026-10-25)

Mercbot runs on the copy's own model provider keys. There are no plans, weekly
allowances, caps or credit to buy. Usage is still metered (architecture §3.8)
and shown with what it cost at the provider (D-73). The code keeps one small
module per provider.

## D-17 — The Vault stores passwords and card numbers (2026-10-25)

The Vault saves logins with their passwords and cards with their numbers and
security codes. Secrets are encrypted at rest with a key from the environment
(`MERCBOT_VAULT_KEY`), never stored in plain text and never shown back in full.

## D-18 — Features are designed here (2026-10-25)

From 2026-10-25 new features are designed from a description of what Mercbot
should do, written down in this repository (a design document in `docs/` where
one helps, and a decision here), and then built.

## D-19 — Workers are disposable (2026-10-25)

Any machine can be replaced at any time, as cloud platforms do, and the people using
Mercbot must lose nothing: at most they see a short wait. In particular, bots must
never lose their website sign-ins when a machine goes.
- A bot's browser profile is archived without caches, sealed with the vault key and
  kept in PostgreSQL whenever its computer sleeps or its server shuts down. While
  awake, its cookies are snapshotted every 30 seconds. Waking on any machine restores
  the newest of both and reopens the last page. *Since D-50 they're files on the
  shared volume, not database rows.*
- On SIGTERM a server drains: requests in progress finish, routine runs and
  background work get up to 20 seconds, every computer is saved, and live streams
  and screens close so pages reconnect to another server.
- Pages retry sends and replies that were cut off (about 15 seconds in all) without
  doubling them, and catch up after reconnecting.
- Servers find their own private address; `MERCBOT_SERVER_URL` overrides it.
- Later: JSKIT's file storage for profile pictures moves off the local disk. *Done
  2026-11-11: they're on the files volume with bots' files (`genesis/program/files/files.md`).*

## D-20 — Office apps on every server, bot files on JuiceFS (2026-10-25)

Bots get desktop office apps they can drive themselves: the ArtCraft apps WordCraft,
GridCraft, DeckCraft and PdfCraft (word processing, spreadsheets, slides, PDFs). Video
apps are left out for now. Every server has the same pinned versions, installed
without root by `scripts/install-tools.sh` into `.tools/`. The release tarballs are
used rather than AppImages, because they also carry each app's `-cli`, which is its
MCP server.
- Bots' files live on one shared JuiceFS volume: metadata in PostgreSQL (its own
  `juicefs` schema), data in object storage (a local folder in development). It is
  encrypted when formatted. The sealed key is kept in the volume's metadata, so a
  server needs only `MERCBOT_FILES_PASSPHRASE` to mount it. Each server mounts it
  once, and each bot has its own folder, used as the apps' home, so their settings
  and recovery files also survive a machine going away.
- Proof run on 2026-10-25: all four apps rendered on Xvfb with software Vulkan,
  were driven over MCP while visible, and saved into JuiceFS. The saved files
  survived a hard kill of the app and the mount, and a remount with an empty cache.
  WordCraft's AutoSave also kept an unsaved edit. GridCraft and DeckCraft have no
  AutoSave, so Mercbot saves after each agent turn. Each app uses about 180 MB.

## D-21 — Bot files can be private or shared (2026-10-25)

A person's files can belong to one bot only, or be shared with all of that person's
bots; there is a choice between the two.

How it was built (2026-10-25). Bots use the apps without a window: each reply starts the
apps it needs inside a bubblewrap sandbox with no network that sees only the bot's own folder
at /files/mine and the person's shared folder at /files/shared. Files a bot saves appear as
file cards under its reply. The viewer shows pictures of the pages, which every browser can
show, phones included, with a download. The bot moves a file between the two folders to share
it or make it private. Each server mounts the volume with `scripts/mount-files.sh`, and a
marker file tells the server the volume is really mounted. *Since D-47 there are three
folders, and since D-49 the apps run in gVisor.*

## D-22 — Installable as a normal npm application (2026-10-25)

Mercbot installs like any Node application: the person provides PostgreSQL and the
environment settings, and Mercbot's own scripts install everything else (the office apps,
JuiceFS, software rendering and the sandbox) with `npm run tools:install`, without root.
It must keep working well under JSKIT. Later it may also ship as ready-made executables,
which must be able to connect to a remote account; that design comes when it's needed.

## D-23 — A proper, Mac-like desktop on each bot's computer (2026-10-25)

The bot's computer is a little proper desktop that looks good and is Mac-like, with a
launcher. It has our own wallpaper, a translucent top bar with the open windows and a clock,
a centred dock (Browser, WordCraft, GridCraft, DeckCraft, PdfCraft), red, yellow and green
window buttons on the left, and apps that open maximised between the bars. People reach it
through the existing live view (Take control), and a file a bot made can be opened there from
the viewer with "Edit on computer". Apps run in the same sandbox as the bots' apps, so the
person sees exactly that bot's files and the shared ones. Bots still make files without a
window (D-20); the desktop is for the person. Not done: real transparency and window shadows
(a compositor made the apps' windows invisible), and custom button shapes (this openbox
ignores theme button pictures), so the buttons are coloured symbols.

## D-24 — Details always opens when asked for (2026-10-25)

Clicking the bot's name in a narrow window did nothing: the Details panel hides when the window
is too narrow to dock it. Now asking for it explicitly (the bot's name, Ctrl+Alt+B) in such a
window slides the panel over the chat, with a light scrim; clicking the scrim, Escape or its
close button closes it, and widening the window docks it. A docked panel that the window
narrows away still hides.

## D-25 — The bot's browser runs in a sandbox (2026-10-25)

A person in control of a bot's browser could open the server's own files with a file://
address, the app's `.env` with the database password and vault key included (checked: it was
readable). The browser now runs in a bubblewrap sandbox. It has the network, its display and
profile, its own /tmp, and the bot's own and shared files at /files/mine and /files/shared, where
downloads land. It sees none of Mercbot's folders and only the parts of /etc a browser needs.
Chrome's own sandbox still works inside. The desktop's Browser icon opens a window in that same
browser. A server that can't sandbox doesn't start bots' computers at all. Still open then: the
browser shared the server's network, so it could reach services on the server's own addresses.
*Since D-49 the browser runs in gVisor, and its only way out is Mercbot's gateway.*

## D-26 — File storage is pluggable; Google Drive uses one folder (2026-10-25)

Mercbot is free software and runs in different places, so where bots' files live is a choice:
a local folder for someone running it on their own computer, the shared volume for servers,
and the person's own Google Drive. With Google Drive the person's Drive is where the files
live, so Mercbot isn't the one keeping them. Mercbot may only see one folder in it, strictly:
the folder it creates. Design of the storage choice and the Drive connection came next.

How it was built (2026-10-25). Settings has a Files section: "On Mercbot", or "In your own
storage" with a WebDAV address (Nextcloud and most file services), username and password.
Mercbot checks the storage before saving the choice, seals it with the vault key and never
shows the password again. The person's storage is mounted with rclone (pinned and checksummed
by `npm run tools:install`) on whichever server needs it, with a Mercbot folder holding a
shared folder and one per bot, so the apps, the sandbox, the desktop and the viewer work as
before. A proof run against WebDAV found: saves must upload a second after the app closes the
file (uploading at once broke the apps' save-by-rename), and the queue must be empty before a
reply counts as done and before a server stops; with that, a hard kill lost nothing. Files
already made stayed where they were when the choice changed, until D-80 (2026-11-12): every
change now moves all of them. Google Drive plugs in here once there's a Google sign-in (D-27).
Built 2026-11-12: D-80.

## D-27 — Email for bots, and Google sign-in later (2026-10-25)

Bots' email starts with two ways: IMAP and SMTP with a password (an app password for Gmail),
which needs no Google project, and the Gmail API. Anything that signs in with Google (Drive,
the Gmail API) needs a Google Cloud project, which whoever runs a copy creates for it, or
borrows through a hub (D-31).

## D-28 — Logins the person gives may be typed; claims must be true (2026-10-25)

Bots never ask for passwords, card numbers or codes in the chat. When the person has already
given a login for a task in their message (such as a demo shop's published test login), the
bot may type it into that site's sign-in form; otherwise it hands the screen over. Each
browser step does one thing (one click, or typing into one field), so forms are filled field
by field. A bot only says it did something when a tool call in that reply did it: a reply that
claims a hand-over without the card is sent back once to do it or say otherwise. The proper
path for secrets, the secure form, came next (D-29).

## D-29 — Secure form and vault sign-ins (2026-10-25)

Bots sign in through a login given for the task, then a saved vault login, then a secure form,
then handing the screen over. Vault logins and secure-form values are typed into the bot's
page by Mercbot itself and never reach the model. A login submitted on the form is saved,
sealed, to the vault when the person leaves the box ticked. Between servers, the values travel
once over the private internal route to the server running the computer.

## D-30 — Whoever runs a copy configures it (2026-10-25)

The keys and developer accounts a copy uses (its AI keys, its registered apps) are set by whoever
runs it, in its settings; Mercbot ships none, and its screens never ask people for them. The data
model leaves room for several people per home, with roles (owners, admins, members) and bots
shared between them, as JSKIT's workspaces provide (D-36).

## D-31 — Connected accounts and the bridge (2026-10-25)

A copy registers one app per provider (Google, Microsoft, GitHub, later Slack and others) and
keeps its secret in the server's settings; the open-source code holds no secret. A copy without
registered apps can link to a hub, another Mercbot that has them (`MERCBOT_HUB_URL`; Settings →
Mercbot account, approved with a code on the hub), and borrow its apps through the bridge:
providers always send people back to the hub's address, the hub keeps the long-lived
permission, and the copy gets hourly keys and talks to the provider directly, so mail, calendars
and files don't pass through the hub. Unlinked copies can register their own apps or let bots
use the providers' websites. No provider credentials ship inside downloaded apps. Built on
oauth4webapi; everything is in PostgreSQL and sealed with the vault key. No default hub is built
in (D-35).

Who unlinks (2026-11-11): the person who linked a copy unlinks it from anywhere; the owners and
admins of a home that person is in unlink it from that home; once that person's account is gone,
the owners and admins of any home. Someone who only made a home of their own can't cut everyone
else off. Unlinking asks first, and the home's Activity trail records who did it.

## D-33 — Every useful app, in a set order, with a tested badge (2026-10-27)

Mercbot supports every app on its list (`docs/apps.md`), built tier by tier in that order. Each
app carries a badge: **b** (built, not hand-tested), **✓** (passed a five-minute hand test:
connect with a second account where possible, read, a small change asked for first and undone,
a broken connection reported honestly) and **★** (a week of normal use without problems). An app
is promoted only after that test. Descriptions are Mercbot's own; names and logos are each
company's, used under its brand rules.

## D-34 — How every app gets connected, Drive access, logos (2026-10-27)

Decided after researching how each app on the list connects:

- **A general connector for most apps, hand-written work for a few.** Most makers host their own
  connection point for AI assistants (MCP, with sign-in and often self-registration). Mercbot gets
  one general connector for those, plus a short per-app skill from the maker's documentation.
  Google, Microsoft and GitHub stay hand-written, and a few others may be when deeper behaviour is
  worth it. An app with neither an API nor such a connection is used through its website by the bot.
- **Full read access to Google Drive** (`drive.readonly`, beside `drive.file` for what Mercbot
  creates). Gmail reading already needs Google's yearly security assessment before a Google app
  leaves testing; Drive reading falls under the same assessment rather than a second one. Until
  then a Google app stays in testing: up to 100 test users added by hand, who see Google's
  "unverified app" warning. Permissions live in each app's `plugin.json`, so they can be narrowed
  or widened without rebuilding.
- **Logos from each maker's own site icon**, downloaded once and kept in the repository, used only
  to identify the app, where the open icon set has none.
- Keys are stored only through Env, never in chat or in the repository.

On 2026-11-11 the general connector was built with its first apps, the first in the tier-1 order whose
connection point lets Mercbot register itself: Calendly, Notion and Todoist (`docs/apps.md`). Each
copy registers itself once per app and signs people in directly, never through a hub; a bot reads an
app's actions and its skill before using it. Reading runs at once; a change asks first unless the
person asked for exactly that and the app marks it as harmless. An app without self-registration
uses an app whoever runs the copy registers, through Env. Each keeps **b** until its hand test.

## D-35 — Apps: mini-apps built by bots on one shared database (2026-10-27)

A feature designed here (D-18) on 2026-10-25 and 2026-10-27; the full design is in
[`docs/apps-design.md`](apps-design.md). A home gets internal mini-apps, and apps with public
screens, made entirely by bots, on one shared database (AnyAPI on PostgreSQL). One bot at a time
holds the Builder role and alone changes structure; every bot reads and writes records and may
set up its own watches; bots add freely, but removals need a person's approval. Nothing is ever
deleted, only marked obsolete, and every change is audited. Screens are JSON from a whitelisted
catalog wrapping Vuetify, with CEL formulas and fixed action steps — no CSS or JavaScript; scripts
are bot-written only (no editor) and run in a QuickJS sandbox in a worker with a watchdog. Every
app goes through Draft → Publish, and draft previews are read-only (since D-71 they work on
practice data instead). Apps refer to fields by id and adapt to data changes without migrations:
removing a field asks first, then removes it from every app in one restorable save, filter
conditions on it included, with a warning. All apps reach all tables; permissions stay simple and
never per field. The area is called **Apps** even though *Connect apps* uses the word for outside
services; the clash was accepted.

Second release (2026-10-29): charts use Chart.js through vue-chartjs; a button's task goes to the
bot's chat with the person who pressed it, and a watch's runs to the chat where it was set up.
Public screens read, list and edit records within per-table visitor rules (D-66); a copy built on
Mercbot that serves visitors adds their routes, sign-in and spam checks. Formulas gained today()
and now(), and a form's preset may use them.

Third stage (2026-10-29): permissions stay simple until real use shows what's needed (*since D-66
nothing inside a home is private*); themes apply to apps only, never Mercbot's own look; six
templates. Scripts must be **powerful**, not just "a button runs a script": buttons, data for
screens, rules on saving, functions in formulas, and jobs on a timetable or a watch, plus calls to
outside web services at addresses a home's owners allow (with secret headers). The Builder writes
them with **our own small coding loop**, and what scripts can do must sit in the Builder's
instructions, never dropped from a long chat: it decides by itself when a script is needed.
Mercbot is free software, so **no domain is built in**: one public address setting
(`APP_PUBLIC_URL`, replacing `MERCBOT_PUBLIC_URL`) and no default hub. Vite's dependency
pre-bundling must never reload a page mid-session.

## D-36 — Homes (2026-10-27)

Mercbot is built on JSKIT's workspaces (`@jskit-ai/workspaces-core`, `@jskit-ai/workspaces-web`).
A workspace is called a **home** in the product.

- A home holds its bots, routines, Apps, the bots' home notebooks, shared files, approval rules and
  usage. Roles follow JSKIT: owner, admin, member. On a person's own copy the home has its one
  person (D-81); the data model and the rules below allow several.
- Each person talks to a bot in **their own private conversation**, which still lives inside the
  home. There are no chats between people across homes.
- Personal to each person: their private conversations, what bots remember about them, their
  connected accounts (their Gmail stays theirs) and their password vault.
- **Three sharing modes per bot:**
  - **Private:** private conversations; the bot keeps nothing across people.
  - **Shared:** public conversations for the whole home, which people enter and leave; everyone
    sees everything, and the bot says so. Anyone can add a new public conversation forked from an
    existing one: it inherits that conversation's context up to the fork, and later messages in the
    original don't flow into it (2026-10-28).
    Each public conversation appears as its own **named tab** under the bot, and every tab must
    have a name. The bar for this screen is "the cleanest UI ever done".
  - **Mixed (the default):** private conversations plus a **home notebook**. After a
    conversation, the bot notes only reusable learning (no private details, secrets or
    third-party data) and tells the person in one line, so they can undo it. A person can keep a
    conversation out of the notebook. Everyone in the home can read the notebook; owners and
    admins tidy it. The bot never reads other people's conversations, only the notebook.
- **The bot's computer:** in private and mixed bots each person gets their own browser profile,
  so one person's sign-ins never appear in another's session; a shared bot has one browser, as
  the room is shared.
- Version 0.1 had no released accounts, so nothing needed migrating for real users.

## D-37 — AI keys and home-wide accounts (2026-10-28)

- **AI keys are the copy's.** They are set by whoever runs the copy (D-30, D-72), never per person
  or per home. Usage is counted per home (it's recorded with the home).
- **Connected accounts and app keys can belong to a person or to the whole home.** When
  connecting, the choice is **Just me** (the default) or **The whole home**.
  - Only the home's owners and admins connect or remove home accounts. Everyone in the home sees
    them listed.
  - In a person's own chats, a bot can use their own accounts and the home's.
  - In a shared bot's conversations, it uses only the home's, because everyone sees them.
  - Where several accounts fit (a person's Gmail and the family Gmail), the bot asks once and
    keeps to the answer in that chat, as it already does.

## D-38 — A phone layout (2026-10-28)

Mercbot has a proper phone layout, so the 512 px minimum (D-1) doesn't apply to phones. Below
600 px:
- the chat fills the screen;
- the bot list is a drawer opened from a menu button at the top left;
- the bot's details, Settings and Connect apps fill the screen, one thing at a time.

From 600 px up the desktop layout stays as it was.

## D-39 — The live screen stays on VNC (RFB) (2026-10-28)

The WebRTC video plan was cancelled: the bot's live screen and Take over keep the VNC-family
framebuffer protocol (RFB), x11vnc on the computer and noVNC in the page, with no relay server.
Among the trial's findings: Chrome's screen capture on Xvfb needs RandR off, which nothing
currently depends on.

## D-40 — Pages are sealed HTML pages any bot can write (2026-10-29)

Decided after discussing pages, apps and external apps (wording from now on: "app" is an internal
app the Builder makes, "external app" a connected outside service).

- A **page** is an HTML page a bot writes, like a piece of paper: content only (text, tabs, tables,
  timelines, checklists and so on). Any bot can make one, at once, with no Builder and no publishing.
- Pages always run sealed off from Mercbot (a sandboxed frame), so a page can never reach the person's
  account or data. Bots start from a Mercbot look. A small helper Mercbot provides keeps things like
  checklist ticks.
- **Pages hold content; apps hold behaviour and saved data.** For example, a bot writes a lesson as a
  page with its quiz questions embedded as data. A Quizzes app (from a template) runs the quiz on
  that data and keeps the scores. A page reaches an app only through one narrow doorway ("open this
  app with this data") that Mercbot checks.
- The chat card, the viewer and Share are built on this. Still open then: whether a quiz opens the
  app in its own view or shows inside the page, and the exact shape of the doorway (settled by D-74).

## D-41 — Bots' chats are compacted in the background (2026-10-30)

Real compaction, done properly, in the background. A reply reads the conversation's latest summary
and everything after it word for word, instead of only the last 60 model messages. When the part
since the summary grows too long, one server summarises all but the latest turns in the
background, folding in the previous summary; the reply never waits, and messages said meanwhile
stay as they are. Summaries are written recall first (goals and status, decisions, exact facts,
what the bot did and promised, open questions). The same change makes the history replay each
reply's tool calls and results, as D-14 intended (they had been dropped when the history was
loaded), with long results cut, and marks event lines as Mercbot's records. Mercbot's own code,
not JSKIT: chats and model calls live in the bots package. A generous recent stretch is kept word
for word and only the older part summarised: up to 20 recent turns within 40,000 tokens stay as
they are, and a summary is made once the unsummarised part passes 80,000 tokens.

The same day: the Builder keeps a separate conversation for each app. A shared Builder has one
room per app; Ask Builder in an app opens it, made fresh the first time. If the Builder isn't
shared, an owner or admin is asked once whether to make it so, only when it's truly necessary;
otherwise Ask Builder opens the person's own chat as before.

## D-42 — External apps get their full action lists, grouped into a few tools (2026-10-30)

For external apps' full action lists:
- **Grouped tools, a switch per action.** Each app area gets a few tools whose `action` picks
  one of several related actions, because one tool per action would pass the model's limit of
  128 tools. Every action is still its own row in Connect apps → Tools, and switching one off
  removes just that action from the bot.
- **Full Google Drive access.** Mercbot asks for full Drive access, so moving, renaming, copying,
  sharing and commenting work on any of the person's files, not only those Mercbot made.
  Everyone reconnects Drive once. It's a restricted Google scope, so Google's security review is
  needed before a Google app leaves testing.
- **Order:** mail first, then calendar, files, and code hosting (GitHub).
- Outward or destructive actions ask first, as everywhere.

Also 2026-10-30: the Builder must have absolute freedom to restyle apps so they look totally
different. This replaces "no CSS" for apps: each app may carry its own CSS (`style`), fenced to the
app's area and loading nothing from outside, with class names on any part. The Builder's own face
is a thinking one, to set it apart from the other bots.

## D-43 — Bot templates: a curated gallery, many templates of our own (2026-10-30)

- **The gallery is curated.** Only the Mercbot team adds entries, credited to the team or to
  creators the team invites. There's no "submit to the gallery" and no listing by users, because
  a template is AI instructions and an unvetted one could make a bot act harmfully on people's
  accounts.
- **Safeguards stay:** a template's page says who made the bot and that it may act on the
  person's behalf; the app shows a preview with its instructions and skills before Add bot;
  nothing is added until the person confirms.
- **Many templates, each done properly:** about 40–60 to start, aimed at families, small
  businesses and companies. Each has one clear job, a setup interview to learn the person's
  specifics, routines created paused until the person says yes, and nothing sent without asking.
  None carries a creator's personal details. Each is tested once end to end, with an honest badge
  for the untested ones, and they're re-tested when the app changes (D-79).
- **Credited to the Mercbot team** to start; outside creators may be invited later.
- Paired with an app (D-35) where it fits, such as a small-business CRM bot that sets up its app.
- Every template is written for Mercbot: its names, descriptions and instructions are our own.
- **Everything is shown before adding:** before Add bot, a template shows its full instructions,
  every skill with its full steps, the routines it will set up and the apps it will use. These
  are expanded, so nobody adds a bot without seeing what it will do. The note that someone else
  made it, and that it may act on the person's behalf, stays.
- **An added bot shows where it came from** (its creator and link) in its details, so a bot that
  misbehaves can be traced.

## D-44 — Every bot is a cloud with manga eyes, and the logo is Mercbot's orange cloud (2026-10-30)

The solid ball with two blinking eyes was too close to a competitor's trademarked look in the same
industry. This supersedes the single solid-colour round body with its gloss and blinking, the
fruit-like special shape, and every expression that moved the body or closed the eyes.
- **Every bot is a cloud**, and nothing is ever a ball: no round shape is offered, defaults to,
  falls back to or survives in the data. There are 14 clouds, grown from two first designs, a
  domed cumulus and a four-puff cloud, and pushed far apart: cumulus, four-puff, long flat,
  towering, wispy, storm (with a bolt), heart, rain (with drops), tufted, puff cluster,
  one-sided, three-puff, thought and billowing. Each reads as a cloud at 22px. Existing bots moved
  to clouds (the old default spread over all of them so they don't look alike).
- **Manga eyes, a different kind for every cloud**, so two bots never look alike apart from
  colour: glossy, round shoujo, button, sleepy, determined, smug, surprised, heart glints, teary,
  star sparkles, tiny dots with blush, almond, ringed iris, dreamy, star pupils. Lids, where an
  eye has them, are held for good.
- **No blinking, ever, and the cloud never moves.** The eyes never close, squash or narrow in
  motion. Only the irises and their sparkles move inside the eyes: occasional glances left, right,
  up and down with pauses, on each bot's own rhythm; none with `still` or reduced motion. States
  show through the gaze (attention: centred, sparkles twinkling; thinking: looking up; working:
  glancing side to side; concentrating: looking down), happy ^ ^ eyes with rosy cheeks, and a
  sleeping computer's dimmed cloud with a "z".
- **The Builder alone wears a hat**, a propeller beanie, and keeps its pondering face: a raised
  brow over one eye narrowed under a held lid, its gaze turning slowly from side to side.
- **Mercbot's own cloud** replaces the citrus: an orange (#FD690F) cumulus with a little
  speech-bubble tail and the glossy eyes, still always orange. It is **the logo**: the favicon,
  the welcome page, the about dialog, help centre, template and store pages.
- A new bot starts in a colour and a cloud no bot in the home has yet, while any are left.
- **Weather clouds** (the same day): 14 more, each with its own new eyes: thunderstorm (fierce),
  double lightning (bolt glints), downpour (worried), drizzle (bean eyes), windy (light streaks),
  blowing (cheeky, puffed cheeks), snow (snowflake glints), hail (block eyes), sleet (a mismatched
  pair), fog (mist across the eyes), rainbow (rainbow glints), sunny spell (sun glints), night
  with moon and star (crescent glints) and a funnel cloud (dizzy spirals). The weather never moves
  either. The picker shows all 29, ten to a row.

## D-45 — Together AI serves Mercbot's chats (2026-10-30)

- **Provider:** Together AI. The model is DeepSeek's Flash, `deepseek-ai/DeepSeek-V4.1-Flash`, at
  Together's API, with thinking off for plain chat. *Since D-72 Together AI is the premium kind of
  AI, with its own two settings, and D-59 decides which work runs on it.*
- **Speed:** the first measurements gave 1.4–1.9 s for a full short reply, against a 3.4 s median
  for DeepSeek's own API's short replies over the previous five days.
- **What a call cost:** Together's list prices ($0.30 per million input tokens, $0.006 cached,
  $1.20 output). Together has no balance API.

## D-46 — Bots that work with each other, and groups with several people (2026-10-30)

A feature designed here (D-18) on 2026-10-30. A bot can ask the home's Builder (Otto, say) for an
app and use the result, and plan features in a group chat with the bot, the Builder and other
people. Agreed order, one step at a time: **first "ask and wait"**, **then groups with several
people** with tools allowed in groups, and **later bots-only threads and a company chart**, once
we've seen how bots behave in the first two.

- **Ask and wait:** a bot sends another bot a brief, not its chat or its memories; the other bot
  works where the person can see it; the answer comes back to the asking bot, which carries on
  with the person's job. A card shows the request on both sides.
- **Bots aren't permission:** a message from a bot never counts as the person's own request.
  Anything that needs approval asks the person behind the job.
- **Limits from day one:** how far a job can be passed on, how many turns and how long it may take,
  no asking a bot already in the chain, and the person can cancel at any time.
- **Groups with several people:** people in a home can share a group with bots, and bots use
  their tools there. A group with other people in it is treated like a shared room: only the
  home's connected accounts, nobody's private memories, and approval cards only the asker can
  answer.
- **Later, a company chart** decides only who may start a conversation with whom, never what a bot
  may do; approvals always stay with people.
- **Step 2 choices (2026-10-30):** bots may use their computer in groups too, each with its own
  separate computer for that group, never its private one; anyone already in a group can add
  people from the home, and the group's creator and the home's owners and admins can remove them
  (anyone can leave).

## D-47 — Bots' real computers: a shell in gVisor, three file folders and file browsers (2026-10-30)

A feature designed here (D-18). Bots get a real command line, safely.

- **A shell for every bot.** Bots run ordinary bash, with pipes, loops and scripts, in an Ubuntu
  toolbox: ffmpeg, ImageMagick, OCR (tesseract), PDF tools, pandoc, Python with data and Office
  libraries, sqlite, jq, the Unix tools and the Craft apps' command lines. They decide by
  themselves when to use it; nobody tells them to.
- **gVisor, not just bubblewrap.** Commands run in gVisor (its own kernel in front of the server's),
  rootless, with the conversation's folders only, a scratch /tmp, and limits on time, memory,
  processes, file size and output. gVisor was chosen after discussing escapes; separate sandbox
  machines holding no secrets are the next step when usage grows.
- **No internet and no installs, by design (2026-10-30).** After weighing open internet and installs
  that last (a persistent layer per person, package sites through a checking proxy), this design
  was kept: commands have no network, and every command starts from the same clean toolbox, so
  nothing builds up. Tools bots keep needing are added to the shared toolbox (Node.js was, for
  programming). Revisit only if real use shows a need the toolbox can't meet.
- **Long jobs carry on in the background** (up to 30 minutes) and the bot is woken to report.
- **Three folders:** `/files/mine` (the person with this bot), `/files/bot` (everyone in the home
  using this bot) and `/files/shared` (the whole home). A shared bot or a group has no private
  folder. Files move freely between them.
- **File browsers:** each bot's files in its Details (a Files tab); the home's files on a Files
  page above Apps in the sidebar.
- **Turns another bot started** (D-46) see the person's and the home's folders read-only.
- **Files are never programs (2026-10-31):** nothing in the folders can be started, even something
  a bot downloaded or someone uploaded; scripts still run through bash, Python or Node.
- **Only owners and admins choose the Builder (2026-10-31)**, since it changes everyone's apps.
  Bots' eyes glance but never blink (D-44).

## D-48 — One agent loop, built properly (2026-10-30)

The full account of the loop, every decision and the evaluations is in
[docs/agent-loop.md](agent-loop.md); keep it current.

The Builder's work is a real agent loop, and the way it compresses context and iterates must follow
established best practice: it is meant to create software.

- One loop for every bot turn (own chat, rooms, groups, requests between bots, routines, app
  tasks), run until the model is done within time and cost budgets, saved step by step so it
  carries on after a server stops, and continued in the background instead of asking the person
  to say "carry on".
- Context managed inside and between turns, sized for the model's **1-million-token window**,
  never dropped silently, with the prompt's stable start kept for the provider's cache.
- **Reasoning on for building work**; off for plain chat.
- **Measure first:** a fixed suite of real tasks, judged by outcome, with a baseline before any
  change and a rerun after each phase.
- DeepSeek's own agent harness (https://www.deepseek.com/en/harness/: official, MIT, TypeScript, in
  preview; its storage is pluggable) was studied. **Decision:** don't depend on it; study how it
  does each part and build the same behaviour into our own loop, without the preview risk or its
  ~80 packages. Its designs are credited in comments (MIT).

**The bar (2026-10-31):** the loop must be nothing short of Claude Code's own: Claude Code's loop
with the same DeepSeek model is the yardstick, measured on the same tasks, and the work goes on
until it matches. Cost is not the point; getting something that works is. Reasoning stays on in the
loop. Together AI is the end goal for the provider.

Findings so far (the evaluations in `scripts/agent-evals-ours.mjs`, results in `artifacts/`):

- Telling the bot to narrate made DeepSeek announce a step and end its turn. Dropping those
  instructions (keeping its status lines): 44/45 shared, 12/12 apps, the same as DeepSeek Harness
  (44/45).
- On seven failure-prone cases × 10, the stop-shorts come from how the model is called:
  Together, OpenAI style 64/70; the same without sending reasoning back 68/70; Together's
  Anthropic-style endpoint 70/70 but with no prompt cache and unsigned reasoning; DeepSeek's own
  Anthropic-style endpoint, called as Claude Code calls it (signed reasoning sent back on every
  step, adaptive thinking at high effort, 32k output) 70/70 and 12/12 apps, 76–89% of input cached.
  Claude Code with DeepSeek: 15/15 shared, 5/5 on the harder suite (`tests/agent-evals/hard`).
- DeepSeek's list prices equal Together's at peak and are half off-peak.
- Model calls already retry: the AI SDK and Mastra each retry, nine tries before giving up.

What changed: DeepSeek's own API is called in the Anthropic format (`MERCBOT_MODEL_PROVIDER=
deepseek`); every loop step reasons adaptively, replacing D-47's rule; one-shot side calls don't
reason, except the script writer, which builds; compaction is sized for the 1M window (summarise
past 450k tokens, keep 125k word for word, history cut at 600k); a reply that stops at "I'll…"
carries on once from its own steps, for any bot with tools. *Since D-72 DeepSeek's own API is no
longer one of Mercbot's providers.*

Talking to a bot while it works (2026-10-31: people can talk to a bot while it's doing things):
what the person writes during a reply reaches the bot with its next tool result, so it changes
course at once, and that reply then counts as the answer. Before, such a message always got its own
reply afterwards; it still does when the reply had no tool call left to carry it. Replies also save
their steps as each one finishes, and one a stopped server left part-way is carried on from them by
any server (the resumer the bots' loops start), as Claude Code resumes from its transcript. The 3rd,
5th and 8th identical tool call in a row gets a reminder in its result (after DeepSeek Harness G1).

With all of the above, Together (the default, OpenAI style) scores 70/70 on the seven
failure-prone cases × 10 (64/70 before), at 2–7 s a task and 65% of input cached; DeepSeek's own
endpoint 70/70 at 8–20 s. Hard suite before these changes: Together 14/15, DeepSeek's endpoint 9/10
(the rest cut off by a time limit), Claude Code with DeepSeek 5/5.

Regression on Together with the whole loop (2026-10-31): 45/45 shared, 12/12 apps, hard suite 14/15
(the miss, a two-paragraph plan that stopped, is now caught by the stop-short check) and dedupe
3/3 on a rerun; quick chat 15/15 in 0–3 s with reasoning on every step.

Final regression with the whole loop on Together (2026-10-31, after markup handling, job notes,
summarising before a reply, room inside long turns, carrying on by itself, one loop for groups and
the Builder's screen check): shared 45/45, hard 15/15 (matching Claude Code with DeepSeek's 5/5),
recall after a ~600k-token chat 1/1, quick chat 10/10 in 1–2 s, Mercbot app cases 15/15 including
the Builder building an app from a group request.

A job's cost limit (2026-10-31, as a parameter): a goal and its rounds stop when the job's model
spend since the goal began reaches `AGENT_JOB_COST_USD` (5 dollars by default, 0 for no limit), and
the chat says so. Truthful replies about files and `send_files` are built in full.

## D-49 — Bots' computers run entirely in gVisor (2026-10-31)

gVisor is fast enough, and the browser and apps must run in it for legal reasons, so that is what
bots' computers run in.

Two versions of the bot's computer were built on branches (D-47). The `computer-gvisor` branch is
chosen; `computer-terminal`, where the desktop apps and Chrome stayed in bubblewrap, is not.
- **Everything a computer runs is in gVisor.**
  - Chrome and the Craft apps share one gVisor "desktop" sandbox per awake computer. It has no
    network of its own.
  - Their only way out is Mercbot's gateway (`packages/computer/src/server/gateway.js`). The
    gateway refuses loopback, private, link-local (cloud metadata), CGNAT, reserved and
    multicast addresses, the server's own addresses, and mail ports.
  - The command line is a separate gVisor sandbox with no internet. While the computer is awake,
    the bot's commands run in its session, and the Terminal on the dock shows them live, with the
    person's own shell below.
  - The screen, the window manager and screen sharing stay outside the sandboxes and only draw.
- **Speed**, measured on a shared development host without KVM: page loads about 2.5–4× slower,
  typing 0.29 s → 1.17 s for 51 characters, scrolling 0.73 s → 1.5 s, and Chrome takes 4.8 s to
  start. That was judged fast enough.
  - A server may give gVisor KVM, with the server's user in the `kvm` group. Measure there with
    `scripts/measure-browser-speed.mjs` (D-51).
  - Chrome's site isolation stays on; turning it off for speed was rejected.

## D-50 — Bots' screenshots and saved browsers leave the database (2026-10-31)

Bots' screenshots must stop going into PostgreSQL, and it must be structurally impossible for them
to end up anywhere but the shared files volume. Then browser profiles and cookies, the same way.
They go on the files volume (JuiceFS, whose data already lives in object storage) rather than a
separate bucket, and screenshots are kept as long as their conversation. There were no users yet,
so old data was dropped.
- **Where:** `<files>/computers/<conversation>/` on Mercbot's own volume, outside every person's
  folders. Without the volume there are no screenshots and nothing is saved; nothing falls back
  to a server's disk (D-19).
- **Structural:** the migration drops `bot_screenshots` and `bot_browser_state`'s `profile` and
  `cookies` bytes. The row keeps only the current profile file's name, sha256 and size and the
  cookies file's sha256.
- **Saving a profile:** sealed, written under a new name, recorded, and only then is the old file
  removed. Cookies are sealed to one file per computer, replaced whole, and only when they
  change. On restore, a file whose sha256 isn't the recorded one is ignored.
- **Lifetime:** a conversation's computer folder goes with the conversation. Every server checks,
  at most hourly, for folders whose conversation is gone.

## D-51 — Bots' sandboxes run as a separate, powerless user (2026-10-31)

Before launch, the sandboxes may run as a separate Linux user, so that a program that got out of
gVisor couldn't reach the database password or keys.
- **The setting:** with `MERCBOT_SANDBOX_USER` set, every gVisor sandbox runs as that user through
  `sudo -n -u <user> -- runsc`: commands, the Terminal's session, the computer's desktop
  (Chrome, Craft apps), and the office apps and voice memos. This applies wherever runsc is
  started, stopped or entered (`runsc()` in `shell.js`).
- **Root setup, once per server:** `scripts/setup-sandbox-user.sh` creates the user and the shared
  group `mercbot-shared`, a sudo rule that allows only Mercbot's runsc, setgid group-writable
  folders (files volume, browser profiles, the sandboxes' temporary folder, `TMPDIR`), read
  access to the tools, and a settings file only the server can read.
- **Sharing files:** the sandboxes (OCI `umask`) and the server (`process.umask`) both write
  group-writable files, so each can change what the other made.
- **Without the setting**, sandboxes run as the server's user, as before. The development host had
  no root, so the separation was tested there only through a stand-in for sudo: every runsc call
  went through it, files came out group-writable, and the shell and office tests passed. It is to
  be checked on a server with the real user, together with KVM (docs/deployment.md).

**KVM measured (2026-10-31).** On a development virtual machine with KVM access (itself a KVM
virtual machine, so KVM is nested), gVisor on KVM was slower than gVisor's default:
- **Chrome:** start 4.1 s against 2.5 s, GitHub 5.2 s against 3.2 s, typing 0.77 s against
  0.57 s, scrolling 3.9 s against 0.8 s. Only Wikipedia and Hacker News loaded faster.
- **Commands:** 25–70% slower, in two rounds each.

So KVM is no longer used whenever `/dev/kvm` is open: it's turned on per server with
`MERCBOT_GVISOR_PLATFORM=kvm`, after measuring there (docs/deployment.md).

## D-52 — The agent loop becomes its own package, without Mastra (2026-10-31)

The loop should be something other software can use, working on its own, with Mercbot adding its
extras on top. Mastra is dropped (only its basic loop was used). The result must be neat and easy to
reason about, and lose no thinking ability; the agent documentation moves with it; the end result
is a complete diff for jskit-ai.
- **`packages/agent` (`@local/agent`)** holds the generic engine on the AI SDK: the loop, reasoning
  settings, tool schemas, context for the 1M window, the checks on every reply; then goals, saved
  steps and resuming, summaries, planning tools, default tools (files, search, edits, a sandboxed
  command line), executors (gVisor by default, a local process only when asked), storage and a basic
  chat panel. Mercbot plugs in its instructions, tools, cards and tables.
- **No ability lost, proven:** with recorded model replies played back, every request the new loop
  sends is byte-identical to Mastra's on Together and on DeepSeek's Anthropic endpoint, including
  all 95 tool definitions. The one difference: the model's own tool calls go back as it wrote them
  (Mastra re-sorted their fields). Real-model checks: 15/15 coding, 5/5 app cases, 5/5 chat.
- Mastra (`@mastra/core`, `@mastra/memory`, `@mastra/pg`) is removed; so is the one-off D-47 script
  built on it (`scripts/measure-shell-thinking.mjs`; its results are in D-47).
- The package never imports Mercbot code, so it can move into jskit-ai as it is (the change is
  delivered as a patch).

## D-53 — The agent engine moves into JSKIT; its settings are AGENT_* (2026-11-01)

Mercbot's loop becomes JSKIT's agent engine, the one that also powers the JSKIT assistant, and
nothing it can do is lost.
- **Where it lives:** the engine D-52 made as `packages/agent` is now JSKIT's `@jskit-ai/agent`
  (the loop, tools, checks and executors) and `@jskit-ai/agent-runtime` (goals, saved steps,
  summaries and their storage). Its tests moved with it. `packages/agent` is gone; the bots
  package imports both and keeps only Mercbot's instructions, tools, cards and tables.
- **Settings:** the engine's own settings are named for it, not for Mercbot:
  `AGENT_JOB_COST_USD` (was `MERCBOT_JOB_COST_USD`) and `AGENT_REPLY_MINUTES` (was
  `MERCBOT_REPLY_MINUTES`). A server that still sets the old names gets the defaults, so a copy's
  environment is renamed before the update that carries this.

## D-54 — Settings come from the runtime's env; the seams tests use stay (2026-11-02)

The code: every feature that reads the server's settings requires `runtime.env` and passes it down
to what reads them; no function falls back to `process.env` (the development trace folder,
`MERCBOT_TRACE_DIR`, comes from it too, through `createMeteredFetch(env)`). The env is read when a setting is needed, so a test that
changes one while running (`MERCBOT_SERVER_ID`) passes `process.env` itself, not a copy. The bots
feature makes the one chat model and hands it to everything that asks the model.

These optional dependencies stay, because tests (or a script) put stand-ins there:
- **`insecure`** on `createOAuth` and `createWebAccess`: allows plain http and local addresses, for
  the tests' stand-in providers and sites.
- **`providers`, `hubFor` and `oauthClient`** on `createConnections`: stand-in providers, hubs and
  OAuth exchanges.
- **`createManager`** on `createComputers`: stand-in computers, so the several-server tests need no
  browser.
- **`pool` and `web`** on `createScripts`: the script runners and the web access scripts use;
  tests pass a web access that allows their local stand-in sites.
- **The bots' model stand-ins** on `createBotsService`: `reply`, `groupReply`, `checkClaims`,
  `activity`, `writeSkill` and `summarize`, the limits `compactionLimits`, `requestLimits` and
  `goalLimits`, and `match` on `createApprovals`. Each defaults to the real model call with the
  feature's chat model.
- **`scriptModel`** on `buildAppTools`: required; the bot's turn passes the chat model's script
  writer, tests a stand-in.

## D-55 — Views: live data pages between pages and apps (2026-11-06)

Mercbot is database-powered, so it also makes views: halfway between a page and an app, always
live, far simpler than an app, and reusable inside apps. The design is
[docs/views-design.md](views-design.md).
- **What a view is:** a one-screen, read-only app definition any bot saves at once, with no draft. It's
  an `apps` row with `kind = 'view'`, so versions, renames, removals, access and pins come with it.
- **Who sees and changes it:** private to the person whose chat made it, until they share it with the
  home; a view from a shared room or a group starts home-wide. A bot changes a view only if the person
  it's working for can see it. People share, restore and delete; no bot tool does. *Since D-66 every
  view is the home's.*
- **Inside apps, the app decides:** a shared embed always shows the view's current version, and only the
  Builder may change a view an app shares. A copy is the app's own read-only screen, going through
  Draft and Publish, which keeps a link to its original and asks whether to update when that changes.
- **Pages stay as they are for now**; D-40 is decided separately. The name stays "views", they share the
  sidebar's 8 pins, and people may delete one unless an app shares it (*since D-62, retire*).

## D-56 — What each home spends, and on what (2026-11-06)

Each home sees what it spends and on what, with nothing lost, no strain on the database, and
details for people (which bot, when, doing what). The design is in
[docs/usage-tracking-design.md](usage-tracking-design.md); D-73 and D-76 built it.

Every bot shows what it costs (a figure next to each bot, however tiny), and one screen shows every
routine and what it has cost over time, with a screen as good as the rest of the app.

## D-57 — The state note goes last, and a routine reads only its own runs (2026-11-06)

A simple routine cost far too much: patch it here and ticket JSKIT; and a routine shouldn't read
the whole chat. A development bot's "HN top story headline" routine ran every 10 minutes and was
$13.59 of the $16.87 recorded on development ($7.85 model, $5.74 Mercbot's own computer estimate).
- **The state note goes after the history.** It carries the time, and the loop put it in the system
  prompt, so every turn's first call repriced the whole history at the uncached rate (fifty times the
  cached one). Cached and uncached were split 3,584 / 18,114 on such a call; after the patch, on real
  calls, 51,328 of 51,395. This reverses the byte-identical-to-Mastra choice of D-52 on this one point.
  It's `patches/@jskit-ai+agent+0.1.0.patch` until JSKIT ships it:
  https://github.com/mobily-enterprises/jskit-ai/issues/491
- **A routine run reads its instructions and its own last 3 runs**, not the chat or its summary
  (`routineHistory`). Its reply stays in the chat and doesn't count as answering the person. Watch runs
  and app tasks still read the whole chat, and may deserve the same.

## D-58 — DeepInfra is available (2026-11-06)

DeepInfra is available as a provider, selected with `MERCBOT_MODEL_PROVIDER=deepinfra`; Together AI
stays the default. *Since D-72 DeepInfra is the economy kind of AI, with its own two settings.*
- **Model and prices:** `deepseek-ai/DeepSeek-V4.1-Flash`, listed by DeepInfra's `/models` at $0.20 input, $0.60 output
  and $0.006 cached per million tokens. Responses also report `usage.estimated_cost`, the real charge, lower during a promotion.
- **Thinking must be asked for:** by default it returned no reasoning, so every call sends `reasoning_effort: high`,
  unless the call turned thinking off. Without this, switching would silently lose all reasoning.

## D-59 — The model runs where each kind of work suits it (2026-11-06)

DeepInfra's slow mode suits batch work and DeepInfra or Together AI suit chats; app making can use
DeepInfra too, since people expect to wait. Flex runs every routine.

| Work | Runs on | Why |
|---|---|---|
| Chats, groups, requests between bots, button hand-offs | Together AI | Someone is waiting; fastest |
| The Builder's replies | DeepInfra Standard | About 58% cheaper; people expect to wait |
| Routines, watch runs, finished background commands, goal rounds, summaries | DeepInfra Flex | Nobody is waiting; cheapest |

- **Measured (40 calls, about 40,000 tokens, a quiet time):** Together first word 0.3-0.8s at 150-315 tokens/s; DeepInfra
  about 1.3s at 80-150, and Flex about 2.7s. Priority (1.5x) only jumps the queue when DeepInfra is busy, and wasn't faster
  then, so nothing uses it. The slowness is DeepInfra's own, not its thinking effort.
- **Flex's limit:** DeepInfra may hold a Flex call 10 minutes. Ours waits 2, or until refused (never charged), then goes again at
  Standard. Morning routines can't drift far, and summaries stay inside their 3-minute claim.
- **Longer limit:** app making and background work get 30 minutes for a reply instead of a chat's 15.
- **Costs:** each call records who served it (`usage_events.served_by`) and DeepInfra's reported real cost, otherwise that
  provider's list prices, so mixed work adds up correctly.
- **Stays on the chat provider:** browser steps (Stagehand), a Builder in a group, and the checks on a reply outside background work.
- **One place to change it:** `WORK` in `packages/account/src/server/providers/index.js` (D-72).
- **Known limit then:** a routine or watch run still in progress when its server stops is lost until next time, as before,
  and these runs can now last longer. *D-77 lifts it.*

## D-60 — Background follow-ups read less, and the Builder's views start home-wide (2026-11-06)

- **Watch runs read as routines do (D-57):** their instructions and their own last 3 runs, not the chat or its summary.
- **A finished background command reads the chat's last 6 text messages, in words only.** One development bot's read all
  131,000 tokens of its chat, 3.9 cents for one call. It doesn't read only its own runs as a routine does, because a person may
  have said what to do with the result ("then email it to me") and a command's report doesn't say. A button's hand-off still
  reads the chat, because someone just pressed it.
- **The Builder's views start home-wide,** an exception to D-55. They were private, so the Builder couldn't use its own
  view in an app until the person shared it. *Since D-66 every view is the home's.*

## D-61 — No screen shows the AI providers' balances (2026-11-06)

Mercbot reads no AI provider's balance for its screens: no balance, provider name or link to buy credit is shown, and
`GET /api/usage` returns only what was used. Balances are checked on each provider's own website. The account feature
still answers who runs this copy (`mercbot.copy-runners`), for what only they may do (D-84).

## D-62 — Views are retired, never deleted (2026-11-06)

Nothing is deleted, ever: a view is "retired", only if no app uses it. This replaces D-55's delete.
- **Retire** in the viewer, refused while an app shares the view (*since D-66 anyone in the home retires one*).
- A retired view keeps its row, versions and key (`apps.retired_at`). It leaves the Apps area, search, pins, the save
  check and the Data tab's "used by", and its address and old cards say it was retired. An app's copy stays as it is.
- **Bring back** (the same day): retired views are listed under **Retired** in the Apps area, and come back as they
  were, never clashing by name: if an app or view now has the name, it comes back as "Deals (2)" and says so.
- **One name for each kind** ("Apps", "Pages" and "Views"): "mini-apps" is gone from help and the Builder's skill, and
  an address with nothing at it no longer calls a view an app.

## D-63 — Pages: the D-40 design approved, built after the Material 3 sweep (2026-11-06)

`docs/pages-design.md`. Bots' own scripts are dropped; pages share with Only you or Everyone in the home; every saved
version is kept, with Restore. Built after the Material 3 sweep (D-64), when the work is rephased. *D-74 amends it.*

## D-64 — Material 3, keeping Mercbot's look (2026-11-07)

The Material 3 sweep, in "keep" mode: a light change where the UI as a whole is retained, but the general rules are
applied so that Mercbot is a proper JSKIT Material 3 app. Every screen keeps its layout; JSKIT's rules replace the
earlier hand-matched colours and sizes where they differ.

- **Navigation is JSKIT's.** Each inner page (Apps, an app, a table, Files, a template's page) declares its parent and
  shows the shell's one Up arrow in its top bar, which goes back the way the person came or else to that parent. It
  replaces "← Chats", "← Apps", "← Data" and "← All templates". Steps inside a window name where they go instead of a
  back arrow: **Connect apps**, **Your apps and skills**, **All settings** (phones), **Overview**, and **Previous** in
  the first-run slides. Links are built by JSKIT's paths, never by hand.
- **Back and forward are the browser's own.** Mercbot binds no key for them; the shortcuts sheet lists the
  browser's Alt+← and Alt+→, as it lists the browser's zoom and full screen. Ctrl+[ is now the Up arrow's key: on the
  pages that show it, it does what the arrow does, through JSKIT's navigation rather than the history. Ctrl+] is free.
- **Colours are Material roles.** The theme comes from one seed, Mercbot's link blue, in light and dark. UI colours are
  that scheme's roles: black pills and buttons are its inverse surface (so they turn near-white in dark), statuses are
  success, warning, info and error, and links, switches that are on and a black bot's picks are `link`. A black bot's
  accent is the inverse surface too. The file, page and app viewers, the screenshot lightbox and a bot's computer stay
  dark in both themes, with a document's page shown light. Content colours are not roles: the bot palette, avatar art,
  home tiles, chart series, app swatches, the white behind QR codes and logo pictures, and the front page's and
  intro's pictures keep their own colours, in `src/theme/palettes.js`; the server checks bot colours against the same
  palette.
- **Sizes are JSKIT's.** Round icon buttons take JSKIT's button sizes instead of fixed widths and heights, and cards and
  panels are told apart by tone (surface-container-low, 12dp corners) instead of a border.

## D-65 — Production needs an https APP_PUBLIC_URL (2026-11-07)

Decided after a security audit: a server started with `NODE_ENV=production` refuses to start unless `APP_PUBLIC_URL`
is an `https://` address, so it can never fall back to localhost and the providers' test apps. Every link Mercbot
makes is built from `APP_PUBLIC_URL` alone, never from a request's Host header, which a caller can set to anything.
Development, tests and Preview may still run without it; their links then point at `http://localhost`. Since
2026-11-12 (D-81), production also takes `http://localhost`, `http://127.0.0.1` or `http://[::1]`, but only while the
server listens at `HOST` `127.0.0.1` or `::1`: a person's own computer. Since 2026-11-12 (D-72: a missing key never
stops a start), production without `APP_PUBLIC_URL` starts too: its links point at `http://localhost`, and startup
logs a line saying so (`packages/account/src/server/keys.js`). A value that isn't `https://` (or the local addresses
above) still refuses, and links still never come from a Host header.

## D-66 — Nothing is private inside a home; public apps are the only boundary (2026-11-07)

No private apps and no private data inside a home: everyone in it sees and changes everything. Public apps are the
only security boundary, through a declared visitor allowlist that the server enforces and that defaults to nothing;
there is no other security inside Mercbot. This replaces D-35's third-stage permissions (an app for chosen people, a
table changed by chosen people), D-55's "private to the person whose chat made it, until they share it", D-60's "the
maker can still make one private", and who may retire a view in D-62. Four answers:
- **Views lose "Only me".** Every view is the home's from the moment it's saved, whichever chat made it, and every bot
  sees and finds every view. Only the Builder may still change a view an app shows, so apps don't break.
- **Anyone in the home may retire a view or bring it back.** Both are audited and can be undone.
- **Publishing wider visitor access on a public app needs an owner or admin;** narrowing it is instant.
- **Owner and admin home settings stay:** choosing the Builder, making an app public, the home's and an app's look,
  switching scripts and the web addresses they may call, and installing templates. They are settings, not access to data.
  Since 2026-11-12 publishing a page to the home's website (D-84) is one too, since it reaches outside the home.

Inside the home:
- Everyone in it also reads, changes, obsoletes, restores and imports into every table; bots were never limited. The
  access, share, writers and people routes are gone (their addresses answer 404).
- The `apps.access`, `app_members`, `app_tables.writers` and `app_table_editors` columns stayed, unread, for one
  release, because several servers run during an update (D-15). *D-78 drops them.*

Visitors:
- **The allowlist** is the app's `public.tables`, per table: `can` (list, get, create, update, delete), `rows` (all, own
  or a formula), `owner`, `read` (fields visitors may receive, filter, sort, group or sum by) and `write` (every field a
  visitor's request writes, presets included; never the owner, which the server sets). It is versioned with the app.
  The save check refuses unknown settings and fields, and any public screen that uses something not listed.
- **One fence:** the data gate holds every call made for a visitor to the list, compiled from the live version. A
  visitor's context without it reaches nothing. Records carry only readable fields, a row click or a record outside the
  rows rule answers 404, and a link reaches only the linked table's rows: it shows its label only when that table's
  title is readable and the record is within them, and a visitor may only link to such a record. What a visitor's write
  gives back holds readable fields only. Data scripts on public screens run with the visitor's access; rules on saving
  and jobs run as the home.
- **Earlier apps** keep their visitor rules until an upgrade rewrites them; meanwhile they are compiled in memory to
  what their public screens use.
- Mercbot keeps the grammar, the save check, which app is public and the fence; a copy built on Mercbot that serves
  visitors adds their routes and sign-in.

## D-67 — Every app moves to visitor access; Overview narrows it (2026-11-08)

Amends D-66 ("Earlier apps"), taking the recommended choice where the design left one open:
- **The upgrade:** a migration writes every app still on the earlier visitor rules as visitor access. Its live version
  becomes a new live version (kind `upgrade`, by Mercbot, with an Activity entry), listing exactly what its public
  screens used, as the in-memory derivation did; its draft is rewritten in place. Apps that aren't public are upgraded
  too, so their drafts keep saving.
- **Saves refuse the earlier rules**, naming what to list instead. A version still on them (an old one being restored,
  or one saved by a server of the previous release during an update, D-15) is compiled in memory as before, and
  restoring one stores it listed.
- **Overview** shows everyone in the home what visitors reach. Owners and admins take things away there, saved at once
  as a new live version (kind `narrowing`) whose draft loses the same; which records and the owner field never change
  there.
- **Reaching more** goes through the Builder's draft. On a public app only an owner or admin publishes or restores a
  version that reaches more: a new table, operation, field or owner field, or rows other than from all.
- **Data scripts on public screens:** while the newest version a person made live is still the upgrade's, Overview
  names them and asks someone to check the list covers what they read. It is worked out when Overview opens, not stored.

## D-68 — Mercbot asks Vibe64 for its own sandboxes and binds nothing but its port (2026-11-10)

On Vibe64 a published app runs under systemd's application sandbox, which until now refused the user namespaces,
mounts and ptrace that gVisor (D-49) and FUSE need, and lets an app bind no port but its own. Rather than weaken every
app or switch bots' computers off, a project may ask for exactly these, with the workspace owner's approval:
- **The ask:** `genesis/stack.md`'s Deployment says `Sandbox allows: gvisor fuse`. Vibe64 adds only what each names
  (its own namespaces, `@mount` and `ptrace`, `/dev/fuse`) to Mercbot's unit, and only once the workspace owner
  approved it on the Deploy page; every other app stays locked.
- **No TCP port but its own:** x11vnc listens on a Unix socket (`-unixsock`, `-rfbport 0`), and the browser's
  remote control is a Unix socket bridged through Mercbot's own port at `/api/computer-cdp/<key>/devtools/…`, since
  Stagehand and Puppeteer take only a `ws://` address. The key is a fresh random 256 bits per browser, known only to
  the server process; only this machine's own connections carrying no proxy headers get through, so nothing arriving
  through the public proxy reaches a browser.
- **Its own namespace:** `scripts/serve.sh` and `npm run develop` run Mercbot through `scripts/namespace.sh`, in a
  user and mount namespace of its own, where it mounts the files volume and people's storage as that namespace's
  root. The mounts are seen only inside it. With `MERCBOT_SANDBOX_USER` (D-51, outside Vibe64) it stays in the host's
  namespace as before.
- **Mounting directly, never through the set-user-ID helper:** JuiceFS mounts directly as the namespace's root. rclone's
  FUSE libraries mount only through a program named `fusermount3`, so in the namespace rclone finds the hosting
  script's copy from Ubuntu's `fuse3` package first (`.tools/fuse/fusermount3`, without the set-user-ID bit), which as
  the namespace's root makes the mount itself. Both come off with plain `umount`. The host's own `fusermount3` is never
  used there: on Ubuntu its AppArmor profile allows mounts only under home, `/tmp`, `/mnt` and `/media`, so it refused
  a release's folder (found on a real host, 2026-11-10). JuiceFS's debugging listener is off (`--no-agent`); its
  metrics listener has no switch, so its one attempt is refused and logged, and nothing uses it.
- **The display, inside the application sandbox:** it hides every GPU, so the hosting script points Xvfb at Mesa's
  software EGL (a GPU driver's own, which glvnd picks first, crashed Xvfb). Xvfb offers no shared memory (MIT-SHM) and
  x11vnc doesn't use it: the sandbox's private IPC namespace is fresh, so x11vnc's segments take the small ids the apps
  in gVisor also get in theirs, and Xvfb attached x11vnc's segment for Chrome's, so Chrome never finished a frame.
  Stagehand's extension, which runs inside the browser's sandbox, dials Chrome's own address there, not the bridge.
- **Nothing of Vibe64's browsers:** a computer's browser is the toolbox's Chrome in gVisor (D-47), so starting one
  no longer looks for Vibe64's runtime pack Chrome, which a published app neither declares nor needs.
- **No silent fallback:** a host that refuses the namespace, gives no `/dev/fuse`, or lacks `Xvfb`, `x11vnc` or (since
  2026-11-12) `openbox` stops the install, the start and the wrapper with one plain sentence, such as "This host
  doesn't let Mercbot create its own sandboxes, which its bots' computers need. See README → Hosting requirements.",
  followed by the underlying error. Mercbot never starts with its computers, toolbox or mounts quietly switched off.
- **One script per host:** `HOSTING_SCRIPT` names it, relative to Mercbot's folder (default `scripts/hosting/vibe64.sh`;
  another host's goes in `scripts/hosting/` too). It owns only what differs between hosts: the namespace and `/dev/fuse`
  checks, finding `Xvfb` and `x11vnc`, and obtaining and unpacking Ubuntu packages with the host's apt: the toolbox's,
  the desktops' own `tint2`, `hsetroot` and `xterm` where the system lacks them, and rclone's `fusermount3`. A step
  goes there only if another host would do it differently, and it uses only what the host offers, never working around
  its rules. gVisor, the base image, the offline install inside gVisor, the Craft apps, Chrome, JuiceFS, rclone and
  Piper stay shared. The install, which the Stack's Deployment Prepare step runs (`npm run deploy:prepare`), and the
  start check the host through it before anything else. A path to no file stops the install, naming the variable, the
  path it was given and the scripts in `scripts/hosting/`. The README lists what another host must provide. Mercbot
  ships no script that changes a host's security settings. Since 2026-11-12, `scripts/hosting/local.sh` is a person's
  own computer's (D-81), and `npm start` and the Procfile go through `scripts/serve.sh`, so no start skips the checks.

## D-69 — A test copy sends nothing to the outside world (2026-11-11)

Mercbot follows JSKIT's `SIDE_EFFECTS` rule for what its own code sends. Only a copy whose `SIDE_EFFECTS` is exactly
`live` acts for real; any other copy, including one where it is unset (development, previews, tests and a published
copy before it is switched to Live), is a test copy. A test copy logs each send in one line ("Test copy: … was
simulated, not sent (SIDE_EFFECTS is not live).", with who and what but never a body, link or code) and answers as if
it went out, so the person and the bot carry on as they would. The live copy behaves exactly as before. Mercbot asks
JSKIT's own helpers (`sideEffectsAreLive` from `@jskit-ai/kernel/shared/support/sideEffects`, `logSimulatedSideEffect`
from `@jskit-ai/kernel/server/runtime/sideEffects`), and JSKIT marks every page of a test copy with a small "Test copy"
tab at the top and says at start-up whether the copy acts for real.
- **What a bot sends from a connected account** (D-31), at the point it would go out: Send on a draft card from a
  connected mailbox and "send it" in words, sending a saved draft, forwarding an email; a calendar event with guests,
  a change to an event with guests or one that invites someone, removing an event with guests, answering an
  invitation; a comment on an issue or pull request, a discussion comment or reply, and a review with a verdict
  (approve, ask for changes or comment) or a waiting review sent. A test copy answers with what the live copy would
  say, marked `simulated: true` in the bot's result. Reading, and changes that reach nobody (an event without guests,
  a draft saved, a label, a review left waiting), run in both.
- **Scripts' outside web calls** (D-35): `web.fetch` with any method but GET is a webhook and is simulated in a test
  copy, answering status 200 with no body; GET still reads.
- **Drive sharing and comments:** sharing a file from Google Drive or OneDrive, which gives someone access and, unless
  told not to, has Google or Microsoft email them; and a comment on a Google Drive file or a reply to one. A test copy
  answers a share with the file's details as they are (a read) with the new person on its list, and a comment as made.
  OneDrive takes no comments, so it refuses one in both copies.
- **GitHub's issues, pull requests, merges, releases, discussions and reruns** (reruns too, since a run started again
  can deploy or publish): opening an issue or a pull request (a draft one too), closing, reopening or changing either
  (title, body, assignees, base), adding or taking off an issue's labels, making one issue a sub-issue of another,
  marking a pull request ready for review or turning it back into a draft, bringing its branch up to date with its base
  (a merge into it), merging it, publishing or drafting a release, changing or deleting a discussion comment or marking
  or unmarking its answer, and running an automation run, or only its failed jobs, again. A test copy answers with the
  live copy's words; where only GitHub could say, a new issue or pull request is `#simulated` at `…/issues/simulated`
  or `…/pull/simulated`, a release's link ends `#simulated`, and an issue or pull request changed keeps its own title
  and page, and a run its page, read as they are.
- **Not gated:** a bot's own computer (browsing, typing and clicking on any site, signing in, taught skills replayed,
  and drafts it sends from there), its commands, calendar changes without guests, and every read. Also still made in a
  test copy: making, changing, moving and copying Drive files, and on GitHub branches, labels' own settings (making,
  changing and deleting a label) and deleting an unsent review, none of which a conversation others follow shows.

## D-70 — A published Mercbot keeps its tools between releases (2026-11-11)

Every Vibe64 Publish builds in a fresh source folder, so Prepare installed every tool and built the ~2 GB toolbox again:
15–25 minutes and 2.2 GB of disk per release. Only a host's first Publish should be slow, since fast publishes matter:
- **One store, kept in the home:** `scripts/tools-store.sh` installs each tool once per pinned version (and the
  install's `REVISION`), and the toolbox once per stamp, into a store, and hard-links them into the release's
  `.tools/`, so the app and its scripts read plain files at the same paths as before and a release adds no disk.
  `npm run deploy:prepare` keeps the store in `$HOME/.cache/mercbot-tools`: on Vibe64 that's the app account's own
  home, inside the area its sandbox may write, removed only with the project, and it already kept npm's cache across
  releases. A checkout keeps its store in `.tools/store`, and an existing checkout's toolbox moves into it instead of
  being rebuilt.
- **Reuse costs nothing:** a version already in the store is linked without downloading or checking anything again;
  only a missing or changed one is installed, and the downloads go once it is.
- **Never half a tool:** a tool counts only once its marker, written after its install, is there, and the toolbox only
  once its stamp is, written before the finished folder replaces the old; anything cut short is installed again.
- **Only what's in use:** installing a version removes the store's other versions of that tool. A running release
  keeps its hard links, so its files stay until Vibe64 tidies the release; a restored release's Prepare links or
  reinstalls its own versions.

## D-71 — A draft's preview works on practice data, and the Builder tries it (2026-11-11)

Pressing Save in a fresh People app's preview saved nothing, which looked like a broken app: D-35's read-only draft
previews looked like a bug. Decided 2026-11-11:
- **Practice data:** a draft's preview reads and writes a practice copy of the records it uses, never the live ones.
  Save, Edit, Mark obsolete, lists, totals, charts and record history behave as in the live app. Each table is copied
  the first time the copy needs it, its newest 1,000 records, and the copy follows the tables: a new field or table is
  there at once, a removed field drops out. The copy is kept in PostgreSQL the way AnyAPI keeps every home's records
  (a tenant of its own, `ws:<home>:p:<id>`), with one `app_practices` row per draft, so every server finds the same
  copy (D-15).
- **Nothing leaves:** scripts run on the copy, their outside web calls other than GET simulated as a test copy's are
  (D-69); askBot hand-offs and other effects that leave the app are only reported; practice changes never reach the
  live records, the Activity trail or watches, and script runs on it aren't kept.
- **The banner** says "Practice data: changes here are thrown away when you publish.", with **Reset** (a fresh copy
  of the live records) and **Publish**. Publishing removes the copy in the same transaction; a copy unused for 7 days
  goes in the watch loop's pruning, claimed with SKIP LOCKED so two servers never clear the same one, and records left
  under a copy without its row go too. Visitors of public apps never see practice data, whatever they ask for.
- **The Builder tries its drafts** with `app_try`: a screen's queries run on the copy, a button pressed or a form
  submitted with given values, and back come what the screen showed, what was saved or changed record by record,
  formula and validation errors, and what would have been sent. Its writes are the copy's, so the person's preview
  shows them and Reset clears them. Its guidance: try each screen and every saving button or form with realistic
  values, read the record back, fix what fails, then tell the person in a line or two and remind them to press Publish.
- **Publish is harder to miss:** the draft card in the chat and the preview's banner both have Publish, through the
  same publish path and its checks.
- This replaces D-35's "draft previews are read-only". Asking for the draft of an app that has none still only reports
  what a button would do. There is no discard action for a draft today, so a copy left behind goes with the idle sweep.

## D-72 — Three kinds of AI, each from its own two settings (2026-11-11)

Mercbot uses three kinds of AI, each with a type and an API key; the type selects the provider's layer, so a
provider's own features can be added later; for now each kind supports only its one type. An unknown type stops
startup with a plain message naming the setting. There is no fallback to the old names. Images is optional from the
start, because Mercbot runs on people's own computers and a third key shouldn't block that: without it, a bot asked for
a picture says pictures aren't set up on this copy.

| Kind | Settings | Runs |
|---|---|---|
| Premium AI | `AI_PREMIUM_PROVIDER=together`, `AI_PREMIUM_API_KEY` | People's chats and group chats (a Builder's too), requests between bots, app buttons' tasks, the bots' browser steps |
| Slower, cheaper AI | `AI_ECONOMY_PROVIDER=deepinfra`, `AI_ECONOMY_API_KEY` | The Builder's replies (Standard); routines, watch runs, finished background commands, goal rounds, summaries (Flex) |
| Images (optional) | `AI_IMAGES_PROVIDER=gemini`, `AI_IMAGES_API_KEY` | Making and editing pictures; reading contact details from photos in the Vault (since 2026-11-12) |

- **Routing stays D-59's:** `WORK` in `packages/account/src/server/providers/index.js` is the one place that maps each kind
  of work to a kind of AI. Work whose provider has no key never runs on another kind, and pictures without images say so
  instead of running elsewhere.
- **Gone:** `TOGETHER_API_KEY`, `DEEPINFRA_API_KEY`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`, `MERCBOT_MODEL_PROVIDER`,
  `MERCBOT_PICTURE_MODEL` and the Vault photo reader's `MERCBOT_PHOTO_MODEL` (a provider's layer picks its models), and
  DeepSeek's own API as a provider (D-48's Anthropic-format path): no kind selects it. The evaluation runner's DeepSeek
  experiments keep their own `EVAL_DEEPSEEK_API_KEY`.
- **Every call through one fetch:** `aiFetch(env, work)` meters it (`usage_events`, D-73), adds the provider's own needs
  (DeepInfra's thinking and Flex) and hands its failures to a feature that keeps them, else to the server log. Pictures
  pass through it too.
- **Since 2026-11-12, every kind is optional:** a missing key never stops a start; only the database and the copy's own
  generated secrets may. A type a kind doesn't accept still stops startup. Without premium or economy AI, bots are off:
  `botsMeter` (`packages/bots/src/server/model.js`) gives the meter's pause gate `botsAiOff`'s words, so every bot, the
  Builder, routines and app buttons start no work and say this copy's AI isn't set up and which settings to add; a call
  that still reaches `aiFetch` without its key fails with the same names. Pictures without images stay as above.
- **Every key a copy can be given** is listed once, in `packages/account/src/server/keys.js` (`KEYS`, `keysOf`): the AI
  kinds and every other key, each with what is off without it. Startup logs one line per missing key, and a copy built
  on Mercbot can read the same list.

## D-73 — What work uses is recorded with what it cost; no plans (2026-11-11, 2026-11-12)

There are no plans. What work uses is recorded with what it cost at its providers: every AI call, a bot's computer for
a day and the computation its commands use. D-56's design (docs/usage-tracking-design.md) is built, reworked on
2026-11-12 to be sized for 400,000 people:
- **Every AI call through aiFetch is recorded as its kind** (D-72's one fetch): the kind of AI its work runs on, with
  its work as the purpose. The recorder opens the call before it goes out and finishes it with the provider's own
  figures before handing back the response; a call that fails, is cut or never answers is still recorded, as an
  estimate. Gemini's own figures are read for pictures. Reading a photo for the Vault makes no picture and is recorded
  with what it really cost, like any AI call, for the home it's read in (`/api/w/:home/vault/read-photo`). A call asks
  for pictures when it asks for Gemini's image output; only those are counted per picture.
- **A computer's day** (UTC) is counted once when it starts that day, however often it wakes. Commands' computation is
  counted ten minutes at a time while they run.
- **Counting never stops work.** Mercbot's own recorder (`usage.js`) never holds, pauses or refuses anything. A copy
  built on Mercbot may record work its own way through the optional `mercbot.usage-recorder` capability, which may
  refuse work before it starts (`refuseWork`, a 402 whose message says why); then nothing new starts: replies,
  routines, Apps tasks, goal rounds, group replies, template drafts, teaching, computer wakes and commands all stop at
  their first step, steps already running finish, and the bot says why (`pausedMessage`). Nothing is deleted. A
  routine's run stopped this way isn't a failed run, so it never pauses the routine (D-77).
- **What people see.** Everyone sees what was spent: owners and admins the whole home, members their own use. A bot's
  price tag is this month, with all time on hover. Days and months are UTC's.
- **Built for scale (2026-11-12).** Money is whole nanodollars in bigint: micro-units can't hold a per-token price
  such as $0.006 a million tokens, which is 6 nanodollars a token. Everything people see is read from totals that each
  finished piece of work adds to, keyed by home, bot, person, kind and day (`usage_daily`) or month (`usage_monthly`),
  never by adding up calls. Nothing is kept only in memory, and no request reads across homes.
- **Shard-ready by home.** Every usage table leads with the home (`workspace_id`) in its keys and indexes and has no
  foreign keys; ids don't need one global sequence to be right; archives are written per month and per range of
  homes. Long-term storage will be shards by home (docs/next.md). The one other index is each row's id (per-call
  rows and totals): JSKIT's data layer locks, changes and adds up rows by their ids once their key has found them, and
  without that index the load test found every recording scanning the whole totals table and a goal's spending every
  per-call row.
- **What's kept (amending D-56's answer of three months' detail and hourly totals for good).** Following common
  practice for metering at this size, where per-call detail is billions of rows a year but only matters for checking
  and debugging for days:
  - each AI call's and computer day's own row, 14 days, in daily partitions dropped whole; it isn't archived, since
    at 400,000 people it would be some 30 GB a year compressed for rows no one reads after that window; commands'
    computation has no per-call rows at all;
  - the daily totals, 13 months, in monthly partitions; then each month is written to archive files, one per
    100,000 homes by id, read back and checked against the database, and its partition dropped; the files are kept
    7 years;
  - the monthly totals, for good.
  Row counts and sizes at 400,000 people are in docs/usage-tracking-design.md, from the load test.
- **No plan or tier wording anywhere:** the account menu, Settings and the help centre say what was used and what it
  cost.

## D-74 — Pages are HTML with their own scripts, sealed, and the home's (2026-11-11)

The answers to `docs/pages-design.md`, all as recommended. They amend D-40 and D-63; the design is built.
- **Bots' own scripts are allowed (amends D-63), with nothing loaded from outside.** On save, the pictures,
  CSS `url()`s, fonts, video and sound and `<script src>` libraries a page names by address are copied
  into its `<name>.files/` folder (public internet addresses only, with limits on count, size, kind and
  time) and the page names the copies; what can't be copied is taken out and the bot is told what and why.
  The chat's own pictures are copied in by their `/files/…` path. A page is shown from a page-only address
  with a signed token, under a strict policy (`connect-src 'none'`, `form-action 'none'`, no frames or
  workers), `sandbox allow-scripts`, no referrer and no devices, in a credentialless frame. Mercbot's
  helper runs first, and its `postMessage` messages are checked: from that frame, from no origin, of one
  known shape, and a link or an app only right after the person's click in the page.
- **The rest of the proposals go in:** the bot's own look over Mercbot's, the chat's pictures on pages,
  and writing guidance with its reasons in `packages/bots/skills/pages.md` and save_page's description.
  Pages people answer stay for later.
- **D-66 recheck: "Only you" is dropped (amends D-63).** A page belongs to the home like every file: it is
  in the bot's Pages folder for everyone, and everyone in the home opens it.
- **A page opened on its own runs no scripts.** Mercbot gives a page its key and opens it on its own, without its
  scripts (its policy forbids them and they are taken out, so the page still reads well) and only while its file
  still carries that key (`files.pages.keyOf`, `files.pages.serveOnItsOwn`), for whatever adds an address of its own;
  the Share shows such additions under "Everyone in this home" (`pageShareParts` in `extensions.js`). A person's own
  copy answers its own computer only (D-81), so a page reaches others by being published to their website (D-84).
- **D-40's quiz: the app opens in its own view** through the doorway, never inside the page. The doorway
  opens only an app or view on the home's list, on a screen it has, with only that screen's parameters
  (up to 10 short values); nothing comes back into the page.
- Every save, change with a command and restore is a version (`page_versions`), with Restore, as views
  have. A standalone `.html` copy carries the page's files inside it; there's no PDF (the person prints the
  copy). Old Markdown pages keep working as they are.

## D-76 — See what is spent (2026-11-12)

People see what they are spending, how, and when, with reports. Built on D-73. Reports, charts, the CSV and price tags
read what the work cost at its providers.
- **Reports:** a day, a Monday-to-Sunday week, a month or any range up to a year and a day, in UTC like D-73's
  totals: a chart by day, and totals by kind, by bot and, for owners and admins, by person; members see their own
  use. They read D-73's daily totals, kept 13 months; a whole month older than that reads its monthly totals, kept
  for good, without the chart, and any other range that old is refused, saying to choose the month. The CSV has a
  line per day (per month for such a month), bot, person and kind, streamed a page of totals at a time; a name a
  spreadsheet would read as a formula starts with an apostrophe.
- **Scale (400,000 people):** every report, chart and the CSV read D-73's daily or monthly totals, never each call's
  row. On D-73's 400,000-home load test (docs/usage-tracking-design.md): a typical home's report or CSV under 10 ms at
  p95; a busy home's (90,000 daily totals rows) reports under 0.6 s and its 72-day CSV 12.7 s, streamed.

## D-77 — Lost runs carry on once, and only the server holding a run works on it; codes and coding only on the person's own turn (2026-11-12)

Routines and finishing tasks, checked independently before they merged. This lifts D-59's known limit:
- **Lost runs carry on, once.** A routine's run and a task from Apps (a watch run, a button's hand-off, a finished
  command's follow-up) hold their row with a 90-second lease on the database's clock, renewed every 20 seconds. A run
  whose server stopped is taken over by one server under a new run id and carried on from its saved steps; only the run
  holding the row posts its result, in the transaction that ends it. A run tried three times is given up as failed.
- **Never two servers on one run.** A run stops at its next step as soon as its server can't be sure it still holds it:
  a renewal finds another server took it over, or no renewal has gone through for 50 seconds on the server's own
  steady clock (a paused process, a lost database; a changed system clock doesn't move it). A run stopped so posts
  nothing, counts no failure, and leaves its routine, a one-off too, and its task to the server carrying it on. A
  stopping server gives its runs the drain's time, then stops them and hands each that stops within 5 seconds over at
  once. Known limits: a tool call already under way when the run stops still finishes; a whole machine that is
  suspended (not just its process) can take one more step before its next renewal finds the run gone, though its
  result is still never posted.
- **A routine pauses after 5 failed runs in a row** (docs/usage-tracking-design.md question 4), saying so in its chat
  and how to resume it; resuming it, or a run that works, starts the count again.
- **Connect cards:** once the person signs in from a bot's card, the bot finishes its task by itself, once, for up to
  30 minutes. How it scales was built on 2026-11-12, as recommended (follow a card up when its account's sign-in
  finishes, and keep a slow check as a fallback):
  - **The sign-in starts it.** Pressing the card keeps a waiting row for it (`connect_follow_ups`). The sign-in's
    callback, on whichever server it lands (or a hub's sign-in, once the page finds it finished), marks ready the rows
    its new account reaches, in the transaction that saves the account: a listener that fails rolls the sign-in back.
    That server starts them at once, without any tick. No server reads the rows still waiting for a sign-in.
  - **Once, on one server.** A start claims the chat's reply, then holds the row under the same 90-second lease as a
    lost run, renewed and taken over the same way, and its first run turns the card connected in that transaction, so
    the bot carries on once whichever server, or release, starts it. Only the run holding the row posts its result,
    in the transaction that ends it; a server that comes back after another took its run over posts nothing.
  - **A slow sweep catches what was lost.** Every server, once a minute, starts up to 20 ready rows that no server
    started within 10 seconds of their sign-in (the server that marked them stopped) or whose lease lapsed (its server
    stopped mid-reply), through a partial index of the ready rows; it also removes rows waiting more than 30 minutes,
    and ready ones no server could start or carry on for 30 minutes.
  - **Left as before:** a sign-in that fails, is cancelled or never finishes leaves the card connecting, and pressing
    it again starts the wait again. A follow-up whose chat is busy starts when that chat's reply ends, or a minute later,
    and is closed 30 minutes after its sign-in began. A group's, and one whose chat or bot is gone, is closed.
  - **Measured** (tests/server/connectFollowUps.integration.js, and the old round before it): before, each server's
    5-second round sent 22 statements with 10 cards waiting and 20,020 with 10,000, a round taking 19.5 s; now each
    server's minute sweep sends 4 statements, and marking a sign-in's follow-ups 6, at 10 and at 10,000 alike.
  - **Updating to it:** the migration carried over the cards marked connecting in the last 30 minutes, each checked
    once. The previous release's servers kept their own 5-second check while an update overlapped them; the card's turn
    to connected keeps one follow-up per card between the two. Its index, `ix_bot_messages_connecting`, goes in a
    later release (docs/next.md).
- **Sign-in codes** come only from the person's own connected Gmail or Outlook, only from mail the site sent in the last
  10 minutes, and are typed only into a page of that site. "That site" is the domain the page is registered as by the
  Public Suffix List (the `tldts` package, private suffixes such as github.io included), so two sites under ltd.uk or
  github.io never count as one. The code never reaches the model, the chat, the logs or Activity.
- **Codes and coding only on the person's own turn**, in their own chat with their bot: never in a shared room, for
  another bot, or in a routine or an Apps task, which run without them and which others can set off (a watch reads
  what anyone writes to its app). Coding runs only on that chat's own computer, where only that person signed in, so a
  run spends only their own Claude or ChatGPT account. In the other places the bot uses the secure form for a code, and
  writes a coding brief for the person to start from their own chat.
- **A code goes in by itself only where the person's sign-in led** (decided 2026-11-12 for "one site, many owners":
  type a code only into a page reached from the sign-in the person asked for; otherwise ask the person). A site where
  others can publish (a form on docs.google.com, a SaaS's customer pages) is registered as the same site as the codes
  its owner sends, so no domain rule can tell a sign-in from a page made to collect its code.
  - The bot opens a sign-in with `start_sign_in`, only for a site the person named in their last 10 messages in that
    chat, by its address or its name ("Origin Energy" for originenergy.com.au), and only at the site's front page (the
    domain it's registered as, or its www, with nothing after the slash) or an address the person wrote: a deeper
    page of a site where others publish could be one of theirs. From the front page the bot follows the site's own
    sign-in link. That tab and that address start the sign-in's chain on its computer
    (`packages/computer/src/server/signInChain.js`).
  - The chain holds every page that tab reaches by itself: redirects, forms it posts, links and buttons clicked on it,
    its own scripts, and the popups a page of the chain opens ("Sign in with Google"), on any site. A tab leaves it
    when an address is typed into it or it moves back or forward in its history.
  - The chain ends when the turn that worked on the sign-in ends with nothing waiting on the person (a card, the
    secure form, the screen handed over, a Connect card), 10 minutes after it started, or when the bot opens an
    address itself (`open_web_page`, the secure form reopening its page, another `start_sign_in`).
  - `fill_sign_in_code` types a code without asking only into the page in front while it is in the open chain of a
    sign-in to that page's own site (the chain's first address is registered as the same site), and only a code whose
    sender is registered as that site, as before. A page the chain reached on another site ("Sign in with Google")
    gets that other site's codes only after a yes. The computer checks the chain again just before typing.
  - On any other page the bot posts an approval card, "Shall I type the sign-in code from <sender> into this page?",
    with the page's full address under it, and types nothing until the person says yes; their approval rules never
    answer it. A yes reads the newest code from that exact sender again and types it only while the page in front is
    still at that address; otherwise the chat says why and nothing is typed.
  - Routines, Apps tasks, another bot's requests and shared rooms never get these tools (above), so nothing unattended
    types a code: they use the secure form, which tells the person.
  - The chain lives with the browser, on the server running the computer (D-15): `start_sign_in`, the page check and
    ending it run there, and a computer that restarts, sleeps or moves to another server starts with no chain, so the
    person is asked. Its bookkeeping per navigation is three of Chrome's events and no command to the browser,
    however long the sign-in; each tab costs three commands once, when it opens (`tests/e2e/sign-in-chain.spec.ts`
    counts both in a real Chromium).
  - Known limits: in a group with only the asker, `start_sign_in` reads the person's messages in their own chat with
    the bot, not the group's, so a site named only in the group gets a card. A page the sign-in led to is in the chain
    even when it is one others publish, reached by a link or a redirect from the site's own pages (a search, an open
    redirect), as it would be for the person signing in.

**What a coding run can reach: its project and its sign-in, nothing else (decided and built
2026-11-12).** Claude Code and Codex run with their permission prompts off, so the brief's rules (only this folder, no
pushing, no signing in) are instructions, and a repository's own text could talk a tool out of them. Until then they
ran in the bot computer's own sandbox, beside its browser: they could read the browser profile (the person's signed-in
sites), use the browser's control socket, and change all the bot's files and the home's shared files. Now
(`codingSandbox.js`):
- **A sandbox of its own.** Each run, and each sign-in, is a fresh rootless gVisor sandbox (the command line's pieces,
  `@local/files/gvisor`), deleted however it ends (finished, failed, stopped, out of time or memory, the computer
  asleep, a server draining, a start that failed), with no runsc state or process left. It sees the toolbox
  read-only, the tools read-only at `/opt/coding`, a private 1 GB `/tmp`, the sign-in folder at `/profile/.coding`
  (the tool's `HOME`) and, for a run, the project's folder where the bot sees it (`/files/mine/site`). Not the rest
  of the profile, the computer's `/io` (Chrome's control socket and gateway), the bot's other folders or anything of
  the server; `/files` and `/profile` around its folders are empty and read-only, the sandbox's own, so a project's
  name is never written into the toolbox all sandboxes share. The computer's sandbox no longer has `/opt/coding`.
- **Its own gateway.** No network (`--network=none`); a gateway of its own on a socket in its folder
  (`--host-uds=open`), behind the same forwarder at 127.0.0.1:3128 inside. Chrome's port 9222 is in another sandbox's
  network; the gateway refuses loopback, private, link-local (cloud metadata), CGNAT and the server's own addresses
  and mail ports, so only public addresses are reached (packages, a public repository).
- **Exactly its folders.** Both are given by their link-free real paths (`store.existingFolder`; the sign-in folder
  must be a real folder of the profile). A bot's command, or the computer's own sandbox, could still swap one for a
  link as the sandbox starts, and gVisor would mount where the link leads; gVisor hides inode numbers, so the server
  can't compare them from inside. So the sandbox writes a random mark in each folder and waits; the server opens each
  path without following links, checks it is still that folder, finds the mark through that handle and removes it,
  and only then lets the tool start. Otherwise the sandbox is killed within 20 seconds and the run says it didn't
  start.
- **The sign-in moved too.** It could have stayed in the computer's sandbox, but a run can write anything into
  `.coding`, such as Claude Code settings with a hook that runs at its next start, which in the computer's sandbox
  would run beside the browser profile. So a sign-in opens in an xterm on the screen running a sandbox of its own on
  its terminal, without a project, for at most 30 minutes, one at a time.
- **Limits like a command's:** 3 GB for the whole sandbox (the tool, its tests and builds, its files in memory), as
  gVisor counts it (`runsc events -stats`), read from outside every second; 512 processes, 4,096 open files, 4 GB per file; the run's time (2 hours; 30 minutes for a sign-in),
  also kept inside by `timeout`, so a sandbox whose server died still ends. No limit on each process's address space:
  the tools' runtimes reserve far more than they use. Found building it: the commands' and the command-line
  sessions' 3 GB watch (D-47) read the resident memory of gVisor's own process, which never includes its programs'
  memory (gVisor keeps it in a file only they map), so it never fired; each program's 2 GB limit was the only one.
  All three now read gVisor's count.
- **Kept:** one run per computer; its window following its log (now written by the server into the computer's `/io`
  as a new file with a name that can't be guessed, so a link left there by the computer's sandbox is never followed,
  and read again every half second, since gVisor tells a program inside of no change made outside);
  the last 20,000 characters for the bot; stopping it;
  the report; and the computer staying awake while it works. A computer put to sleep, or a server draining (D-15,
  D-19), stops its run and sign-in and waits until the run's ending is queued as its bot's report before the profile
  is saved; a run cut off by a server dying ends by itself inside, and the next server removes its folder.
- **Measured** on the desktop test host (real gVisor release-20261026.0, systrap, 8 threads; 2026-11-12,
  `scripts/measure-coding-sandbox.mjs`, two runs of five starts each while the host ran other test suites): an idle
  sandbox starts in 211 ms (185–362) and 332 ms (134–483) to the tool's first line. Idle it holds 72 MiB (PSS, each
  shared page counted once: runsc's two processes 11, the gofer 6, the sentry 37, its 12 stubs 19); gVisor's own
  count is 15 MiB. With the real tool started on a stand-in AI address inside that never answers (no account, no AI),
  waiting for its first answer: Claude Code 1.43 GB, of which 818 MiB gVisor's memory file, 19 MiB its processes'
  own and 590 MiB the host's cached program files (shared by every sandbox running the same tool, given back when
  memory is short), gVisor's count 437 MiB; Codex 1.21 GB, of which 220 MiB memory file, 25 MiB own and 966 MiB
  cached program files, gVisor's count 376 MiB. The 3 GB limit reads gVisor's count, which bounds what the sandbox's
  programs hold, not exactly the host's memory: for Claude Code it was about half its memory file.
- **At 400,000 people:** a coding sandbox exists only while a run or a sign-in does, at most one of each per awake
  computer, and a server holds at most `MERCBOT_MAX_COMPUTERS` (3) awake, so each server runs at most three: about
  2.6 GB more for three Claude Code runs beside the computers' own 310–460 MB each, and the tools' program files once
  in its file cache. Coding runs are therefore sized per server, like the computers: about 1 GB more per awake
  computer. A start costs a fifth to a third of a second, and nothing is left between runs.
- **Known limit:** the tool reaches public addresses, so a project's own credentials (a token in its `.git/config`)
  would still let it push; the project's contents are the person's to give it.

## D-78 — The old permission tables go; calculated fields and named formulas (2026-11-12)

Decided 2026-11-11, as recommended: the old permission columns are dropped, and calculated fields and named formulas
are added to Apps.

**The old permission tables go now, the two columns one release later (D-66, D-15).**
- `app_members` and `app_table_editors` are dropped. Their rows only ever
  narrowed what a home's members reach (an app or view for chosen people, a table changed by chosen people), so none
  grants anything D-66 doesn't: everyone they name who is still in the home reaches everything, and someone who has
  left reached nothing even then, since every apps route needs membership of the home. Bots, scripts and visitors were
  never limited by them. Nothing needs carrying over, as D-66 keeps no grants inside a home. No server has read or
  written them since 2026-11-07, so dropping them is safe while the previous release still serves during a deploy.
- `apps.access` and `app_tables.writers` stay one more release. Since 2026-11-08 every release has selected them on each
  read of an app or a table: the data-access port named them in the table resources, and a read selects every column a
  resource names. Dropping them now would break the release that keeps serving while this one migrates and starts, and
  any rollback to it. This release no longer names them; the next one drops them (`docs/next.md`).

**Calculated fields belong to a table, and are worked out on every read.**
- A calculated field is a field of a table with a formula over the same record's other fields, written with their
  names bare as in a filter (`=price * quantity`) and stored by field ids like apps (D-35), so a rename never touches
  it. Its type (text, number, money, date or yes/no) says how it shows; money is rounded to whole cents. It can't be
  required, be a table's title, or be a choice or a link.
- **Computed on read, never stored:** the data gate works it out whenever it reads a record (lists, single records,
  links' records, totals' records, a draft's practice copy), and a form in the browser works it out while the person
  types. So it is always up to date, no write path can set it, and no migration, back-fill or rewrite is needed when
  its formula changes. It has no AnyAPI slot. Writes, buttons' steps and imports never set one; an exported sheet's
  column for it is skipped when imported back.
- It uses only the record's fields (other calculated ones too) and the built-in functions, never an app's named
  formulas or script functions: a table is the home's, shared by every app, bot and the Data tab, so it can't depend
  on one app's definitions.
- **No recursion:** the registry refuses a formula with an unknown field (with the closest name), a function a table
  can't use, a result of the wrong type, or a chain that comes back to the field, naming it (`total → net → total`),
  when a table is made, a field added and a formula changed (the Builder's `field_formula`). A formula that can't be
  worked out at run time (a field it used was removed) shows "—", and so do the fields worked out from it; the removal
  check lists them, and the Builder's `data_tables` marks them needing attention. Each check reads the table's fields
  in its own transaction once it holds the table's row, so two formula changes at once, on one server or several,
  can't store a chain between them.
- **Bounded cost:** it is worked out for every record shown (up to 5,000 for a sum), so it can't use `map`, `filter`,
  `all`, `exists`, `exists_one` (loops over a list, which multiply when nested) or `matches` (a regular expression,
  which can take minutes on one long text); the save check says so by name. A text it works out past 10,000
  characters, the most a text field holds, shows "—", and so does a date field's value that isn't a date.
- **Filters, sorting and grouping by a calculated field are refused, for now:** they run in SQL on stored slots
  (screens' `where`, `sort` and `groupBy`, public tables' `rows`, scripts' and bots' filters). Supporting them means
  translating each formula into SQL over the slots it uses, or filtering and sorting whole tables in memory; that is
  more than this change should carry. The save check, the bots' tools and scripts say so by name and point to the
  fields it is worked out from. A **sum or average** of a calculated field is allowed: the gate works it out from the
  matching records, read a page at a time; it counts them first and, past 5,000, refuses without reading them, with a
  message to filter first.
- Visitors of a public app read a calculated field only when its source fields are in `read` too (it would otherwise
  reveal them), and never write one. The save check refuses one listed without them; since its formula can change
  after the app is published, and an owner's narrowing isn't checked, the visitor fence, the public page and the
  Overview also leave it out whenever its formula, as it is now, uses a field `read` doesn't list.
- During a deploy's overlap (D-15), a server of the previous release takes a calculated field made then for an
  ordinary empty field until it stops; whatever it stores there is never read, as this release's servers name no slot
  for it.

**Named formulas belong to an app.**
- An app's definition has `formulas`: `{ "with_vat": { "params": ["amount"], "formula": "=amount * 1.2" } }`, at most
  30, each with up to 8 parameters. Every formula of the app calls them like its script functions
  (`=with_vat(row.total)`): screens on the server and in the browser, public screens, a draft tried with `app_try`.
  Values go in and out as script functions' do, numbers as doubles.
- A named formula sees only its parameters, the built-ins, the app's script functions and its other named formulas;
  the save check says "a formula sees only its parameters (amount)… pass it in, e.g. with_vat(row.price)" otherwise.
  A call to an unknown name or with the wrong number of values is named plainly ("there is no formula or function
  "with_vatt". Did you mean "with_vat"?", ""with_vat" takes 1 value (amount), not 2") instead of CEL's "no matching
  overload". A formula that calls itself, even through others, is refused with the chain, and a runtime depth guard
  stops one that got past the check. One use of a formula sets off at most 1,000 named formulas: without a cycle,
  formulas that each call the next a few times still multiply (twice a level for 20 levels is a million calls).
  Filters can't call them: they run in the database.
- Their names can't be page names, CEL words, built-ins or the app's script functions. The app's details list them in
  the Logic tab.

**Left open then:** filtering, sorting and grouping by a calculated field; the 5,000-record bound on a calculated
field's sum or average; dropping `apps.access` and `app_tables.writers` in the next release.

**Decided 2026-11-12: keep the limits, and say them up front**, clearly in the instructions, with a warning. Filters, sorting and grouping by a calculated field stay refused, `matches` stays
refused, and a sum or average still covers at most 5,000 records. The Builder's instructions (its rules and the
"Building apps" skill) and the descriptions of `table_create`'s and `field_add`'s `formula` and of `field_formula`
tell it to say so to the person in a sentence whenever it adds a calculated field, and to offer a stored field
instead, filled in on every save by a rule script (and once for the records already there), when the person will
want to filter, sort or group by the value. The help page on calculated fields says it plainly; the Data tab says,
under its search box, which calculated fields search and sorting leave out, and its **Fields** says why a calculated
field can't be filtered, sorted or grouped by. There is no other place a person picks a filter or a sort.

## D-79 — Each bot template's check, and what its badge means (2026-11-12)

How D-43's "tested once end to end, with an honest badge, re-tested when the app changes" is built:
- **The check is one command:** `npm run check:templates [-- <slug> ...]`. For each template a new
  account adds the bot through Mercbot's routes, and an AI-played person (the economy kind) answers
  its setup interview: plain answers, the first option on a question card, and "not yet" when asked to
  start a routine. A template passes when an AI judge (economy) finds every "Ask" step of its setup
  interview was asked (with its reason for each), it has at least as many routines as the template
  describes and none is running, nothing was sent (the test copy's simulated sends, D-69) and no
  draft was marked sent.
  The bot itself runs on the premium kind, as in production. It needs both text kinds (D-72) and
  refuses without them, writing nothing.
- **Results are a committed file,** `bot-templates/checks/results.json`, one result per template:
  the date, the app's commit, the fingerprint of how bots behaved, the template's fingerprint, the
  models, passed or failed, and why. Mercbot reads it once at start. A result is never edited by hand.
- **A badge says "Tested <date>" only while it's still true:** the newest result passed, for the
  template exactly as it is now (its fingerprint: the file's content, whatever its layout), and for
  how bots behave now (the behaviour fingerprint, below). Anything else shows "Not tested yet".
- **The first hand test no longer counts:** it was before the check, by hand, and the template and
  Mercbot have changed since. Every template shows "Not tested yet" until the first real run. A
  template file no longer carries `tested`.
- **Only the Mercbot team's templates have a badge.** A template from anywhere else is never checked
  by the team, and shows none.
- **Templates whose setup needs GitHub connected are skipped** for now (their result stays as it
  was): the check's home has no connected apps.
- **Every template says "ask before anything leaves this chat" in so many words,** checked by
  `npm test`: "Ask before anything leaves this chat" or "Nothing leaves this chat without the
  person's yes". 21 didn't and now do; the rest now use one of those two sentences.
- **The check never reaches anything real:** it refuses `NODE_ENV=production` or
  `SIDE_EFFECTS=live`, and runs on its own copy of the test database with its own folder for files,
  both removed at the end. A bot's own computer isn't gated in a test copy (D-69), so a send from
  its browser isn't heard; the setup interviews don't use it.

Decided the same day:
- **An automatic behaviour fingerprint instead of a hand-raised generation number,** which a
  forgotten raise left stale. `BEHAVIOUR_SOURCES` in `packages/bots/src/server/templateResults.js`
  is the one list of the source that defines how bots behave, in five parts: Mercbot's own rules in
  `instructionsFor` (`botAgent.js`, with `skills.js` and `packages/bots/skills`, whose list the rules
  include); the agent loop (`@jskit-ai/agent` and `@jskit-ai/agent-runtime`, their `src` as
  installed); the setup tools (question cards, memories, skills, routines: `cardTools.js`,
  `memoryTools.js`, `routineTools.js`, `routineSchedule.js`); approvals, drafts and sending
  (`approvals.js`, `botActions.js`, `botTools.js`, whose `attempt` every action passes, `draftTools.js`,
  `mailTools.js`); and the chat kind's provider and model settings (`providers/index.js`, Together's
  layer, `model.js`). `behaviourFingerprint()` hashes every file they name, by its path in the list
  and its content, so it's the same on every server running the same release (D-15); Mercbot works it
  out once at start, and `npm run check:templates` once per run, recording it as each result's
  `behaviour`. A result counts only for the fingerprint it ran on, so any change to those files shows
  "Not tested yet" until the check runs again. `npm test` fails while a path the list names is
  missing (or a provider the chat kind accepts isn't in it); a running copy counts a missing one as
  missing instead of stopping. A file that comes to define one of those parts is added to the list.
  Results already in the file keep their meaning: one recorded under a generation has no `behaviour`
  and counts for no fingerprint.
- **The check runs before each release that changes bot behaviour.** Real AI can't run in a
  release's build, so `npm test` ends with a warning, never a failure, saying how many of the team's
  templates are "Not tested yet" for the current fingerprint (and how many of those failed); and
  `docs/next.md` and `docs/deployment.md` say to run `npm run check:templates` after changing bot
  behaviour and before releasing.
- **The judge's reasons are kept.** The judge gives a reason for each setup question, and a failed
  result keeps it with the check's own reasons ("It didn't ask: … The judge: …"). `templateChecks()`
  answers every team template's newest check (when, the commit, the models, passed or not, the
  reasons, whether the template and how bots behave changed since, and which apps its setup needs);
  no route answers it in Mercbot itself, so whoever shows the checks decides who sees them, and a
  team template's page shows, under its badge, the parts a copy built on Mercbot adds there. People
  see only the badge; the gallery and template pages never carry a check.
- **A stand-in GitHub later** (`docs/next.md`): until then the templates whose setup needs GitHub
  stay skipped.

## D-80 — A home's files in Google Drive: one folder Mercbot makes, mounted like WebDAV (2026-11-12)

Built on D-26 and D-42. Settings → Files offers a third place, **In Google Drive**, beside
Mercbot's storage and the home's own WebDAV storage. As with those, the home's owners and admins choose (D-66).
- **Whose Drive.** One of the Google Drive accounts connected in Connect apps that the person choosing reaches: their
  own, or one of the home's. Someone else's own account can't be chosen. The home's jobs reach the account as the
  person it belongs to. A person's own account can be signed in again only by them; a home's, by its owners and admins.
- **One folder Mercbot makes, not the app folder or a folder the person picks.** Choosing Drive makes a folder named
  `Mercbot – <home>` in that Drive, through Drive's own API, and the bots' files live only in it. Choosing the same
  account again reuses the folder while it's there and not in the bin, even after the home kept its files elsewhere
  meanwhile. This keeps D-26's single folder, and the
  person sees it and can open the files in Drive. Drive's hidden app folder would need another scope and hide the
  files from the person. Letting the person pick a folder would need a picker and could point the bots at any
  of their files. Access is still D-42's full Drive (`https://www.googleapis.com/auth/drive`), since the same account
  serves the bots' Drive tools. Nothing else is asked of Google.
- **Mounted like WebDAV.** rclone's Drive backend mounts that folder, with the same one-second upload delay, listing
  cache and settling before a reply is done and before a server stops. rclone holds no lasting permission. It asks its
  own server for each key, through a route on the server's own port (D-68) that answers only that machine's own
  connections that came through no proxy, with a random key of that mount. The server gives it the account's key for
  at most a minute, renewing it under the account's row lock (D-15), so two servers renew once, and only while that
  Drive is still the home's choice. Each mount checks that choice and the account again every 4 minutes, so a mount
  follows the account, and another server's mount the home left gets nothing, within minutes, at one database read
  per mount every 4 minutes. The account's long-lived permission never leaves Mercbot, and no key reaches a log, an
  error, a file on disk or a bot.
- **A key Drive turns down is renewed at once (decided 2026-11-12).** When the person removes Mercbot's access in
  their Google account, Google stops taking the current key at once, but rclone only asks for a key once its own runs
  out. So the mount reads rclone's log for Drive turning its key down and asks the server for a new one at once. It's
  renewed under the account's row lock and only while it's still the saved key, so of several servers whose mounts
  saw it turned down, one asks Google. A renewal Google refuses signs the account out within seconds, so the Files
  page, Settings → Files and the bots say "Sign in again". A page that found the storage not answering waits up to
  1.5 seconds for that renewal to say so. Each mount asks once per key. A renewal that fails for another reason (Google
  not answering) is tried again after 15 seconds, then twice as long each time, up to 5 minutes. A renewed key reaches
  rclone when its own runs out, within a minute. A mount the home left still gets no key.
- **The folder put in the bin, and space (decided 2026-11-12).** Mercbot looks at its folder (in the bin or
  deleted) and at the Drive's space when Settings → Files opens or saves, and after each renewal of the home's key
  (about hourly, in the background): two calls to Drive, never one per file. It keeps what it saw, nothing secret, for
  the Files page. Settings → Files shows the free space beside the folder. If the folder is in the bin, it says plainly
  that what the bots save goes to the bin with it and that Google deletes the bin's files after 30 days, with
  **Choose again** for owners and admins (the same account again: Mercbot makes a new folder); a deleted folder says
  so too. **Nearly full means less than 1 GB free**: a fifteenth of Google's free 15 GB, and room for forty of the
  biggest files the bots keep (25 MB). Settings → Files then warns, and says plainly when the Drive is full. The home's
  Files page tells everyone in it the same.
- **Sign in again.** A renewal Google refuses (access removed in the Google account, or a testing app's 7-day
  sign-in ran out) signs the account out, as Connect apps shows. The Files page, Settings → Files and the bots then say
  the files are in Google Drive, which needs signing in again, with **Sign in again** for whoever can. The choice and
  the files stay. Nothing is saved anywhere else meanwhile, and a save already waiting on a server goes up once it's
  signed in again. An account removed from Connect apps says so too, and an owner or admin chooses again, without the
  files (see below).
- **Big files and space.** Files of 8 MB or more go up in rclone's resumable 8 MB parts. The upload limit stays at
  25 MB a file. Space is the person's Google quota: when Drive is full, Google refuses the upload and the save waits
  on the server, tried again later, as with full WebDAV storage (not yet tried against a full Drive). Deleting a file
  puts it in Drive's bin.
- **Saves lost with their machine (accepted 2026-11-12).** A save waiting while the account is signed out
  stays on that server's disk. Machines are disposable (D-19), so one that stops before the person signs in again
  loses it, as with WebDAV storage that is unreachable.
- **Google's review.** Full Drive access is a restricted scope (D-42): until Google's security review of the Google
  project a copy uses (D-27), its app stays in testing, for up to 100 hand-added test users, whose sign-ins run out
  after 7 days, so a home's Drive asks to sign in again weekly.
- **Every switch moves all the files (decided 2026-11-12: an overwrite, all the files moved across each
  time).** Saving another place in Settings → Files (Mercbot's storage to a Drive, a Drive to Mercbot's
  storage, one person's Drive to another's, WebDAV either way) starts a move. rclone copies every file of the home to
  the new place and makes it an exact copy: what's there is overwritten, even a file of the same size and time, and
  what isn't the home's is removed (to the bin, in a Drive). The home switches only once the copy is checked: the
  number of files and their bytes on both sides, and each file's checksum where both give one (Drive and Mercbot's
  storage do; WebDAV compares sizes). A copy that differs is copied again, up to three times. The switch is one write
  under the home's row lock. Saving the same place again (a new WebDAV password) moves nothing. **Choose again** for a
  folder in the bin moves the files out of it into the new folder; a folder deleted for good has nothing to move.
- **One move per home, on any server (D-15).** The move lives on the home's file_storage row: where to (its settings
  sealed with the vault key), its stage and counts, and which server holds it, by a 60-second lease it renews every 10
  seconds. Starting a move and taking one over both happen under that row's lock, so a home has one move at a time,
  run by one server. Every 30 seconds each server looks for moves whose lease ran out and carries them on from their
  last stage, so a move outlives the server it started on. Checking whether a home is moving costs nothing
  extra: the files already read that row.
- **Read-only meanwhile.** While a move runs, the home's files can be read but not changed: saves, uploads, renames,
  deletes, new folders, ticked checklists, the office apps' saves and commands are refused with "Moving this home's
  files to the storage it chose: they're read-only until that's done, usually in a few minutes." The bots say so in a
  line. Settings → Files shows where from and to, and the files and bytes copied so far. The Files page tells everyone
  in the home. The bots' computers are put to sleep when it starts, wherever they run, and one that wakes meanwhile has
  no files. A command that started before the move is waited for (at most its 30 minutes), then the copy is checked
  again. Files kept in a Google Drive or WebDAV storage first get 15 seconds for saves already on their way through
  other servers' mounts to land (rclone's one-second upload delay and 10-second listings); Mercbot's own storage has
  no such delay.
- **The old copy.** Once switched, a person's Google Drive folder goes to that Drive's bin, where Google keeps it 30
  days, and is never deleted for good. Mercbot's own old copy is deleted. A WebDAV copy stays: it's the home's own
  storage.
- **Cancelled or failed.** Owners and admins can cancel a move until it switches. A move that's cancelled or fails (a
  full Drive, a file rclone can't copy) leaves the home on its old storage, unchanged, and Settings → Files says why.
  What it copied goes to the Drive's bin, or is deleted from Mercbot's storage; a WebDAV copy stays, and the next move
  overwrites it. Files that can't be read where they are (a Drive to sign in again, removed, or whose folder was deleted
  for good; WebDAV not answering) can't move: Settings → Files says why, with **Switch without the files**, which
  leaves them there, as every switch did before.
- **Cost.** rclone's reads and writes follow the files moved: into a Google Drive, each file is looked up by name once
  and uploaded once (rclone's Drive upload, which updates a file of that name rather than making a second), plus a
  listing per folder. Mercbot's own work is per move, not per file: a database write every 10 seconds, no row and no
  extra Drive call per file. A 1,000-file home makes the same Drive calls beside those as a 100-file one.
- **Proven** against a stand-in Drive that is also the stand-in for Google's sign-in (tests only, never in production):
  a real FUSE mount, the two-server renewal, the refused renewal, a key Drive turned down renewed at once (through
  rclone's own log) and once across two servers, the folder in the bin, the space, and the screens in a browser. The
  moves with rclone's own copy and check (no FUSE): Mercbot's storage to a Drive, Drive to Drive and back, the old
  copies, writes refused meanwhile, a 1,000-file home, a server killed with its rclone mid-copy and another carrying
  the move on, a cancelled move, a full Drive, and a command started before the move.

Not built:
- **Linked copies.** A copy that borrows a hub's Google sign-in (D-31) gets its Drive keys from the hub. If the hub's
  renewal is refused, the copy's account still shows as connected, so its bots get errors instead of "Sign in again".
  Recommended: have the hub's refusal sign the copy's account out, as a direct sign-in's does.

## D-81 — A person's own copy is single-user, opened with its key (2026-11-12)

Decided: Mercbot on a person's own computer has one person and no sign-in, registration, invitations, members or mail:
it opens with a secret key, as Jupyter does. The same code and data model run as in a copy built on Mercbot that serves
many people; only the screens and routes for accounts, members, invitations and signing in are hidden or refused.
- **Every copy** (since 2026-11-13). Mercbot refuses to start unless `HOST` is `127.0.0.1` or `::1`; a copy built on
  Mercbot that serves many people starts its server without the gate (`gate: false`) and leaves the single-user package
  out. Its first start makes the one person, `you@mercbot.localhost`, named after the computer's user, who runs the
  copy (`mercbot.copy-runners`, so they may choose a folder on its computer for a home's website, D-84). Their home is
  made the first time they open Mercbot, by JSKIT's own first visit as for anyone, not at the first start.
- **A key instead of a sign-in:** 32 random bytes as 64 hex characters in `<MERCBOT_DATA_DIR>/mercbot.key`, mode
  600, outside every release, made on the first start. A key file others may read, or one holding no key, stops the
  start, naming the fix. `mercbot open` writes a page only the person can read (`<MERCBOT_DATA_DIR>/open.html`) that
  takes the browser to `/open?key=…`, so the key is on no command line. The server compares the key in constant time
  and exactly (other letters are another key), signs the person in with JSKIT's own sessions, sets the key's cookie
  (`mercbot_key`, HttpOnly, SameSite=Strict, 400 days) and moves to `/` from its own page, so the Strict cookie goes
  along. A request with the key's cookie whose session ran out is signed in again. The person's password is derived
  from the key and nobody types it: `mercbot new-key` writes a new key and restarts Mercbot, which changes the password
  and ends every session signed in with the old key. The key stays in the browser's history, as Jupyter's does.
- **One gate in front of everything.** Mercbot's HTTP server checks every request and websocket before Fastify,
  Socket.IO, the live screen or the browsers' bridge sees it (`packages/single-user/src/server/gate.js`):
  1. The Host is `localhost`, `127.0.0.1` or `[::1]` on the server's own port, so another site's name pointing at
     this computer (DNS rebinding) gets 421.
  2. Routes that prove themselves go through: the health check, which says only that the server is up; another
     server's work, the bots' browsers and Google Drive mounts, each with its own key (D-68, D-80); a page's sealed
     frame (D-74), whose address carries its own signed token, since the frame is credentialless and sends no cookie;
     and the providers' return from Connect apps, which its OAuth state proves.
  3. `/open` with the key.
  4. A change (any method but GET, HEAD and OPTIONS) and every websocket come from Mercbot's own page: an Origin of
     `http://<the Host>`, beside JSKIT's CSRF token, or 403.
  5. Everything else carries the key's cookie, or gets 401 and a plain page: "Open Mercbot with `mercbot open`."
  6. Sign-in, registration, sign-out, passwords, security settings, invitations and changes to members answer 404.
     Members and roles stay readable, so the screens that show the home's one person work.
- **Public routes, on one computer.** Nobody but the person reaches the copy, so nothing is public. Public apps,
  pages shared by link and their visitors' sign-in need the key like everything else: the person sees them, and
  visitors from elsewhere can't reach this computer anyway. Connect apps' providers return to the callback, which
  goes through on its OAuth state; it answers a small page whose link back is the person's own navigation, so the
  Strict cookie goes along. The bridge to a hub (D-31) is outbound only and needs nothing here.
- **The screens:** the account menu and Settings → General have no Sign out or Add another account, and Settings
  has no Home section (members and invitations). About says to update the copy with `mercbot upgrade`.
- **Proven** by tests that break each rule on the server listening on loopback: no cookie, a wrong key, the key in
  capitals, another Host, another Origin, a websocket (Socket.IO's and the live screen's) without the cookie, and a
  start with a non-loopback `HOST`; and in a browser from `mercbot open` to a bot's first reply. Since 2026-11-13
  every browser test, and Vibe64's Preview (`tools/preview-identity`), opens Mercbot with its key as `mercbot open`
  does, with no development sign-in.

Amends D-65 (an http loopback `APP_PUBLIC_URL` in production while `HOST` is loopback) and D-68 (the hosting script
for a person's computer, `scripts/hosting/local.sh`).

## D-82 — The sidebar's account button shows the person's own picture (2026-11-12)

Decided: the account button at the bottom of the sidebar (and in the rail) shows the person's profile picture when
they have one, and their initials otherwise, as JSKIT's account settings bar already showed it. "Has one" means a
picture they uploaded in account settings, served by `GET /api/settings/profile/avatar`. JSKIT's bar shows a Gravatar
address for everyone else (Gravatar's own default silhouette, for most people), which isn't a picture they gave
Mercbot, so the sidebar keeps their initials then, and asks Gravatar for nothing. The picture comes from where JSKIT's
bar reads it, the user in the placement context, so it costs no request of its own, and it follows a change or a
removal in account settings as soon as the person comes back, with no reload. A picture that doesn't load shows the
initials. The Settings → General account row and group chats' cluster avatars still show initials (`docs/next.md`).

## D-83 — A test copy's AI is the stand-in model, never a real provider (2026-11-12)

Decided: in a copy that isn't live, AI goes to Mercbot's stand-in model, never a real provider, and nothing in the
product may silently depend on a real call failing. Until then the Test Preview gave each kind of AI its provider and a
key no provider accepts, so a new bot's welcome (its greeting and first question), every bot reply and a picture went
to the real providers, were refused (401) and fell back or said so, and the browser suites expected those refusals.
- **The stand-in for every kind:** `MERCBOT_TEST_AI_URL` names a stand-in model's address. Outside production and the
  live copy (D-69) every kind of AI sends there, under `/<kind>`, with its provider's model, list prices and needs but no
  key, no balance and no billing page; `aiFetch` refuses any other address before a request goes out, so nothing can
  reach a provider. Startup needs no key then. Production and the live copy ignore the setting and behave as before.
- **Every Test Preview runs on it** (`tools/previewAi.mjs`, from `start-test-app.mjs`): Mercbot's stand-in
  model (`tools/standInModel.mjs`) is served on a local port, as the stand-in for Google Drive is. It
  answers Mercbot's own writing in the shape asked for (a new bot's greeting and question card, a status line, which
  rules apply), plays a template's setup interview, says any other reply runs on a stand-in model, draws a small
  picture and reads any photo as one made-up contact. The template check's database test uses it too; the
  `--import` preload is gone, since every Test Preview has it.
- **Proof:** `tests/server/testPreviewAi.integration.js` starts the app with the Test Preview's AI, refuses any request
  for a provider's host, and walks a new bot's welcome: the stand-in answers both calls, and none reaches a provider.
  The browser suites now expect the stand-in's answers instead of the refusals.
- **Every Preview too, since 2026-11-12** (decided: Previews and test copies use stand-ins for AI and outside
  services, never real ones). `server/lib/develop.js` empties every setting shaped like an outside service's
  credential (`withoutCredentials`) and runs the same stand-in, so a key in the development settings reaches no
  provider from a Preview. Both files moved to `tools/`, so a composed copy keeps them. `npm run check:templates`
  still runs a test copy on the real AI on purpose, and refuses the stand-in.

## D-84 — A page can be published to the person's own website (2026-11-12)

"Anyone with the link" needs Mercbot reachable from elsewhere, which a person's own copy isn't (D-81: it answers its
own computer only). So a page can also go on a website the person already has, as a copy they publish, publish again
and unpublish. The design is `docs/pages-design.md`, "Publishing to your own website"; it is built.
- **A home's Website, set up once** in Settings → Website: where pages are uploaded, either a folder on this computer
  that a web server already serves or S3-compatible storage (an endpoint, empty for Amazon S3, a bucket, its region, an
  optional folder in it, and an access key with its secret), and the address that place is served at (the base URL).
  Mercbot checks the place before saving: the folder is there and it may write in it, or the bucket answers to the
  keys. Where it uploads, keys included, is sealed with the vault key, as a home's own storage is (D-26, D-80); the keys
  are never shown again (left empty, the saved ones stay for the same endpoint), never in an answer and never logged.
  One per home (`home_websites`).
- **What goes there is the page as it opens on its own (D-74):** without its scripts, with Mercbot's look,
  as `<base URL>/<slug>/index.html`, with the files of its folder that it loads beside it at the same addresses. Since a
  website's server sends none of Mercbot's headers, the page carries that policy itself (a meta tag): the site's
  own files and inline styles; no scripts, requests, forms, frames or workers; no referrer. An SVG picture goes inside
  the page as data, since opened on its own from a website an SVG runs its scripts there; no script file is carried; a
  copy carries at most what a save copies in (60 files, 40 MB).
- **Its address:** the page file's name as a slug (lowercase letters, digits and dashes, with -2, -3… when another page
  of the home has it), chosen at its first publish and kept when the page moves or is renamed.
- **Publish, Publish again and Unpublish** are in the page's Share, under its link, with the address, Copy and Open.
  Publishing again replaces the copy, and the files it no longer has go; Unpublish takes it away. A page moved in the
  home's files keeps its place; a page deleted is taken off the website, as its link ends (D-74). A deleted bot's or
  home's publications are forgotten with it; their copies stay on the website.
- **Nothing Mercbot didn't put there is touched:** each copy carries `.mercbot-page.json` with its publication's random
  id, and Mercbot replaces or removes a folder only when it holds that id. A publish whose address already holds
  anything else is refused (409 `websites_place_taken`), and the person's folder stays as it was. While pages are on
  the website its place can't change and it can't be removed (409 `websites_pages_published`); its address and keys
  can.
- **The first publish to a new Website asks first** ("Publish to your website?"), since it puts the page on the
  internet; a new place or address asks again. The server refuses an unconfirmed first publish (409
  `websites_confirm_first`).
- **The address is checked:** after each upload Mercbot reads the page back at its address and looks for the copy's own
  stamp. When nothing answers, the answer is an error (such as 404) or it's another page, the Share says so plainly,
  naming the address and asking whether the base URL is where the web server serves that place.
- **Who (D-66):** a page there reaches outside the home as its link does (D-74), so only the home's owners and admins set
  the Website up and publish (403 `websites_manage_forbidden`, refused before anything else is looked at); anyone in the
  home unpublishes, since narrowing is instant. A person's own copy has one person, who owns it (D-81).
- **A folder on this computer is for the people who run the copy (D-59):** Mercbot writes there with the server's own
  rights, so only they (`mercbot.copy-runners`; on a person's own copy, its one person, D-81) choose a folder, refused
  to anyone else before anything about the website is looked at (403 `websites_folder_forbidden`); anyone else's
  website is S3-compatible storage. Settings offers the folder only to them; a home's admins publish to a folder one
  of them chose.
- **Anyone else's website is on the internet:** for a website saved by someone who doesn't run the copy, Mercbot reaches
  the storage, and reads pages back, only at public internet addresses, through its own guard against the network it
  runs in (`@local/account/public-address`, as scripts' web calls and pages' copied files). An endpoint or address on a
  private network (a private, loopback or link-local address, a cloud's metadata address, or a name leading to one) is
  refused when the website is saved (403 `websites_storage_private`, `websites_address_private`) and at every upload
  after; a read-back that leads to one, by its name or a redirect, says so (`websites_check_private`). Who saved it is
  kept in its sealed settings, and a website saved again by someone else is theirs from then on; one that doesn't say
  counts as not saved by those who run the copy. Their own websites reach any address, as before.
- **Not a test copy's send (D-69):** publishing writes to the person's own folder or storage at their own confirmed
  request, as a home's own file storage is written, so it works in every copy. A bot never publishes.
- **One part a composition can leave out:** the server's side is the package `@local/websites` alone (its feature,
  routes and both tables, which its own `migrations/constraints/` makes after the app's, since a publication names a
  bot), and the screens' is one file, `src/components/mercbot/websiteParts.js` (Settings → Website and the Share's
  row). A composition leaves it out by dropping the package from its manifest and replacing that file with
  `export default { settingsSections: [], pageShare: null }`.
- **Proposed, not built: the page's own scripts on the person's website.** The copy runs none, as by its link. Running
  them would put a bot's code on the person's own domain, beside whatever else it serves (that site's cookies, its other
  pages, a sign-in), with no sandbox, since a page can't set its own `sandbox` the way Mercbot's headers do.
  Recommendation: keep them off; if they're wanted later, only to a website on an address of its own (a subdomain only
  for pages), said plainly in Settings → Website.

## D-85 — A copy built on Mercbot may say where bots' computers run (2026-11-13)

Mercbot runs each bot's computer on the server that needs it, and several servers pass a computer's work to the one
holding it (D-15). A copy built on Mercbot may want its computers on servers of its own instead, such as bigger
machines kept apart from the ones serving pages, without changing how a computer works. It gets one seam for that, and
Mercbot's own behaviour is unchanged without it.
- **The seam:** an optional capability, `mercbot.computer-placement` (`ComputerPlacement` in
  `packages/computer/src/server/types.js`). Its `choose(computerId, servers)` names the server for a computer that no
  live server holds, from the live servers, each with how many computers it holds awake (`servers.live()`); null
  means none can take it,
  and the call says "No computer can start right now. Try again in a minute." (503 `computer_none_free`). Its
  `secret` is what servers sign their calls to each other with, in place of the one Mercbot keeps in
  `mercbot_settings`.
- **Everything else stays as D-15 has it:** the computer is taken for the chosen server in the same one statement, it
  wakes there again while that server lives, its work and its screen are passed there, and a server that doesn't
  answer counts as gone at once, after which the computer is placed again, once, and wakes where it's placed with its
  saved browser (D-19, D-50).
- **A relayed screen is signed too:** a server relaying a live screen to the server holding it sends the same header
  as its calls (`x-mercbot-internal`).
- **Without the seam** a computer goes to the server that needs it, as before (`PLACE_HERE`, a placement like any
  other); one server, or several, works as it did.
