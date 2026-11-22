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
  and screens close so pages reconnect to another server. *Since 2026-11-13 live
  streams and screens close and every computer is saved first, while requests in
  progress finish, and no computer starts there again; routine runs and background
  work get their 20 seconds after. Puppeteer and Stagehand reach a browser through
  the server's own port (D-68), so the server's close waited for them, and computers
  left to be put away after it never were.*
- Pages retry sends and replies that were cut off (about 15 seconds in all) without
  doubling them, and catch up after reconnecting.
- Servers find their own private address; `MERCBOT_SERVER_URL` overrides it.
- Later: JSKIT's file storage for profile pictures moves off the local disk. *Done
  2026-11-11: they're on the files volume with bots' files (`genesis/program/files/files.md`).*

## D-20 — Office apps on every server, bot files on JuiceFS (2026-10-25)

*Since D-91 (2026-11-18), bots' files are in an S3 bucket Mercbot reaches itself, with no JuiceFS volume and no FUSE.*

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

*Amended by D-112 (2026-11-22): what a bot makes goes in its chat's folder, /files/chat; the bot's folder and the
home's stay.*

A person's files can belong to one bot only, or be shared with all of that person's
bots; there is a choice between the two.

How it was built (2026-10-25). Bots use the apps without a window: each reply starts the
apps it needs inside a bubblewrap sandbox with no network that sees only the bot's own folder
at /files/mine and the person's shared folder at /files/shared. Files a bot saves appear as
file cards under its reply. The viewer shows pictures of the pages, which every browser can
show, phones included, with a download. The bot moves a file between the two folders to share
it or make it private. Each server mounts the volume with `scripts/mount-files.sh`, and a
marker file tells the server the volume is really mounted. Servers that start together against a
new database format it once: each checks and formats while holding a PostgreSQL advisory lock
(2026-11-15). *Since D-47 there are three
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

*Superseded by D-112 (2026-11-22) for its three modes, the home notebook, each person's own conversation and what bots
remember about a person: chats are Public or Private, and a home's bots are its members as its people are. Homes,
their roles and their one person on a person's own copy stand.*

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
    have a name. The bar for this screen is "the cleanest UI ever done". The bot's line in the list
    shows its newest reply in any of its tabs, whichever is open (2026-11-20, D-99). The name chip and
    the tabs sit on a band of the page's background, solid down to the tabs' lower edge, so the chat
    never shows through them (2026-11-20).
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
- **Connected accounts and app keys can belong to a person or to the whole home.** (Superseded by
  D-111 on 2026-11-21: every connected account is its home's.) When
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

*Amended by D-112 (2026-11-22): a summary is by chat, one for a chat several bots share, and the Builder's
conversation for an app is a Public chat of its own (`conversations.app_id`).*

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

*Superseded by D-112 (2026-11-22), except that bots aren't permission and the request limits: a group is a chat with
any of the home's people and bots, the one reading rule replaces a group's own reach, and an asked bot works on the
brief alone and answers in the asking chat. Step 3 is closed by D-115: bots talk together on a Discuss card in a
chat, with no bots-only threads and no company chart.*

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

*Amended by D-112 (2026-11-22): the three folders are the chat's (/files/chat, in place of /files/mine), the bot's and
the home's, and a bot has a computer of its own in each chat.*

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
routine and what it has cost over time, with a screen as good as the rest of the app. Changed on
2026-11-20 (D-73): no bot shows a price; what each bot cost is in Settings → Spending's totals by bot.

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
  the first-run slides. Links are built by JSKIT's paths, never by hand. *D-106 changes it for an app: the button is
  the app's close, named for where it goes, which leaves in one click.*
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
above) still refuses, and links still never come from a Host header. Since 2026-11-15 (D-87), staging and production
(`APP_ENV`) refuse, not `NODE_ENV=production`.

## D-66 — Nothing is private inside a home; public apps are the only boundary (2026-11-07)

*Amended by D-112 (2026-11-22): a chat can be Private, opened only by its people; apps, tables, views, connections
and the vault stay the whole home's.*

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
  *Since 2026-11-19 x11vnc is never given `-localhost`, which only limits TCP and so adds nothing to `-rfbport 0` and
  `-rfbportv6 -1`: x11vnc (nixpkgs' 0.9.17, which a store host's machines get (D-86), Ubuntu 26.04's and 24.04's) holds
  the Unix socket's clients to it as well, names each "localhost" rather than 127.0.0.1 and refuses it right after the
  version exchange, so no live view showed on a real store host. A browser test reads a real screen's pixels through
  noVNC and checks that x11vnc listens on no TCP port.*
- **Its own namespace:** `scripts/serve.sh` and `npm run develop` run Mercbot through `scripts/namespace.sh`, in a
  user and mount namespace of its own, where it mounts the files volume and people's storage as that namespace's
  root. The mounts are seen only inside it. With `MERCBOT_SANDBOX_USER` (D-51, outside Vibe64) it stays in the host's
  namespace as before.
  *Since 2026-11-19 every xterm Mercbot opens on a bot's computer (the dock's Terminal, a coding run's progress, a
  coding tool's sign-in) runs in a user namespace of its own as the host's own user and group, the ones Mercbot's
  namespace maps its root to (`MERCBOT_UNSHARE --user --map-user --map-group`). Started as the namespace's root, xterm
  gives its program root's groups (initgroups) before starting it, which a user namespace refuses, so the program never
  started and the window closed at once ("Cannot chown /dev/pts/N to 0,5"), with nixpkgs' xterm 410 (a store host's)
  and Ubuntu 26.04's 407 alike: the Terminal never opened on a store host or on Vibe64. A test starts xterm as Mercbot
  does in its namespace, with a real Xvfb, and checks that its program starts.*
- *Since D-91 (2026-11-18) nothing mounts: bots' files are in an S3 bucket and people's storage goes through rclone's
  remote control, so the Stack asks only for `gvisor`, and no host is asked for `/dev/fuse` or a `fusermount3`.*
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

*Since 2026-11-15 (D-87), `APP_ENV` decides in place of `SIDE_EFFECTS`: production is the live copy; development,
test and staging are test copies, and JSKIT's line and tab name the environment.*

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

## D-73 — What work uses is recorded with what it cost; no plans (2026-11-11, 2026-11-12, 2026-11-20)

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
- **What people see.** Everyone sees what was spent: owners and admins the whole home, members their own use. No bot
  shows a price (2026-11-20): what a bot cost is read in Settings → Spending's totals by bot, a report people open on
  purpose, never beside the bot. Each bot had a price tag in the sidebar, this month with all time on hover, shown from
  2026-11-19 only while the pointer was over the bot or it had keyboard focus; people complained, and the owner had it
  taken out with its route (`GET …/spending/bots`): "Users complained about having the cost of each bot on each bot.
  Please get the cost out of each bot. It's unnecessary and inappropriate to see." This changes D-56. Days and months
  are UTC's.
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

People see what they are spending, how, and when, with reports. Built on D-73. Reports, charts and the CSV read what
the work cost at its providers.
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

*Amended by D-112 (2026-11-22): codes and coding are on a person's own turn in any chat, not only their own chat with
the bot; never in a routine, an app's task or work another bot asked for.*

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
  `SIDE_EFFECTS=live` (*since D-87, `APP_ENV` staging or production, and runs its copy as `test`*), and runs on its own copy of the test database with its own folder for files,
  both removed at the end. A bot's own computer isn't gated in a test copy (D-69), so a send from
  its browser isn't heard; the setup interviews don't use it.

Decided the same day:
- **An automatic behaviour fingerprint instead of a hand-raised generation number,** which a
  forgotten raise left stale. `BEHAVIOUR_SOURCES` in `packages/bots/src/server/templateResults.js`
  is the one list of the source that defines how bots behave, in five parts: Mercbot's own rules in
  `instructionsFor` (`botAgent.js`, with `skills.js` and `packages/bots/skills`, whose list the rules
  include); the agent loop (`@jskit-ai/agent` and `@jskit-ai/agent-runtime`, their `src` as
  installed); the setup tools (question cards, memories, skills, routines: `cardTools.js`,
  `memoryTools.js`, `routineTools.js`, `routineSchedule.js`; *since D-112, question cards, a template's notes document
  in the chat's folder, skills and routines: `cardTools.js`, `skillTools.js`, `routineTools.js`, `routineSchedule.js`,
  memories and `memoryTools.js` being gone*); approvals, drafts and sending
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
  live copy (D-69; *since D-87, outside staging and production*) every kind of AI sends there, under `/<kind>`, with
  its provider's model, list prices and needs but no key, no balance and no billing page; `aiFetch` refuses any other
  address before a request goes out, so nothing can reach a provider. Startup needs no key then. Production and the
  live copy ignore the setting and behave as before.
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

## D-86 — The toolbox can come from a host's read-only Nix store (2026-11-15)

Some hosts start applications only from a read-only Nix store: the application and the packages it asked for are in
the store, their commands are on `PATH`, and the writable folders may forbid programs (`noexec`). Mercbot's toolbox is
an Ubuntu system it builds with apt (D-47, D-70), which such a host neither allows nor needs. Mercbot gets one seam for
it, and is unchanged without it.
- **The store's toolbox:** with `MERCBOT_TOOLBOX_STORE` (the store, such as `/nix`) and `MERCBOT_TOOLBOX_DIR` set,
  `scripts/serve.sh` makes the toolbox at every start as a small system of links to the store's programs found on
  `PATH` (`storeToolbox.js`), and every gVisor sandbox sees the store read-only at its own path, where the links lead.
  The folder holds only links and settings files and nothing is started from it. It must still be where programs may
  run: gVisor mounts it again, read-only, as each sandbox's system, and in Mercbot's own user namespace the kernel
  refuses a mount that drops the host's `noexec` (found by the proof on a host with a `noexec` `/tmp`), so the start
  refuses such a folder. For the same reason every folder a sandbox sees now keeps `nosuid` and `nodev`, and the
  display's sockets `noexec`. Making the toolbox again at each start takes seconds (1.3–3.4 s with a store of 12,800
  packages) and leaves nothing to keep between releases or machines (D-19).
- **Nothing is switched off quietly (D-68):** without a browser, `python3` or `bash` in the store, computers couldn't
  start, so the start stops, saying so. Bots are told what their command line has, so it's offered only when every
  one of those tools is there; otherwise the start names what's missing and bots work without a command line. The
  sandboxes are the same as on any host: every bot program still runs in gVisor (D-47, D-49).
- **Found, not listed:** programs come from `PATH`, the first by each name whose real file is in the store; fonts from
  the store's packages (`share/fonts`), which hold only what the host was given. Mercbot names no host and no package
  list of its own: the host's declaration chooses the packages, and docs/deployment.md says which nixpkgs ones a
  computer needs.
- **Launchers stay as they are:** the computers' browser and dock launchers are still scripts written while Mercbot
  runs, so such a host must give Mercbot a temporary folder and a data folder where programs may run.
- *Since D-92 (2026-11-19), such a host's release brings its downloads: `npm run tools:install` with its hosting script
  installs them where the release is built, and never the toolbox or the desktops' programs.*

## D-87 — APP_ENV says where a copy runs; only production sends (2026-11-15)

JSKIT 0.2.84 replaced `SIDE_EFFECTS` with `APP_ENV` (`development`, `test`, `staging` or `production`), which takes
over every decision `NODE_ENV` made; `NODE_ENV` now only picks optimised builds. Mercbot follows it, on JSKIT catalog
0.2.86. This replaces D-69's `SIDE_EFFECTS` rule: a copy whose `APP_ENV` is `production` is the live copy; in
`development`, `test` and `staging` it is a test copy, as D-69 describes one. A host that publishes copies to check
them gives them `staging`, so they send nothing for real; a copy for real use sets `APP_ENV=production` with
`NODE_ENV=production` and no `SIDE_EFFECTS`.
- **A copy says where it runs, or doesn't start:** `resolveRuntimeEnv` asks JSKIT (`assertAppEnvironment`) before
  anything else, so a start without `APP_ENV`, with an unknown one, with `SIDE_EFFECTS` set at all, or in staging or
  production without `NODE_ENV=production` stops with JSKIT's words, naming the fix. Code that asks where it runs
  with an environment that names none (`appEnvironment`, `isStagingOrProduction`) throws, never guesses.
- **Only production sends (D-69's list, unchanged):** what bots send from connected accounts (`sendOrSimulate`) and
  scripts' web calls other than GET (`webAccess.js`) act only in production. Development, test and staging log each
  one with JSKIT's line (`logSideEffect`: "Test: … was logged, not sent.", "Staging: … was logged, not sent: only
  production acts for real.") and answer as if it went out. Staging logs a connected mailbox's email too, as JSKIT
  logs every connector write there, rather than sending it to `STAGING_EMAIL_TO`: it would go out from the person's
  own account. Mercbot sends no email of its own, so it needs no `STAGING_EMAIL_TO` or `STAGING_SMS_TO`.
- **Development shortcuts stop at staging:** what `NODE_ENV=production` turned off now follows JSKIT's
  `isStagingOrProduction`: the stand-in model (`MERCBOT_TEST_AI_URL`, D-83), the stand-in Google Drive
  (`MERCBOT_TEST_GOOGLE_DRIVE_URL`, D-80) and a test copy's own template results (`MERCBOT_TEST_TEMPLATE_RESULTS`) are
  ignored there, as before. The https rule for `APP_PUBLIC_URL` (D-65) and `AUTH_LOCAL_EMAIL_CONFIRMATION=false` by
  default hold in staging and production. Staging always had `NODE_ENV=production`, so it behaves as before.
- **Where each run says it runs:** `npm run develop` sets `development` whatever `.env` says, as JSKIT's development
  launcher does, and the `dev` scripts run `APP_ENV=development vite`; `jskit test` sets `test`, and so does every
  Test Preview (`start-test-app.mjs`), as JSKIT's browser test servers do. `npm run check:templates` refuses where
  `APP_ENV` is staging or production and otherwise runs its copy as `test` (D-79). `.env.example` sets `development`.
- **What people see:** JSKIT's tab at the top of every page now names the environment ("Development", "Test" or
  "Staging"; none in production) where it said "Test copy".

## D-88 — Who hears when computers run out of room, and which servers Mercbot knows (2026-11-15)

A server keeps a few computers awake at once (`MERCBOT_MAX_COMPUTERS`). When a wake finds every place taken, Mercbot
puts the least recently used computer that isn't busy to sleep to make room, or, when every one stays busy for 90
seconds, refuses the wake; with nowhere to place a computer, it refuses at once (D-85). Whoever runs the servers wants
to see this happening, and how full the servers are, to know when to add one. Mercbot gets one seam and one read for
it, and behaves as before.
- **The seam:** an optional capability, `mercbot.computer-events` (`ComputerEvents` in
  `packages/computer/src/server/types.js`). Its `record` gets each `made_room` (the computer put to sleep, on the server
  holding it) and each `refused` with why: `computer_none_free` (no server could take it, on the server asking) or
  `computer_all_busy` (every computer on its server stayed busy). Nothing waits for it, and its failure is only
  logged, so a wake is never slower or refused because of it.
- **Without the seam** each is a line in the server log (`LOG_COMPUTER_EVENTS`): a made room as information, a
  refusal as a warning.
- **The servers Mercbot knows:** `mercbot.computer`'s `servers()` answers every server seen in the last day, with its
  address, when it was last seen, whether that was in the last 45 seconds and how many computers it holds that
  aren't asleep: one read of `mercbot_servers` and the live servers' count (D-15), so a feature can show them without
  reading Mercbot's tables.

## D-89 — Programs made for an ordinary Linux system start on the store's toolbox through nix-ld (2026-11-16)

The office apps, Piper (voice memos) and Claude Code are pinned downloads built for an ordinary Linux system (glibc's,
such as Ubuntu's): each asks for its loader at `/lib64/ld-linux-x86-64.so.2` and its libraries in the system's
folders, which a toolbox made from a read-only Nix store (D-86) doesn't have, so on such a host they couldn't start and
their features were off. A host that can't install anything must keep them (D-68), with the same pinned versions and
sums. Building them from nixpkgs isn't that (no Craft apps there, another Piper, other Claude Code and Codex
versions), and taking them from the host's own system would bind its libraries into every sandbox at whatever versions
it has. So the store gives them a loader and the libraries they need, named, and they are otherwise as everywhere.
- **The loader:** with `nix-ld` and glibc's `ld.so` on `PATH` (nixpkgs' `nix-ld` and `glibc`), the store toolbox
  links `lib64/ld-linux-x86-64.so.2` to nix-ld and puts glibc's loader and the libraries where nix-ld looks when
  nothing names another place (`run/current-system/sw/share/nix-ld/lib`), so no sandbox sets anything for it. nix-ld
  starts the program with the store's glibc loader and those libraries, then gives it its own environment back before
  it runs (an unset `LD_LIBRARY_PATH` comes back empty, which glibc's loader ignores), so nothing it runs inherits them.
  The store's own programs never go through it. Without either, the start says the office apps, voice memos and coding
  tools can't start, and their features stay off as on any server without them.
- **Libraries named, not found:** `MERCBOT_TOOLBOX_LIBRARIES` names the folders (in the store, separated by `:`), and
  the first file of each name wins; a folder that isn't one in the store stops the start, naming it. What these
  programs need, read from them: gcc's runtime libraries (`libstdc++.so.6`, `libgcc_s.so.1`) for all of them, Claude
  Code needs only glibc, and Codex is a static program run by Node; on a computer the office apps' windows also load
  sound, X11 and its keyboard, Vulkan and EGL (docs/deployment.md lists the packages).
- **Software drawing:** a computer has no GPU, so the office apps draw with Mesa's software drivers, as in Mercbot's own
  toolbox. `MERCBOT_TOOLBOX_MESA` names Mesa's folder in the store, and its lavapipe Vulkan manifest and EGL vendor
  file go where the desktop sandbox tells Vulkan and glvnd to look (`DESKTOP_GRAPHICS`, `gvisor.js`); each names its
  library at its store path. A Mesa without both stops the start, naming the one it lacks.
- **The programs themselves** still come from `npm run tools:install`'s pinned downloads, or from the same downloads
  put in the tools folder by whatever builds the host's release; the store gives them only what an ordinary system
  would have.

## D-90 — A copy built on Mercbot may check every picture and video before it's kept or sent (2026-11-17)

A copy built on Mercbot may need to check the pictures and videos people and bots bring into it before they're kept,
shown or sent on, and to keep a few files of its own where nothing serves them. Mercbot checks nothing itself and
behaves as before; it gets one seam for the check, one folder for such a copy's files, and stricter settings for the
pictures it draws.
- **The seam:** an optional capability, `mercbot.media-check` (`MediaCheck` in `packages/account/src/server/types.js`),
  which the account and files features read. `check(item)` gets a whole picture or video (`bytes`), its type as its own
  first bytes say (`mime`), where it came from (`origin`: `upload`, `picture`, `vault_photo`, `profile_picture`,
  `screenshot` or `saved_file`), whose it is (`workspaceId`, `userId`, `botId`, `conversationId`), where it would be kept
  (`path`, and since 2026-11-19 `place`: for an upload or a file a bot saved, the files place that path is in, an
  opaque JSON-safe copy a checker may keep and give back; null for every other origin) and the address of the request
  that brought it (`ip`); `checkText(item)` gets what a picture is asked to
  show (`origin: "picture_prompt"`). Each answers `{ verdict: "allow" | "block" | "unavailable", notice?, ref? }`:
  `notice` is the sentence the person sees instead of Mercbot's, and `ref` the checker's own reference, which
  Mercbot only logs.
- **What a file is** comes from its first bytes (`sniffMedia`, `@local/account/media-check`), never its name or what a
  browser said: JPEG, PNG, GIF, WebP, BMP, TIFF, HEIC, HEIF, AVIF and icons; MP4, M4V, MOV, 3GP, WebM, Matroska, AVI,
  MPEG, Ogg video, FLV and ASF. Any other ISO media file, an MPEG-4 sound included, could hold a video, so it's checked
  as one. Only pictures and videos reach the checker; every other file is kept as before.
- **Fail closed:** a checker that throws, or answers no verdict, counts as `unavailable`, logged in one line without the
  file. Nothing that couldn't be checked is let through as if it had been.
- **Checked on the way in:** an upload to a bot's files or the home's (read whole, up to its 25 MB, before anything is
  written), a photo the Vault reads (before the images AI sees it) and a new profile picture (before it's written).
  Blocked, the route answers 422 `media_blocked`, "This file can't be used."; not checkable now, 503
  `media_check_unavailable`, "This file can't be checked right now. Try again in a few minutes."; and nothing is kept.
  The chat's attachments and the file browser show that sentence. *Since 2026-11-22 (D-114) a file a person attaches in a chat,
  with other people in it or not, goes in the chat's folder and is checked as theirs in that chat
  (`conversationId` the chat, `botId` its first bot or none).*
- **Pictures a bot makes:** `make_picture` checks what's asked for before anything is drawn, and each picture before
  it's kept or shown. One not allowed is neither, and the bot says so in one line (the checker's sentence when it gave
  one); the others of the same request are still shown. Either way the reply isn't sent back to make a picture.
- **Checked afterwards:** the screenshots a bot's reply shows people (the last four under it and a hand-over card's)
  and the files a bot's turn saves (every file its commands change included, however many, found by
  `store.changedSince`) are too many to hold a turn for, so they're checked within minutes. Each picture or video
  among them waits in `media_checks` (one row: its home, origin, where it is and whose): a shown screenshot queued
  once the reply's turn is over (`run.close()`), after it was written, and a turn's saves once they're settled. Every
  server sweeps every 20 seconds, taking up to 25 rows whose time has come through the database (`SKIP LOCKED`,
  D-15) and holding them for five minutes while it checks them three at a time; a screenshot's row comes due 30
  seconds after it's queued. A blocked file is removed (a removed screenshot answers as missing); one that can't be checked
  now waits a minute, then twice as long each time, up to half an hour; a file gone by then just leaves the queue.
  A file bigger than 100 MB can't be read whole to check, so it's removed. Files stay where they are meanwhile.
  Without a checker nothing is queued and no sweep runs. *Since 2026-11-19 only the screenshots a reply shows are
  queued, by that reply, where every screenshot a bot's computer took was queued before it was written: a copy that
  checks pictures wants the ones people see, not every frame its bots look at. The others are kept unqueued and
  unchecked, as without a checker. A shown screenshot is now queued after it's written, so it's on the volume
  unqueued for the rest of its turn; one that can't be queued isn't shown (the screenshots under the reply go, and a
  hand-over card shows none), and a routine's run that posts nothing queues nothing.*
- **Removed later (2026-11-19):** a copy that lets a file through and judges it afterwards, in a review of its own,
  removes one it judges against its rules with `files.media.remove(item)`, giving back `{ origin, place, path,
  conversationId, workspaceId }` as its check gave them. An upload's or a saved file's is removed from its place as
  the sweep removes one: writing, so it waits while the home's files move (D-80), then the home's files are settled.
  A screenshot's (`path` its name, `conversationId` its computer) is removed from its computer's folder, which is then
  settled. It answers `"removed"`, or `"gone"` when the file isn't there any more (a link in the place is no file
  kept there); and `"not_kept_here"`, doing nothing, for a Vault photo (never kept), a picture a bot makes (checked
  before it's kept, with no place) and a profile picture (JSKIT's, removed through its users service). A path outside
  its place, through a linked folder too, is refused (400 `files_path_outside`), and so are a place missing or in
  another home than the item's (`media_place_invalid`) and a name that isn't a computer's screenshot, or a computer
  that isn't an id (`media_screenshot_invalid`).
- **A copy's own folder:** `files.store.privateFolder(name)` makes and answers a folder of the copy's own beside the
  store's folders on the shared volume (mode 700), outside every person's, home's and computer's folders, so no route
  serves it and no sandbox mounts it. Its name is a short lowercase word with hyphens, never one the store uses; while
  the volume isn't there it answers 503 `files_unavailable`.
- **Pictures drawn more strictly:** Gemini draws with each harm category its API takes (harassment, hate speech,
  sexually explicit, dangerous content) at `BLOCK_LOW_AND_ABOVE`; what it won't draw stays a "blocked" picture, as
  before. Reading a photo for the Vault is unchanged: it makes no picture, and the photo is checked first anyway.
- **A person's own conversations:** `records.makers.conversationsOf(userId, workspaceIds, limit, options)` answers, in
  one statement through the homes' index, the person's own conversations in the homes named, latest activity first:
  only `{ id, botId, workspaceId, createdAt, lastActivityAt }`, never a title or a message. A system context's options
  reach every home, a request's its own.

## D-91 — Bots' files in an S3 bucket, with no FUSE (2026-11-18)

Bots' files were on a JuiceFS volume (D-20) and people's own storage on rclone mounts (D-26, D-80), both through FUSE,
which a host must give (D-68) and many don't. Mercbot now keeps its files in an S3 bucket it reaches itself, and
people's storage through rclone's remote control: nothing mounts, and nothing needs `/dev/fuse` or JuiceFS.
- **Any S3 store:** AWS S3 or any store speaking its API (Garage, MinIO, R2 and the like), reached path-style at
  `<endpoint>/<bucket>/<key>`, which they all answer, with requests signed by aws4fetch (the signer JSKIT's storage
  uses) and files sent and fetched as streams (`packages/files/src/server/s3Bucket.js`).
- **Settings:** `MERCBOT_FILES_S3_BUCKET`, `MERCBOT_FILES_S3_REGION`, `MERCBOT_FILES_S3_ACCESS_KEY_ID` and
  `MERCBOT_FILES_S3_SECRET_ACCESS_KEY`, with `MERCBOT_FILES_PASSPHRASE`. `MERCBOT_FILES_S3_ENDPOINT` is optional (AWS's
  for the region by default), and so is `MERCBOT_FILES_S3_PREFIX`, which puts every key under a folder of the bucket.
  With any of the five missing, files stay in the files folder as before, and the start names each missing setting
  (keys.js, "Bots' file storage"). `MERCBOT_FILES_DIR` is optional: where the files folder is. Without a bucket it is
  still a folder the host shares between servers, which must hold the `.mercbot-files` marker (D-19).
- **A working copy on each server:** each server works on a copy of what it uses in its files folder
  (`MERCBOT_FILES_DIR`, else `<data folder>/files`), so the routes, the sandboxes, the office apps and the desktops
  keep working on real folders (`syncedTree.js`, `filesVolume.js`). The bucket is the truth every server shares. A
  folder is pulled before it's read (again only once its last pull is a second old, and at once when a file asked for
  isn't there), and what changed here is pushed when it's settled (D-19: before a reply is reported done, when a
  command ends, after a profile picture, a computer's screenshot or saved browser, or a command's output is written,
  and before a month of usage leaves the database), every 5 seconds, and when the server stops. A change made here
  and not yet pushed wins at the next pull; between servers, the last one pushed wins. A folder is an empty object
  named with a trailing `/`. Links aren't kept in the bucket: a link a bot made stays on its server. Pulls and pushes
  in one place (a home, a computer, a conversation's outputs) run one at a time.
- **Sealed before it leaves:** every file is sealed on this server before it reaches the bucket (`filesCipher.js`):
  AES-256-GCM in pieces of 64 KiB, each piece's nonce its number and whether it's the last (the STREAM construction), so
  a piece changed, moved, dropped or cut off fails to open. Each object has its own key, made with HKDF from one random
  files key and the object's own random salt. The files key is kept in the bucket as `.mercbot-files`, sealed with a
  key made from `MERCBOT_FILES_PASSPHRASE` (scrypt), so a server needs only the passphrase, as with the volume. Sealing
  here rather than asking the store to (SSE-S3, SSE-C) means the store's owner never holds a readable file, and it
  works the same on every S3-compatible store.
- **One key for every server:** a server that finds no key record makes a files key and offers its record to the
  database (`files_keys`, one row a bucket, named by a digest of its endpoint, name and prefix): PostgreSQL keeps the
  first offer, every server, of those starting together too, takes the kept record and writes it to the bucket (the
  same bytes each time, a plain write), so servers that start together on a new bucket agree on one key on any store
  speaking the S3 API. The database decides rather than the store: some stores ignore a conditional write
  (If-None-Match), and some refuse it, 501 NotImplemented (18 Nov 2026; on such a store the earlier write-if-new and
  read-back-after-3-seconds left the bucket with no key at all). A passphrase that doesn't open the record keeps the
  bucket off, and the log says why.
- **The files folder is the server's own:** in a bucket's case it's emptied when the server starts using it, since what
  was there was pushed when the server stopped, or is from a server that stopped without it. A folder holding files
  Mercbot didn't put there is never emptied: the bucket stays off and the log says to empty it or name another.
- **People's own storage:** a home's WebDAV or Google Drive storage is reached through `rclone rcd`, rclone's remote
  control, one per home on each server that needs it (`remoteMounts.js`): the home's folders are a working copy here,
  pulled before they're read and pushed every 2 seconds and when settled. Drive's keys come from this server's route as
  before (D-80), and a home whose Drive needs signing in again keeps its saves here until it's signed in.
- **The usage archive** (D-73) is written in the files folder too: the files feature hands its working copy
  (`files.volume.sync`) to the account's sweeps (`mercbot.account.sweeps`, `useFilesSync`), so retention pushes a
  month's archive to the bucket before the month's rows are dropped, and finds old months in the bucket, whichever
  server archived them, to delete them.
- **The Stack** declares the bucket as a resource (`files`, of kind `bucket`) binding the bucket, region, endpoint and
  the two keys to the names above, lists `MERCBOT_FILES_PASSPHRASE` among the Generated secrets, and asks the sandbox
  for `gvisor` only. `npm run tools:install` no longer installs JuiceFS or a `fusermount3`, `scripts/serve.sh` mounts
  nothing, and `scripts/mount-files.sh` and `npm run files:mount` are gone.
- **Limits:** a server's working copy is not trimmed yet: what it pulled stays until it restarts. A home's folders are
  pulled whole the first time they're used on a server. Saves a home's Drive is waiting for (signed out) are lost if
  that server restarts before it's signed in again. A JuiceFS volume's files aren't moved to the bucket by Mercbot:
  they must be copied by hand.

## D-92 — A store host's release brings its downloads, never a toolbox (2026-11-19)

A host whose programs come from a read-only store (D-86) makes the bots' toolbox from the store at every start, and its
desktops' programs are the store's. Its release is built somewhere else, with the host's packages, and its folder is
all the host takes of it, so the downloads its servers run (rclone, Piper, the Craft apps, the coding tools and
gVisor, D-89) must be in that folder. `npm run tools:install` refused such a host outright, so a release built for one
ran the Ubuntu host's install, which built the Ubuntu toolbox (2.2 GB, about 7 of a build's 9.5 minutes) and could obtain
desktop programs that no server there reads: the first release built for such a host came to 4440 MiB, past the
4096 MiB its builds may keep (18 Nov 2026).
- **Downloads only:** the hosting scripts gain `host_store_toolbox`, true only for `scripts/hosting/store.sh`
  (`lib/ubuntu.sh` answers false for Ubuntu and Debian). With it `install-tools.sh` installs the downloads as
  everywhere, through the tools' store (D-70), skips `build-toolbox.sh` and the desktop programs, and removes a
  `.tools/toolbox` or `.tools/desktop` an earlier install left. The same release came to 2167 MiB.
- **Checked where it runs:** the install's first check is `namespace.sh --check-install`, the host's whole check except
  on a store host, whose servers are checked by `scripts/serve.sh` when they start (the store, the toolbox's folder,
  gVisor, namespaces and the display programs), since the install for it runs where its release is built.
- **Unchanged:** an Ubuntu host's install, the store toolbox (D-86), and `build-toolbox.sh`, which a store host still
  refuses, as it does obtaining desktop programs. A store host unpacks rclone's Debian package as Ubuntu does.

## D-93 — Apps connected with a home's API credentials, and who each person is there: Sedna, reads only (2026-11-19)

Sedna (sedna.com), a shared email for shipping teams, has no sign-in for other apps and no connection point of its
own: an admin of the Sedna organisation makes API credentials (a client ID and secret) on its API Credential Management
page, and an app gets an hourly key for them by OAuth 2.0 client credentials at
`https://<tenant>.sednanetwork.com/platform/oauth/token` (developers.sedna.com). That key may read the whole
organisation, every team's inbox (the docs don't say a credential is limited to its maker's teams; D-94), so connecting
it is the home's, not one person's, and what a bot reads depends on who asks.
- **A third way of connecting, `credentials`:** beside `oauth` (D-31) and `mcp` (D-34), a plugin.json may declare a
  `credentials` block: the `kind` of credentials (`packages/integrations/src/server/credentials.js`, Sedna's in
  `sednaCredentials.js`), the `fields` its form asks for, the help on where to make them and a link to that page.
  Connect apps shows the form ("Enter API credentials") in place of a sign-in tab, and posts it to
  `POST …/plugin-accounts/:accountId/credentials`. The values are checked with the app before anything is saved (a
  key is made, `GET /company/me` names the organisation, which labels the account, and the home's people are matched
  by email address), then sealed in `plugin_accounts.tokens` with the key. `accessToken()` makes a new key from them
  when the last one runs out or the app refused it, under the account's row lock as a renewal is (D-15); the app
  turning the credentials down signs the account out, for an owner or admin to enter them again. Disconnecting clears
  them. The hub never lends them (each copy keeps its own, D-31): signing in to such an app, here or through the hub,
  is refused. The kind is generic; only Sedna's is built.
- **The home's, from its owners and admins:** `home: true` makes the app's account the home's (D-37). Only the home's
  owners and admins add it (a member's Connect is refused, and the page says who connects it), enter or change its
  credentials and disconnect it; every person of the home then sees it connected.
- **Sedna's address is fixed:** the tenant is one DNS label (letters, digits and dashes; a pasted address is cut to
  it), and the host is always `<tenant>.sednanetwork.com`: nothing typed can point Mercbot anywhere else. Bots call
  the address integrations builds from the credentials, never one Sedna's answers name (an events page's next link
  gives only its cursor). Outside staging and production only (`isStagingOrProduction`, D-87),
  `MERCBOT_TEST_SEDNA_URL` points every tenant at the stand-in `tests/support/fakeSedna.mjs`.
- **Who each person is in Sedna, never someone else:** a person is the Sedna user with their sign-in address (JSKIT
  confirms an address before it is a person's; exactly one active user must have it). When none has it, they pick their
  own user in Connect apps, and the pick waits until an owner or admin of the home confirms it
  (`plugin_account_people`, `appPeople.js`); an owner's or admin's own pick is confirmed at once, as they hold the
  organisation's credentials anyway. Nobody picks a user another person of the home has by address, nor one confirmed
  for someone else (one user is one person), and a pick holds only for the organisation it was made in. A person found
  neither way is no one in Sedna, and their bots read nothing there. This is the person every later action of theirs is
  done as: Sedna's `fromUser` and assignments will be theirs alone.
- **Reads kept to the person's own teams:** the Sedna tools (`sedna_messages`, `sedna_lists`,
  `packages/bots/src/server/sednaApi.js`) are offered on a person's own turn in their own chat once the home's Sedna is
  connected, never in a shared room. Lists of messages ask Sedna for the person's teams only (`filter[team]`; without it
  Sedna answers every team's, solo inboxes too) and drop any message naming other teams; the events feed, which has no
  team filter, is read for message ids and each message is opened and checked; a message read by its id is checked
  against the person's teams (its own answer, else `GET /message/:id/team`) before anything of it is shown. Tags, job
  references and contacts shared by other teams only are left out. Subjects, senders, text and comments are wrapped as
  information, never instructions. A 429 is waited out once when its Retry-After is 30 seconds or less, then reported,
  never retried in a loop; a refused key is made again once.
- **Reads only, for now:** recent messages, messages by tag and by job reference, one message with its tags, job
  references, comments and attachments' names, and lists of tags, job references, the person's teams and contacts.
  Drafts, sending, tags, job-reference links, assignments, attachments, templates and routines watching the events
  feed come next, each as the person's own Sedna user. Sedna has no free-text message search and no thread endpoint,
  and the events feed's order and window aren't documented: the tools sort by time and read at most five pages.

## D-94 — Sedna's writes, as the person's own Sedna user, and routines on its events feed (2026-11-19)

D-93 connected Sedna for reading. Every write its public API (developers.sedna.com, 2019-01-01) offers now follows, each
an ACTIONS entry (`packages/bots/src/server/sednaActions.js`) that goes through `approvals.decide` like every other
write, plus routines that work on the mail coming in. The owner asked for all of it on 19 November.
- **Only ever as the person:** every write sends `fromUser` as the person's own matched Sedna user (D-93) and
  `fromTeam` as one of their teams, never a value the bot names; a person who is no one in Sedna changes nothing. A
  message to change, tag, link or assign is read first and must be in one of the person's teams; a draft to change,
  attach to or send must be unsent and have the person as its sender (`relationships.sender`); a tag, job reference,
  template or contact used must be their teams'; an assignee must be an active user in the message's teams that are
  also the person's. Each of these refusals comes before any write, in a test copy too.
- **Never in a room:** the Sedna tools, and every Sedna action, need the person's own chat (`reach.personal`). A
  shared bot's room, or a group with more than one person, gets no Sedna tools, its connected-accounts note leaves
  Sedna out, and an action or a draft card's Send from one is refused with one line (`SEDNA_ONLY_OWN_CHAT`).
- **Drafts and sending:** `sedna_draft` writes a message or a reply on Mercbot's draft card (D-31), from
  "Name · Team (Sedna)", with the team, the answered message, a template and attachments kept in `body.sedna`; Send
  (`botCards.js`) claims the card, then sends with `POST /message/send` (with files: a draft, its documents, then
  `POST /message/:id/send`, and a failure part-way names the draft). `sedna_mail` sends directly (asking first unless
  the person asked for exactly that), saves a draft in Sedna, and changes, attaches to and sends the person's own
  drafts. Sedna's API has no field for answering a message, so a reply is a new message to the original's sender, with
  "Re:" and their message quoted below; the card, the tool and the help say it may show outside Sedna's thread.
  `SEDNA_REPLY_FIELD` in `sednaChanges.js` is where a real answer field goes once Sedna documents one. The tool asks the
  bot to write in the person's own style (their writing-style skill).
- **Sorting, assigning, attachments, templates, contacts:** tags and job references put on and taken off; a job
  reference is made only when the person asks for a new one (Sedna's 409 on a name already there finds that one);
  assigning tells the colleague, so it asks unless the person asked in so many words, and there is no unassign
  endpoint. Attachments are saved into the bot's files from Sedna's signed link (`GET /download/document/:id`; its
  307 is followed only to https or the API's own origin, without Sedna's key, 25 MB at most) and added to a draft by
  Sedna's base64 upload (10 MB each, 5 a message); the zip download isn't used. Templates are read and a draft starts
  from one (its own attachments aren't added). Contacts are read, and added or changed only when asked (a change reads
  the contact and puts it back whole, as Sedna's PUT replaces it). Message comments stay read-only: the API has no
  write endpoint for them.
- **Which ask first:** sends (`sedna_mail.send`, `send_draft`) and assignments reach other people, so they ask unless
  the person asked for exactly that; tags, job references, drafts and attachments can be undone and ask only by a rule.
  Work another bot asked for never counts as the person asking (D-46).
- **Real only in production, tags included:** every Sedna write goes through `sendOrSimulate` (D-69), so only a copy
  with `APP_ENV=production` changes Sedna, and any other copy logs it after every check a live copy makes. Unlike a
  label in the person's own mailbox, a Sedna tag or job-reference link is a change to the organisation's shared
  mailbox that the whole team sees at once and that can set off Sedna's own workflows, so a test copy connected to a
  real tenant must not re-sort the live inbox. Downloads into the bot's files are reads and run everywhere.
- **No blind retries, no idempotency keys:** Sedna offers none. A refused key (401) is made again once, and a 429 is
  waited out once when it says 30 seconds or less: Sedna did nothing then. A change Sedna didn't answer (no reply in
  60 seconds, or a 5xx) is a `SednaUncertainError` and is never tried again by Mercbot: the bot says it may have gone
  through, and the draft card goes back to waiting with "check Sent in Sedna first". The card's claim
  (`pending` → `sending`) stops a second press sending twice.
- **Routines on the events feed:** in a routine's run, `sedna_inbox` reads `event.message.received` from where the
  routine's last good run got to, kept in the new `bot_routines.feeds` (by account, `sedna:<id>`: the page's cursor and
  the events of it already handled). Its first run starts from `GET /event/latest`, so older mail isn't new; mail older
  than the routine is skipped. Each message is opened and kept only if it's in the routine owner's teams. A run hands
  at most 10 messages, opening at most 30 and reading at most 10 pages, and says when more came: the next run carries
  on from there, so nothing is dropped. The position is written only by the server holding the run, as the run ends
  well (with its post, or quietly with `nothing_new`); a failed run reads the same events again and may tag or draft
  twice. In a routine every send and assignment always asks (`approvals.decide(…, { strict: true })`) unless an allow
  rule matches, a routine never sends a draft card, and a job reference or contact isn't made.
- **One unlabelled home account per app:** two owners adding Sedna at once each found no home account and made one.
  A partial unique index on `plugin_accounts (workspace_id, plugin_id) WHERE workspace_id IS NOT NULL AND name = ''`
  makes the second lose the insert race, and `installForHome`'s `retryLostInsertRace` then finds the first. The
  migration refuses a home that already has two, naming it and the fix, before it changes anything.
- **Credentials as Basic auth too:** Sedna's docs let one API credential be used two ways, the OAuth
  client-credentials token (recommended) or HTTP Basic with the client ID as username and the client secret as
  password, so a username and password another program uses with Sedna's API are that credential's client ID and
  secret, and the form's help says so. Mercbot asks the token endpoint first; when it turns the pair down, the pair is
  tried once as Basic on `GET /company/me`, and if Sedna takes it, the account keeps the whole `Basic …` header as its
  key, checked again hourly as a key is made again (`sednaCredentials.js` mint). Every call sends the key as it is
  stored: a bearer token, or that header. Turned down both ways, the credentials are refused as before; a 403 there is
  Sedna taking them without COMPANY_READ, which Connect names.
- **Permissions, by the docs' names:** each endpoint's page says "Required API Permissions", and the OAuth scheme
  lists the same names. Reading needs COMPANY_READ (`/company/me` at Connect), USER_READ and TEAM_READ, MESSAGE_READ,
  EVENT_READ, CATEGORYTAG_READ, JOBREFERENCE_READ, COMMENT_READ, DOCUMENT_READ, TEMPLATE_READ and CONTACT_READ;
  changing needs MESSAGE_WRITE (drafts, sends, tag and job-reference links, assignments, attachments), MESSAGE_DELETE
  (taking a tag or job reference off), JOBREFERENCE_WRITE and CONTACT_WRITE. A permission missing at Connect is
  named in the refusal.
- **Whose the credential is, not in the docs:** they don't say whether an API credential acts for the organisation or
  as the admin who made it, seeing only their teams; nor whether a `fromUser` naming another user is credited to that
  user or needs a permission (the only word is that `fromUser` "is mandatory for API users", which reads as the
  credential being no person of its own). Mercbot needs neither: every write names the asking person's own user, every
  read keeps to their teams, so a credential seeing only its maker's teams gives other people less, never more. The
  first connection to a real tenant (reads first, then one send by someone other than the maker) settles it. A client
  ID's shape isn't documented either, so the tenant is still typed, never taken from the ID.
- **Not in the docs, to check on a real tenant:** the events feed's order and how long it keeps events, and whether
  `/event/latest`'s next link is the cursor after it; whether a draft's answer carries `relationships.sender` and a null
  `sentAt`; the id in the answers to `POST /message` and `/message/send`; that `base64Content` upload works without
  the upload URI; whether tags and assignments made with the API show the API user; `PUT /contact` replacing the whole
  contact; templates' team relationships.

## D-95 — A bot's own instructions, in its Details panel and on a card the bot shows (2026-11-19)

`bots.instructions` held a bot's always-on instructions only when it was added from a template (D-43), and nobody
could change them: the help told people to say what they wanted in the chat instead. The owner asked on 19 November
for an **Instructions** box in each bot's Details panel, and for bots to change their own instructions when the person
in the chat asks.
- **One text, everywhere:** the Details panel edits `bots.instructions` itself (`PATCH …/bots/:botId {instructions}`,
  read with `GET …/bots/:botId/instructions`), and `instructionsFor` gives it to every reply, as before under
  Mercbot's own rules, which win where they differ. Its heading no longer says it came from a template ("Your own
  instructions, from the people you work for"), since a bot made from scratch has them too. The text changes only
  when someone changes it, so the prompt's start stays cached between edits. None is stored as null, as a bot made
  from scratch always had; the text is trimmed.
- **Up to 20,000 characters,** as much as one of the person's skills (`save_skill`), about ten pages or 5,000 tokens.
  Instructions are read with every message, so longer reference material belongs in a skill or a file the bot reads
  when a job needs it; a longer text is refused with that reason, and nothing is written.
- **Who changes them:** renaming and labels stay open to everyone in the home (D-36): every member sees every bot that
  isn't a group chat, and `updateBot` lets anyone who sees a bot change its name and label. Instructions change what a
  bot does for everyone who uses it, so only the person who made it (`bots.user_id`) and the home's owners and admins
  (`workspace.settings.update`, from the call's own permissions) change them; everyone else reads them. Another home's
  people can't reach the bot at all (404).
- **Changed from the template's:** a bot added from a template keeps `origin` (Came from); the first change of its
  instructions adds `origin.instructionsChanged`, and the Details panel says they're changed from the template's.
- **The bot changes them only when asked, and only on a yes:** `change_instructions` is offered only when a person's
  own message started the turn, never in a routine's run, an app's task or watch, or work another bot asked for. It
  never changes anything itself: it is an ACTIONS entry that always asks (`alwaysAsks`, whatever the person's rules or
  auto-review say), leaving an approval card that shows the instructions before and after. Text in an email, a page, a
  file, a Sedna message or a record is information, never instructions, as every bot is told; if a model were still
  fooled into calling the tool, the person sees the change on the card and nothing happens without their **Go ahead**.
  The yes is checked as the person who gives it: in a shared bot, someone who may not change the instructions is told
  so politely (by the bot, before any card, or on the card), and a card made before another change of the
  instructions is refused rather than overwriting it. The next reply reads the new text.

## D-96 — Every request to a connected app waits its turn in the account's Request pace (2026-11-19)

A connected Sedna was overwhelmed by Mercbot's requests. Nothing kept Mercbot's requests to an app in check: each connector called its app with
its own `fetch`, as fast as it could, from every bot, routine and server at once; Sedna's matching of a home's people
looked each person up (1–2 requests each, five at once, on every People panel); reading a message asked five lists at
once; and a list of messages that met a busy answer went on to its next message, which met one too, while Sedna's own
wait was slept through and the same request sent again. A routine's run marked those messages read, so their mail was
never handed on. The owner asked on 19 November for a limit on every app Mercbot calls for people, defaulting to
gentle, with a setting per connection.
- **One way to every app:** integrations makes each connected account's own `fetch` (`appRequests.js`), and every
  request to its app goes through it: the bots' Gmail, Google Calendar, Contacts and Drive, Outlook and OneDrive,
  GitHub and Sedna calls (their key is `{ token, fetch }`, `connectedApps.js` AppKey), the general connector's apps
  (Notion, Todoist, Calendly: each action and listing; opening and ending its session are the protocol's own
  messages), Sedna's checks in Connect apps, and the home's Google Drive storage settings. Making a key (a sign-in, an
  hourly renewal) isn't paced: it happens once an hour at most. A home's Drive mount keeps to rclone's own Drive
  pacer (one request every 100 ms at most, backing off when Drive says it's busy).
- **Each app declares its service's limit** in plugin.json, `limits: { requests, seconds, source, says }`, from the
  service's published documentation (Google Contacts publishes none: one request a second is assumed). A test refuses
  an app that reaches a service without one; an app without one is paced as one request a second.
- **Request pace, per connection:** Gentle uses a tenth of the limit, Normal four tenths, Fast nine tenths. Half of that
  share may go at once (a search and the messages it found), the rest is spread evenly over the limit's window, so no
  window ever holds more than the share. Gentle is every connection's until someone chooses another, and the pace of
  every connection made before this one: `plugin_accounts.pace` is null for them, which is Gentle. Who may change the
  connection chooses it in Connect apps (`PUT …/plugin-accounts/:accountId/pace {pace}`): a home's, its owners and
  admins; a person's own, that person. Sedna, for example, allows 100 requests a second per key or address: Gentle
  sends at most 10 (5 at once, then one every 200 ms), Fast at most 90 (45 at once, then one every 23 ms: each turn's
  spacing is rounded up to a whole millisecond, as it's kept).
- **Shared by every server (D-15):** each account's next turn is a row of `plugin_account_turns`, taken under the
  row's lock; a request waits its turn after the lock is let go. A turn more than 20 seconds off isn't taken: the app is
  busy for that request.
- **A busy answer holds the account off on every server, for as long as the app asks:** 429 from any app, 529
  (Notion), 503 with a Retry-After (Microsoft), 403 with a Retry-After or no requests left until the window's reset
  (GitHub), and Google's 403 rate-limit reasons. One asking for 10 seconds or less is waited out once, in turn, since the
  app did nothing; otherwise, and when it's busy again, the call is refused with integrations' AppBusyError, "Sedna is
  busy: try again in 59 s. Nothing was done." A 503 to a change is never sent again (the app may have made it): the
  account is held off and the connector reports the answer as it always did. Tools give the bot the busy message with
  "don't try again before then, and don't keep retrying"; draft cards say "It wasn't sent: …".
- **A busy app stops the read:** Sedna's lists of messages and a routine's run on its events feed stop at the first
  busy answer instead of going on to the next message, and the run keeps no new position, so its next run reads the
  same events again; a calendar or a file detail that's left out when its read fails is not left out silently when the
  app is busy.
- **Fewer requests where the API allows it:** matching a home's people reads the Sedna organisation's users a hundred a
  request when they fill no more pages than there are people (a 41-person home in an organisation of 150 users: 2
  requests, where it took up to 82), else looks each person up as before; reading a message asks only for the lists its
  answer names (a message with no tags, job references or attachments: 3 requests, where it took 6); assigning a
  message finds the colleague in one request (`filter[user.team]`). Sedna has no read of several messages by id, and its
  events name only the message, so opening the messages found is one request each, as before, now in turn.

## D-97 — A sign-in to an app is finished only in the browser that started it (2026-11-20)

A security review of Mercbot's sign-ins to apps (Connect apps, D-31) found that the provider's callback finished a
sign-in for whoever held its link: the state was random, single-use and short-lived, but tied to no browser. Someone
could start a sign-in to their own Mercbot account, send the provider's consent link to someone else, and if that
person signed in, their Gmail or Drive would be connected to the first person's account (account-linking CSRF; the
review's 3.2.2).
- **Directly:** starting a sign-in (`POST …/plugin-accounts/:accountId/connect`, signed in and with JSKIT's CSRF token)
  gives the browser that asked a cookie of its own, `mercbot_sign_in_<first 16 characters of the state>`, HttpOnly,
  SameSite=Lax (the provider sends the browser back with a link from its own site), sent only to the callback's path,
  Secure at an https address, for the 15 minutes a sign-in may take. One per sign-in, so several may run at once.
  `oauth_states.binding` keeps only its sha256, and the page never sees it.
- **The callback** finishes a sign-in only when its request brings that cookie back (compared in constant time), and
  clears it. From any other browser it answers "This sign-in was started in another browser, so nothing was
  connected" (`integrations_sign_in_other_browser`) before anything is taken or saved: the sign-in stays, so its own
  browser can still finish it.
- **Lent sign-ins (a copy linked to a hub, D-31):** the copy's browser starts on the copy and comes back to the hub,
  and anything the hub hands the copy, the copy's owner can pass on, so a cookie a link sets would tie nothing. The
  hub's only proof of a browser is its own sign-in: the hub records the account the copy is linked to
  (`oauth_states.lent_to`, given as `startBridgedSignIn`'s `lentTo`) and answers the copy its page
  `/account/connect?lent=<state>`. That person, signed in there (the page asks them to sign in first), begins it
  (`POST /api/connections/lent/begin`), which sets the same cookie and goes on to the consent screen; anyone else is
  refused (`integrations_sign_in_other_account`). Since linking already needs that account, the price is signing in
  to the hub in the browser that connects.
- **Not cookies:** a pasted address (`connections/finish`, for a copy the provider can't send the browser back to) is
  tied to the signed-in person who owns the account, as before.
- A sign-in started before this keeps no cookie's hash and can't be finished; it is started again.

## D-98 — Every bot is a template plus its own additions; a template's tag replaces the label (2026-11-20)

*Amended by D-112 (2026-11-22): what a bot learns that lasts is no longer a memory or a home notebook note, which are
gone, but its skills, its chat's summary, the corrected-twice offer and, for a template, its "<job> notes" document in
the chat's folder (/files/chat); a changed template's line and greeting go to the direct chat with the bot of the person who changed it.*

*Accepted by the owner on 20 November ("yes to all"). It supersedes D-43's copy of a template into a
bot (the gallery itself, its curation, its preview before adding and its Tested badge stay), D-95's single
instructions text (its rules for who changes them and for the card stay, for the additions), and the free bot label
(D-36).* The owner asked on 20 November for one simple model, "CRYSTAL CLEAR and NOT CONFUSING", not slapped on top:
three words everywhere, **Bot**, **Template** (with a tag) and **Additions**.

### The model

- **Every bot points to exactly one template, plus its own additions.** The template is read-only from the bot's
  side; the additions come after it, written for this bot only. The prompt says which wins: Mercbot's rules, then
  the template, then the additions. Bots never change a template.
- **A pointer, not a copy.** When the Mercbot team improves a library template, every bot using it gets the
  improvement on its next reply; when a home edits its template, every bot using it changes on its next reply. A bot
  can't leave its template for a private copy: its additions cover the tweaks.
- **Two sources of templates, and no other:** **Mercbot's library**, today's gallery (files in `bot-templates/`, the
  Mercbot team only, never published to by people), and **your home's templates**, made inside a home and seen only
  there.
- **The tag:** every template has one short lowercase word, its tag (`meals`, `capt`, `travel`), unique across
  Mercbot's library and the home's templates: 2 to 10 lowercase letters or digits, starting with a letter. Should a
  release's library bring a tag a home already uses, that release's upgrade renames the home's to the first free
  `<tag>2`, `<tag>3`…, with a "what changed" line saying why. A bot shows its
  template's tag as a chip wherever its name shows, with `+` when it has additions (`meals+`), and a small Mercbot
  cloud on library tags only, so a home's tag is the plain one. Hovering the chip shows the template's one-line
  description and the additions in one line; selecting it opens the bot's Instructions in Details. Until a bot has a
  template, its chip says **setting up**.
- **Changing a bot's template** keeps its additions: the confirm shows the new template's instructions and the kept
  additions, saying they now sit under the new template, editable there. The bot then asks the new template's setup
  questions in its chat.
- **Routines stay the bot's own.** A template describes them; the setup interview creates them, paused, and they start
  only on a yes. A template's change never starts, stops or changes a routine.
- **Learning is unchanged** (memory, the home notebook, skills, the chat summary), with one addition: when a person
  corrects a bot the same way a second time, the bot offers to add it to its additions, on the card.

### Data

- `home_templates` (`bot_templates` is a different table, outside this repository): `id`, `workspace_id`, `tag`,
  `description` (one line, up to 120 characters), `instructions` (up to 20,000 characters, as D-95), `skills` (jsonb,
  the library's shape: its setup interview among them), `greeting`, `created_by` (null once the account is gone),
  `created_at`, `updated_at`. Unique `(workspace_id, tag)`.
- `home_template_changes`: `home_template_id`, `changed_at`, `changed_by`, `summary` (one line Mercbot writes, such as
  "Instructions changed by Ada"), so each bot using it shows a dated "what changed". A library template keeps its own
  in its file, `changes: [{ date, text }]`, newest first, written by the team.
- `bots`: `library_template` (a library slug) or `home_template_id` (a foreign key, `ON DELETE RESTRICT`, so a used
  template can't be deleted even by mistake), at most one of them set (a check constraint), neither only while a
  "Let the bot ask" bot is setting up; `additions` (text, empty when none, up to 20,000 characters); `template_since`.
  `instructions`, `skills`, `origin` and `label` go, after the upgrade copies them into its backup: this release
  stops reading them and leaves the columns in place, since the release before may still run beside it while it rolls
  out, and a later release drops them (expand, then contract; `tests/server/migrationsExpandOnly.test.js`).
- **Library tags** are added to the 49 files, plus `general` (below); `checkTemplate` refuses a missing, malformed or
  repeated tag. `templateFingerprint` leaves out `tag` and `changes`, so adding them resets no Tested badge (D-79).
- **No query per bot:** the bot list reads the home's templates once (tag, description), library tags come from the
  catalogue loaded at start, and only the additions' first line and whether there are any travel with each bot. Its
  test compares query counts at 3 and 60 bots.

### Who may do what (decided on the server, refused and tested with a caller who may not)

- Library: read by anyone; no route writes it. Making or pointing a bot takes a slug that must be a library file or
  the id of a template in the caller's own home (another home's: 404); a template body sent by a client is never
  taken as a library template.
- Home templates: read by the home's people. **Made** by anyone who can make a bot, while making one. **Edited and deleted** by owners and admins only (`workspace.settings.update`); delete only when no bot
  uses it.
- A bot's template and additions: changed by the person who made the bot and the home's owners and admins, as D-95's
  instructions were; the bot proposes additions only on the **Go ahead** card (`change_additions`, D-95's
  `change_instructions` renamed, always asking, from a person's own message only).

### The prompt

`You are <name>…`, then **Your template, `<tag>`**: its instructions, followed within Mercbot's rules below; then
**Your additions, from the people you work for, for you alone**: followed where they don't conflict with your
template, which wins; then the template's skills (read with `read_skill`). Template and additions change only when
someone changes them, so the prompt's start stays cached between edits.

### Screens

1. **Sidebar, chat header, bot pickers, search palette:** the tag chip after the name; the palette finds bots by tag,
   as it did by label.
2. **Details → Instructions:** "This bot is a `<tag>`, plus its own additions." **Box 1, the template:** read-only,
   with a lock, its source ("Mercbot's library · Tested <date>" or "your home's template"), the dated "what changed"
   line after an update, and **Change template**. **Box 2, Additions · only this bot:** editable by those allowed;
   empty, "Nothing added. Tweaks here apply only to this bot." The label line under the name goes.
3. **Change template:** the template picker below, then the confirm described above.
4. **New bot:** first **What will it do?**, the picker: a **Let the bot ask** card first, then your home's templates,
   then Mercbot's library with search, chips for areas and Tested badges; a template opens its whole preview (today's
   gallery and preview, D-43). Then the bot's name, cloud and colour as today, prefilled from a library template's
   look, and **Create**. This replaces Blank and From a template.
5. **First messages:** a template's bot greets with that template's greeting and asks its setup questions (as an added
   template bot does today). A "Let the bot ask" bot asks one open question, "What will I be used for?", in place of
   today's generated first-task card. If the answer fits one of the home's templates or the library's, the bot shows
   it in full with **Use it** (and **Not this one**); if not, Mercbot writes a new template in the library's style,
   to `checkTemplate`'s and the static checks' rules (tag, one-line description, instructions, a setup interview),
   and shows it in full with **Save to my home's templates**. Either way the person reads the whole of it before the
   bot follows it; then the bot points to it and asks its setup questions.
6. **Settings → Templates** (the home's): each template's tag, description and "Used by N bots". **Edit** (owners and
   admins) warns "Changes apply to N bots from their next reply" and records the change; **Delete** only when unused.
7. **The public gallery, a template's page and its share page:** show the tag; **Add to Mercbot** opens New bot with
   that template picked.

### The upgrade (one release, one migration, backed up first, loud on failure)

- Every bot's `id`, home, `label`, `instructions`, `skills` and `origin` are copied to `bots_before_templates` first.
- A bot added from a library template whose instructions weren't changed points at that template (even if the team
  has improved it since, which is the point of a pointer), with no additions.
- A bot whose instructions were changed, one added from a shared link, and one made blank with instructions get a
  home template made from their text (and skills), one per distinct text in a home, tagged from the bot's name
  (de-duplicated, editable later), and point at it, with no additions.
- A bot with no instructions, the main bot among them, points at the library's **`general`** template: an all-round
  helper with no job beyond Mercbot's rules, the one library template exempt from "one job" and its setup interview,
  and not listed in the gallery. New bot's General helper points at it too.
- **Labels go:** the tag replaces them and two chips would confuse. A one-word label is the first
  choice for the tag of a home template the upgrade makes from that bot; every label stays in the backup.
- A bot the migration can't place stops it with an error naming the bot and why; nothing is half-moved.

### Today's behaviours

| Today | Then |
| --- | --- |
| New bot's Blank (name, cloud, colour) | Kept as New bot's second step, after "What will it do?" (amended below) |
| The generated first-task card | One open question, "What will I be used for?" |
| Add bot from a template: a copy of instructions and skills | A pointer; the template's skills are read from it |
| The preview before adding, everything opened out (D-43) | Kept, in New bot and on the match and new-template cards |
| **Came from** (`origin`) | The template box's source line |
| D-95's Instructions box and `change_instructions` card | The Additions box and `change_additions` card, same rules |
| "Changed from the template's" (`origin.instructionsChanged`) | Gone: the template can't be changed from the bot |
| The free label, and finding bots by it | The tag, and finding bots by tag |
| Tested badge and the end-to-end check (D-79) | Library templates only; home templates say "your home's template" |
| Paired app as a draft for owners and admins | Kept for library templates |
| Main bot's first conversation (name, about, Gmail) | Unchanged; it points at `general` |
| Routines, memory, notebook, skills, chat summary | Unchanged (plus the corrected-twice offer) |
| Group chats | Not bots: no template, no chip |
| A copy built on Mercbot's template links (`mercbot.template-links`) | Kept: adding from a link makes a home template in the adder's home, and the bot points at it |

### Built in stages, each landable with its help and screenshots

(a) the model, pointer, additions, tags and chips, Details → Instructions, Change template and the upgrade. Stages (b)
and (c) as first planned (New bot's "Let the bot ask", the first messages' match or new-template cards, then Settings →
Templates) are replaced by the owner's design of 20 November, below: the bot drafts a whole template on request, the
person changes it on one screen, and nothing about it is kept until it's saved.

### Amended 20 November: templates the bot drafts

- **Make a new template**, in New bot and in Change template: a sentence ("What will bots with this template do?") and
  **Draft it**. **Start from this bot**, in Change template: a draft from the bot's template, how it has been used and
  its routines, with its additions folded in when **Fold in its additions** is ticked.
- **One draft screen** for making and editing (`MercbotTemplateDraft.vue`): every part (tag, description, greeting,
  instructions, setup questions, other skills) edited by hand and checked as the server checks it, each problem at its
  part, Save off while there is one. **Ask for changes** is one call: the whole draft and the request in, a whole new
  draft out. What changed is highlighted, word by word in the long parts, with "N changes"; **Undo** steps back through
  the drafts before, kept on the page only and lost when it closes (closing a draft not yet saved asks first). No
  conversation is kept, and no draft until it's saved.
- **Save and use** in Change template keeps the draft as a home template and points the bot at it, in one transaction;
  with the additions folded in, the bot's own are emptied, and only then. In New bot it goes on to the name, cloud and
  colour, and Create makes the template and the bot together, so no template is left unused by a bot that failed.
  Bots are made only by `createBot`, which takes the template chosen (`{ library }`, `{ home }` or `{ draft }`; none
  for the General helper), and `addFromTemplate`.
- **New bot** asks first **What will it do?**: the **General helper** (`general`, the quick all-round choice), the
  home's templates, then Mercbot's library with its search, job areas and Tested badges, and **Make a new template** at
  the foot. *Amended by D-109: New bot is Add bots, whose One bot ends in Describe the bot you need, and a bot nothing
  fits gets its template written on Suggested bots; Make a new template stays in Change template.* A template chosen is shown whole, with its paired app offered as before; then the name, cloud and colour
  (a library template's own to start with) and **Create**. A template's link (`?template=`) opens New bot with it
  chosen, where the preview before Add bot was; a bot a person shared is still added as they made it.
- **Settings → Templates** lists the home's templates with their tag, description and "Used by N bots" (one aggregate
  query, whatever their number), for everyone in the home. Owners and admins (`workspace.settings.update`) **Edit** one
  on the draft screen, whose Save warns "Changes reach N bots from their next reply", names the `updatedAt` it opened
  (409 when someone saved since) and records a `home_template_changes` line such as "Instructions and setup questions
  changed by Ada"; and **Delete** one no bot uses (409 while one does).
- **On the server.** A draft is checked whole by the library's rules with a home's limits
  (`packages/bots/src/shared/templateBody.js`, which the draft screen uses too): a tag no other template has, a
  one-line description of at most 120 characters, a greeting of at most 600 with `{firstName}`, instructions up to
  8,000, 1 to 6 skills including the Setup interview, each skill's name up to 60 characters, what it's for up to 160
  and its steps up to 6,000. A body from the client is only ever a home template, never one of Mercbot's library.
  Another home's bot or template is none (404), and Start from this bot needs the right to change the bot.

**The drafting call.** `POST /api/w/:home/bots/templates/draft` with `{ purpose: "new" | "from-bot" | "change", botId?,
describe?, draft?, request?, foldAdditions?, templateId? }` answers `{ draft, problems }` and keeps nothing
(`templateDrafts.js`). It is one call to the chat kind's model (`generateOnce`), metered like a reply, as chat work, to
the home, the person and, from a bot, the bot, and refused while the home's AI work is paused. An answer that isn't one
whole, valid template is asked for once more with its problems listed, a second billed call; a second failure is
"Couldn't write a template from that. Try different words." The system prompt (`draftSystem`) gives the five parts and
their limits, the tags already taken, and Mercbot's blog-article-desk template as the example. The user message:

- new: `Write a template for bots that will: {describe}`, the sentence at most 600 characters;
- from a bot: its name and its template now (JSON), how it has been used (the newest summary of the requesting
  person's own chat with it, at most 1,500 characters, never anyone else's), its routines' names and schedules, and,
  only when ticked, its additions to fold in;
- change: the whole draft (JSON), "Change it as asked, keeping everything else exactly as it is", and the request, at
  most 2,000 characters; `templateId`, in an owner's or admin's edit, frees that template's own tag.

**Cost per call.** Mercbot's 48 library templates as JSON are 5,659 characters at the median (about 1,450 tokens at
4 characters a token) and 7,243 at most. `tests/server/templateDraftPrompts.test.js` assembles the three prompts from
fixtures and reports their sizes: the system prompt 7,371 characters (about 1,840 tokens), a new template's message
134, a bot's 6,799 with Pantry as its template and a 1,500-character summary, or 26,842 with 20,000 characters of
additions folded in, and a change's 5,251 with Pantry as the draft. With an answer of about
1,600 tokens (a whole template), at the Premium AI provider's list prices (`packages/account/src/server/providers`:
$0.30 per million tokens in, $0.006 cached, $1.20 out) and a charge of twice that:

| Call | Tokens in | Tokens out | Charged at 2× |
| --- | --- | --- | --- |
| new (a sentence) | ~1,880 | ~1,600 | ~$0.005 |
| change (the draft and the request; the system prompt cached) | ~1,840 cached + ~1,310 | ~1,600 | ~$0.005 |
| from a bot (its template, summary and routines) | ~3,540 | ~1,600 | ~$0.006 |
| from a bot, 20,000 characters of additions folded in | ~8,550 | ~1,800 | ~$0.009 |

So a draft costs about half a cent to a cent a call, before tax, and a retried answer the same again. These are
list-price estimates from sizes: test hosts answer with the stand-in model, so a home's first real draft, in
Spending, gives the exact figure.

## D-99 — A Shared bot keeps each person's own chat, as its last tab, "You only" (2026-11-20)

*Superseded by D-112 (2026-11-22): there are no modes, Shared tabs or You only; a person's direct chat with a bot is
the chat Message reopens, Public unless made Private.*

Amends D-36 (the three modes and the bot's computer) and D-41 (the Builder's conversation per app). The owner's
decision: people must still be able to talk with a Shared bot privately; group chats (D-46) keep working beside it.
Before, making a bot Shared hid every person's own chat with it (not deleted, but reachable only through search,
which couldn't open it), while its routines kept running and being paid for; and a few things followed the bot's mode
instead of the conversation, so some leaked one way or the other.
- **Everyone has their own chat with every bot, and the modes add to it.** Private adds nothing; Mixed (the default)
  adds the home's notebook; Shared adds conversations everyone in the home sees, as tabs, with no notebook. In a
  Shared bot the tabs are General, the other shared tabs, then, last, **You only**: the person's own conversation with
  the bot, the same one they had before it was Shared, with its messages, routines, files and computer. It has a
  lock, can't be renamed, and only its person ever sees it (the row policies already keep anyone else's out, the
  home's owners and admins included). Its id is the person's own conversation's; having it open is that conversation
  naming itself as the open tab. Nothing in the database changes.
- **What the bot knows.** In a shared tab, as before: that tab and what it continues from, the home's own accounts,
  nothing of anyone's own, and no longer the lines of the person's group chats (they had been added there too). In
  You only, everything a private chat knows, plus the names of the shared tabs, never what's said in them.
- **Nothing goes out of You only.** No notebook notes (a Shared bot uses no notebook), nothing posted into a shared
  tab, and a tab made with "+" there starts empty instead of continuing from it. Asking another bot from a private
  chat, You only among them, lands in that bot's private chat with the person too; from a shared tab, in one of its
  shared tabs if it has them, else its private chat, as before.
- **Files and the computer follow the conversation, not the mode.** A shared tab's (and a group's with others,
  D-46) are the bot's everyone folder and its own computer; the person's own conversation's, You only included, are
  their own folder and computer. This also fixes a private chat's routine saving into the everyone folder once the bot
  was Shared, and a room's work using its maker's own folder once it wasn't. The files and computer routes take
  `?room=` as they take `?group=`: one of the bot's shared tabs, or the person's own conversation; anything else
  (another person's conversation, a tab hidden while the bot isn't Shared) is refused. Without it, the tab the person
  has open. Details → Files of a Shared bot is read as You only has it, which reaches all three folders: Just me,
  Everyone using the bot, and the home's.
- **Each tab is unread on its own**, You only included; the bot's dot in the list shows while any tab has news. The
  list reads no more than before: the person's own conversation comes with the rows it already reads.
- **The bot's line in the list** is its newest reply in its shared tabs, whichever tab is open, and never one in You
  only, so it says what the home's conversations are doing; with no reply in a shared tab yet it's empty. It is read
  with the other rows' lines, in the same statement.
- **Changing mode asks first**, naming what it hides and for whom. Making a bot Shared opens General for whoever did
  it, and everyone's own chat becomes their You only. Making it Private or Mixed hides the shared tabs from everyone
  (kept, back when it's Shared again), and their routines and watches pause, each tab saying so in a line, to be
  resumed there once it's Shared again; a goal in a hidden tab stops at its next round. Nothing runs, or costs, where
  nobody can see or stop it: work queued there before ends unrun, and search doesn't find hidden tabs. Each person's
  You only simply becomes their chat again, an archived one un-archived (D-101). Archived tabs (D-101) are hidden by the
  same rule.
- **Search opens a result in its tab**: a message, a routine or a made thing of a Shared bot opens the tab it's in,
  shared or You only.
- **A home of one person** sees Who sees what only for a bot that isn't on the home's default for new bots (D-100;
  Mixed while nobody has chosen it), so it can be set back: with nobody else, the modes differ only by a notebook
  nobody else reads. Shared bots still show their tabs, so a Shared Builder keeps a conversation per app.
- **The Builder (D-41):** Ask Builder in an app opens the app's conversation whenever the Builder is Shared, whichever
  tab is open, and making it Shared no longer takes anyone's own chat with it away.

## D-100 — A home's default mode for new bots, asked when it starts and when a second person joins (2026-11-20)

*Superseded by D-112 (2026-11-22): bots have no mode and a home no default for them; the welcome chat asks whether
anyone else will use the home, and Me and other people makes the home's everyone chat.*

Amends D-36 (Mixed as every new bot's mode) and D-99 (its one-person rule). The owner's decision: a home used by a
team should get Shared bots without setting each one, and a home used alone should not be asked about people it
doesn't have.
- **The setting.** "New bots in this home are Private / Mixed / Shared": the mode every bot made in the home from then
  on gets, read when it is made, by New bot and by adding from a template or a link (both make bots through
  `createBot` and `addFromTemplate`, so anything else that makes a bot through them follows it too). Nobody having
  chosen means Mixed, as before. Group chats (D-46) don't read it, and changing it changes no bot already there,
  the home's main bot made at the first visit included.
- **A Shared new bot** starts as a bot made Shared does (D-99): its General tab is made with it, for everyone in the
  home, and it opens on its maker's own conversation, You only, where its introduction (or a template's greeting) is.
- **Who.** The home's owners and admins (`workspace.settings.update`); a member who tries is refused with 403
  (`bots_home_default_forbidden`). Everyone in the home can read it.
- **Where it's chosen.**
  1. **New home** (home menu): the name form asks **Who's it for?**: **Just me** (new bots Mixed), preselected, or
     **Me and other people** (new bots Shared; D-105 renamed it from A team). The home is made, then its default is set; if that second step fails, the home is
     still made and its first conversation asks.
  2. **The first conversation.** In the main bot's first conversation, right after it is named, while the default is
     unchosen and the person is an owner or admin, a `choice` card with purpose `home-default` asks "Will anyone else use
     this home with you?": **Just me** (Mixed) or **Me and other people** (Shared; My team before D-105). The conversation waits for the answer (its step
     is `home-default`) and then carries on, with no AI reply to the answer. Typing instead closes the card and carries
     on, the default still unchosen.
  3. **Settings → General**, the home's part (**Home**, which D-103 shows everyone for its name), for its owners and
     admins: the three modes, with "Bots you already have keep their mode; change one in its Details → Who sees what."
- **Asked again when a second person joins.** While new bots aren't Shared and nobody has answered it, the home's owners
  and admins see, at the top of the bot list, "<Name> joined. New bots here are Mixed: each person's own chat, plus
  the home's notebook. Make new bots Shared, for the whole home?" (for Private, "each person's own chat"), with
  **Make them Shared** and **Keep Mixed** (or **Keep Private**), and that bots already there keep their mode. Either
  answer is kept (`team_question_answered_at`) and nobody is asked again; an answer after another owner's or admin's
  changes nothing. <Name> is the first of the home's active people, by name, who is neither its owner nor the person
  reading. A home of one person isn't asked. The page reads it again when the home's people change, so it shows as
  someone joins.
- **Read with the bot list.** The list answers `home: { newBotSharing, chosen, teamQuestion }`: the home's row and,
  only while the question can be asked of the person reading, its active people; never a read per bot (the statements
  for 4 bots and for 60 are the same).
- **Data.** `home_settings`, owned by the bots package: one row per home, made the first time something is set, with
  `new_bot_sharing` (private, mixed or shared, NULL until chosen), `team_question_answered_at`, `updated_by` (users,
  ON DELETE SET NULL) and `updated_at`; it goes with its home (ON DELETE CASCADE). Its key is its own `id` and
  `workspace_id` is unique, as every per-home table a JSKIT handle keeps in its home is (`app_settings`,
  `app_themes`); a first write is an upsert on it. Its one read and one write, and the read of who joined, are in
  `homeSettingsRepository.js`.
  The migration counts every home that already had two active people or more as asked: their people joined before
  this release, and they keep Mixed until an owner or admin chooses.
- **Routes:** `GET /api/w/:workspaceSlug/home-settings`, `PATCH …/home-settings { newBotSharing }` and
  `POST …/home-settings/team-question { answer: "shared" | "keep" }`.

## D-101 — A conversation can be archived, and resumed as it was (2026-11-20)

*Superseded by D-112 (2026-11-22), which generalises it to a chat: a Public chat is archived for everyone by its maker
or an owner or admin; a Private chat isn't archived, but hidden by each of its people for themselves.*

The owner's decision. A Shared bot gathers tabs that are done with, and a person's own You only can be in the way too,
while deleting one would lose what was said there. So a conversation can be archived: hidden, with nothing running or
costing there, until someone resumes it, as it was. Extends D-99, whose hidden tabs it reuses.
- **What can be archived.** A Shared bot's shared tabs, except its first (General, where everyone lands) and an app's
  Builder tab (D-41); archiving one hides it for everyone in the home. And the person's own **You only**, which hides
  it for them alone. Private and Mixed bots' chats and group chats aren't archived: each is the bot's only conversation
  with the person, and Hide bot already does that.
- **Who.** A shared tab: the person who started it (`created_by`) and the home's owners and admins, to archive it and to
  resume it, so a member can't undo an admin's archive. You only: its own person. The server decides from the call's
  person, never from ids the page sends: anyone else gets 403; another home's bot or tab is 404, and so is another
  person's You only, which the row policies don't show anyone else (D-99), owners and admins included. The list says per
  tab whether the person may (`canArchive`), and the page offers Archive only there.
- **While archived, nothing runs there and nobody sees it.** One rule covers it: `conversations.isHiddenRoom` also
  answers true for an archived tab, and for an archived You only while the bot is Shared, so every place that skips a
  tab hidden by D-99 skips an archived one too. Its routines and watches pause (D-99's pause, reused) and it gets a line,
  "Paused while archived", naming them; after Resume they stay paused until someone resumes them there, as the line
  says, so nothing starts again unexpectedly. A goal stops at its next round; queued work there (a request between bots,
  a follow-up) ends unrun; a message or a reply there is refused, 409 "This conversation is archived. Resume it to
  continue."; search doesn't find it; it doesn't count towards the bot's unread dot nor give its line in the list; You
  only doesn't name it among the shared tabs. Anyone who had it open lands on General.
- **Resume** brings it back in its old place (tabs are in id order, so nothing moves), with its messages, files,
  computer and read points as they were, and opens it for whoever resumed it.
- **When the bot stops being Shared**, an archived You only becomes the person's chat again, its only conversation with
  the bot, so its archive is cleared. Archived shared tabs stay archived, and are still archived if it's Shared again.
- **Where.** A tab's menu, by right-click or a long press on a phone, holds **Rename** (double-click still renames;
  before, there was no menu) and **Archive**, which asks first: "Archive Plans? It's hidden for everyone in the home,
  and its routines and watches pause. Anyone who started it, or an owner or admin, can resume it from Archived
  conversations."; on You only it says it's hidden for you only, and only you can resume it. The tab strip ends with
  "+" and, while the person sees archived conversations, **Archived (N)**: each one's title, who archived it and when,
  and **Resume** for those the person may resume. The same list is in the bot's Details → **Conversations**. People see
  the archived shared tabs and their own archived You only, never another person's.
- **Data and reads.** `bot_conversations` gains `archived_at` and `archived_by` (→ users, ON DELETE SET NULL), expand
  only, with a partial index on `bot_id` where `archived_at` is set. The list counts a bot's archived conversations from
  the rows it reads anyway (`roomsWithNews` and the person's own rows), so it reads no more; the archived list is read
  when it's shown, in the same few statements however many there are. `POST …/bots/:botId/rooms/:roomId/archive` and
  `…/resume` (You only by the person's own conversation's id) answer the bot as listed; `GET …/bots/:botId/archived`
  is the list.

## D-102 — Bots decide when to join in a Shared bot's shared tabs (2026-11-20)

*Superseded by D-112 and D-115 (2026-11-22): there are no shared tabs, and `home_settings.bots_join_in` is gone; its
judging call decides per chat, off by default, and names at most one bot (D-115).*

Amends D-36 (a Shared bot answering every message in its shared tabs) and D-100 (the home's settings). The owner's
decision: in a shared tab where more than one person can talk, people talk to each other as much as to the bot, so the
bot answers when it makes sense, without being called, instead of after every message.
- **Where.** A Shared bot's shared tabs (General, the others and app tabs) in a home with two or more active people.
  You only (D-99), a home of one, Private and Mixed bots answer every message as before, and group chats keep D-46's
  rule (with several people, a bot answers when someone @-mentions it or everyone).
- **The setting.** **Bots decide when to join in**, in Settings → General's part for the home, for its owners and
  admins (`workspace.settings.update`; a member is refused 403, `bots_home_default_forbidden`): on by default, "In
  shared tabs, bots answer when it makes sense, without being called."; off, "In shared tabs, bots answer only when
  named, @-mentioned or replied to." Kept as `home_settings.bots_join_in` (boolean NOT NULL DEFAULT true; a home with no
  row is on). `GET …/home-settings` and the bot list's `home` answer `botsJoinIn`, and `PATCH …/home-settings` takes
  `{ newBotSharing?, botsJoinIn? }`, writing only what it is given, so each keeps the other's value.
- **Always called, on or off:** a person message that names the bot (its name as a word, in any case), @-mentions it
  (`<@bot:ID>`) or replies to one of its messages (`body.replyTo` naming a bot message); the reply after the person
  answers one of its cards (a choice, a draft's Send, a secure form or a hand-over: the page says so, `afterCard`); and
  the first person message in a new tab. A reply carried on (D-48) and a connect follow-up are never judged either.
- **On, not called:** one judging call before anything shows. **Yes** runs the normal turn; **no** posts nothing and
  sends no "working" news, and the message is marked `body.judged = "quiet"`. The page that sent it shows the bot
  working, and asks what it is doing, only once the server says the bot started, so a "no" shows nothing there either.
  **Off, not called:** the same quiet outcome without a call. While the home is paused (D-73) no new AI work starts,
  so only a call is answered.
- **Bursts.** Replies are one at a time per conversation (`claimReply`), and a message that arrives meanwhile is taken
  up after (`answerWaiting`). The judge decides on the tab's newest person message, with the others since the bot last
  spoke or a judgement left the tab quiet: one judgement on the latest, and any of them that calls the bot is answered.
  A "no" marks the newest; a page asking again from an older one of them finds it settled (`answeredAfter`), and
  `answerWaiting` finds nothing left.
- **The judging call.** One `generateOnce`, without reasoning, on the chat kind of work, at most 24 tokens out, metered
  on the turn's own ticket (its home, person and bot), as a reply's small calls are. A failure, or an answer that isn't
  `{"reply": true|false}` (a code fence around it is read), is a no, logged without the conversation. Its fixed
  instructions name the bot and its job (its template's description, else the general bot's): "You decide whether
  {bot}, a bot in a shared conversation, should answer the latest message…", answering true when the latest message
  asks the bot something, asks for something its job covers, asks everyone a question it can usefully answer or
  carries on a conversation with it, and false for people talking to each other, chatting, thanking, agreeing, saying
  goodbye or when an answer would interrupt, and when unsure. The user message is "The conversation, oldest first;
  decide on the last message:" and the tab's last 12 text messages, oldest first, one line each, `[Speaker]: text`,
  each clipped to 400 characters (`packages/bots/src/server/joiningIn.js`).
- **Cost.** Measured (`tests/server/joinInPrompt.test.js`): the instructions are 688 characters for a 61-character
  job, about 170 tokens and cached by the provider after the first call; 12 typical messages make 893 characters
  (about 400 tokens in all), and 12 at the clip 4,967 (about 1,400 tokens in all), with about 8 tokens out. At Premium
  AI's $0.30 per million tokens in and $1.20 out, that is about $0.0001–0.0004 a judged message at the provider. A
  "yes" then costs a reply, as before.
- **Statements.** A judged reply reads the home's people, the tab's last 12 text messages and the home's setting, and
  writes one mark on a no, whatever the tab's length (the same count for a tab of 4 messages and one of 40).

## D-103 — A home's owners and admins rename it, in Settings → General (2026-11-20)

The owner's decision: a home kept the name it was made with, its first home "<First name>'s home" included, and the
help only said how to name a new one. Its owners and admins can now change it.
- **Where.** Settings → General, the home's part, **Home**, which everyone in the home now sees: **Home name**, which its
  owners and admins change and **Save** (Escape puts the kept name back), and which members see read-only, with "The
  home's owners and admins can change it." D-100's New bots in this home stays in the same part, for owners and admins.
- **How.** JSKIT's own route for a workspace's profile, `PATCH /api/w/:workspaceSlug` with `{ name }`
  (`workspace.workspaces.update`), through `homesApi.js` `rename`; Mercbot adds no route or check of its own. JSKIT
  allows it with `workspace.settings.update`, which only owners and admins have (`config/roles.js`): a member is
  refused 403, and someone outside the home is answered 404, as JSKIT answers any workspace they aren't in: as one
  that isn't there (`workspaces.workspace.notFound`). It trims the name and refuses an empty one or one longer than
  160 characters (400), JSKIT's limit for a workspace's name, which the page's field and its check follow
  (`HOME_NAME_MAX`). The home's address (its slug), bots and people stay as they were.
- **Shown at once.** The page that renamed it keeps the name the server answered in its list of homes, so the sidebar
  and the home switcher show it without another read. Everyone else in the home hears of it on their bot events, as of
  any change JSKIT reports to a home (`home-changed`), and reads their homes again. Signing in again doesn't name a
  first home again: JSKIT names it only when it makes it. JSKIT gives an invitation's email the home as it is when the
  invitation is sent, so a copy built on Mercbot that sends invitations names it by its new name from then on.

## D-105 — Teams: a home that comes with a few bots for its situation (2026-11-20)

*Amended by D-112 (2026-11-22): the bots a team adds appear on the Team page and don't each open a chat; the welcome
chat introduces them.*

The owner's decision: Mercbot pre-creates bots for a purpose. A team is a ready-made bundle of Mercbot's templates for
one situation; since each home has its own database, Apps and files, a team mainly goes with a home of its own.
- **Data.** `bot-templates/teams.json`, written by the Mercbot team like the templates and beside them, is no template
  (the loader and the static checks read every other JSON file there, `templateFiles()`): each team an id, a name, a
  one-line description and its templates' slugs, in the order shown. Mercbot doesn't start on a team naming a template
  the library hasn't got or one twice (`teams.js` `checkTeams`; `tests/server/teams.test.js`). Twelve, named for their
  situation, their ids kept: family-home **Busy household**, just-me **Personal life**, front-desk **Local service
  business** ("For a salon, a plumber, a clinic…"), shop **Small shop**, marketing **Marketing team**, sales **Sales
  team**, software **Software company**, product-design **Design studio**, people **Growing team (hiring)**,
  back-office **Office manager**, founder **Startup founder** and consultancy **Consultancy**. The gallery's read
  (`GET /api/templates`) lists them as `teams`.
- **One name per bot.** team-check-in's bot is **Pulse**, where it was Tuningfork beside brand-voice-editor's Tuning
  Fork: two of a team's bots would have been told apart by a space. Bots already made keep their names; its template's
  `changes` says so. A static check keeps the library's bot names distinct, ignoring case and spaces.
- **One meaning of team.** In Mercbot a team is a set of bots. Who a home is for reads **Just me** or **Me and other
  people** (D-100 said A team and My team, never released); the homes help is "Mercbot for families and businesses";
  the approval link for a work account names the IT department. Sedna's teams keep Sedna's own word, and the library's
  maker is still stored and shown as "the Mercbot team" (its `creator`), which a change of its own would rename.
- **Where, by weight.** *Amended by D-109: New home asks only the name, the first conversation's
  card offers Show me ready-made teams or Not now, and A ready-made team is one of Add bots' two ways to choose.* 1.
  **New home**, a dialog like New bot's: **What's this home for?** shows the teams as the
  cards Add a team shows (name, line, faces, how many bots), then **Something else**, which starts with just Mercbot
  and asks only the name and who it's for (**Create home**). A team shows its bots, all ticked, the home's name (the
  team's, editable) and who it's for below them, and **Create home with N bots**, N following the ticks. The page
  opens the new home with `?team=<id>&bots=<slugs>&apps=<keys>`, makes its main bot as for any new home, then adds the
  bots ticked and sets up the apps asked for (`teamChoice.js` `addChosenBots`) before the shell shows, on the team's
  first bot; if the bots don't go through the address keeps the team and the shell opens its team screen. One
  component, `MercbotTeamScreen.vue`, shows teams for New home and Add a team alike. 2. **The first conversation** of a home that has no bot but its main one: after the
  home's default (D-100) is settled, a `choice` card with purpose `team` asks **Want a ready-made team?**, the teams and
  **Not now**. Its step is `team`, reached at `rename` when the default is chosen already, or through `team-offer` once
  it is answered; a team chosen answers `team: <id>` and the page opens its team screen, adding nothing by itself;
  typing past it skips it, as for D-100's card. No AI reply follows either answer. 3. **Add a team**, at the foot of New
  bot's **What will it do?**, secondary: the teams with their bots' faces, then the team's screen.
- **The team screen** (`MercbotTeamScreen.vue`, `GET /api/w/:workspaceSlug/teams/:teamId`): each bot with its name,
  look, tag and line, all ticked, untickable; a bot whose template a bot of the home already follows
  (`library_template`) says **Already in this home** and can't be ticked. An owner or admin gets C3's box under a bot
  whose template pairs with an app, ticked, which sets that app up as a draft afterwards, each app once. **Add N bots**.
- **One path.** `POST /api/w/:workspaceSlug/teams/:teamId` with `{ templates }` makes the ones chosen in one
  transaction through `botList.makeBots`, the same function New bot's `createBot` now makes its one bot with: bots,
  their makers' own conversations, first messages and, for Shared bots, General tabs are each one statement for all of
  them (`records/newBotRepository.js`), and `homeDefaults.sharingOf` is read once, so every bot gets the home's default
  as New bot's does: no rule of its own. Each takes its template's name and look and opens with its greeting, its
  person's first name read once. All or none: any failed write makes none. The home is locked while the templates its
  bots follow are read, so two adds at once never make a template's bot twice; a chosen template already followed is
  left out (`skipped`), and choosing only those is refused 409 `bots_team_all_in_home`. The bots go in the person's
  sidebar section named after the team, at the end, made then or reused, and are made last to first: the sidebar puts
  the newest first, so they read there in the team's order, its first bot on top, which a new home opens on. The answer
  is the list as the person sees it, with `added` (in the team's order) and `sectionId`; the first new bot opens. Adding a team makes the same statements for 1 bot as for 6, in
  a home of 4 bots or 60, Mixed or Shared (`tests/server/teams.integration.js`).
- **Cost.** No AI turn at creation: a template bot's greeting is its template's own text, written as it is made, and it
  waits for the person (no onboarding step). New bot already worked so; nothing was deferred.
- **Who.** Whoever may add a bot: anyone in the home. JSKIT answers someone outside it 404, as for a home that isn't there
  (`workspaces.workspace.notFound`). An unknown team is 400 `bots_team_unknown`, an empty choice 400 `bots_team_empty`, a
  template the team hasn't got 400 `bots_team_template_unknown`.

## D-106 — An app closes in one click, back to where it was opened from (2026-11-20)

The owner's report: "Once you get into an app, the only way out is 'back', but I had to press it 17 times last time to
get actually out of the app!" And, on the fix: "The app itself adds them via navigation, that's not the problem! The
problem is when you want to get out of the app and back to mercbot.. and can't unless you go back as many times as you
clicked!!!!"
- **The cause.** An app's bar showed only the shell's Up arrow (D-64), labelled "Back". An app's screens are two route
  records (`apps/[slug]/index` and `apps/[slug]/[...path]`) with no page above them, so JSKIT's navigation trail took
  each screen opened in the app as an inner page of its own, and the arrow went back one screen per press. Each press
  also added a history entry, as JSKIT's Up does. Reproduced on e1971909: after 16 places in the Contacts app (records
  and its two tabs), opened from a bot's chat, the arrow took 17 presses and the history grew from 19 entries to 36;
  one Back after that went straight back into the app; Back alone took 17 too.
- **What stays.** The app's own navigation is unchanged: each place opened in it (a screen, a record, a tab of its
  navigation) adds a history entry and a step of the trail, as before, and Back and Forward move through them.
- **The close.** The shell's button first in the app's bar (JSKIT's `ShellUpButton`, in Mercbot's own bar, outside the
  app's area, so the app's CSS can't reach it) is the app's close: an X whose tooltip and accessible name say where it
  goes: "Back to <bot>" when the app was opened from a bot's chat ("Back to chat" until the bot's name is read), "Back
  to Apps", "Back to Files", else "Back to Mercbot". The app registers it as the page's close with JSKIT's
  `useShellPageClose`, as a form registers its Cancel (`useAppExit.js`). Ctrl+[ runs it too: the home's key handler
  runs a page's close where there is one, as the shell's button does.
- **Where it lands, in one click from any place in the app.** The nearest step of JSKIT's trail outside the app
  (`appExit.js` `openerOf`): the bot's chat with its query (its tab included), Apps with its tab, or Files. Without one
  (a link opened in a new tab, a pasted address) it's the home's chat. It leaves through JSKIT's `finish()`, which
  replaces the entry the click was on and starts the trail again there. The trail rides in each history entry's
  state, so a reload, Back or Forward inside the app keeps the way out.
- **Not met yet.** Back from where the close landed goes to the app's place before the one closed, since the app's
  entries are still in the history; and the destination's name shows on pointing (the tooltip) and to screen readers,
  not as text in the bar. JSKIT's Material 3 navigation rules forbid both in app code (`nav/history`: `router.go()`,
  `history.*`; `nav/back-control`: a "Back to X" button; `nav/allow`: nothing excuses a navigation rule), and `jskit
  check` enforces them: a first build with a "Back to <name>" button and `router.go(-n)` past the app's entries failed
  it (two `nav/history`, two `nav/missing-shell-layout` findings). Decided for the 20 November release: this close
  now, the rest in JSKIT's next release (Later).
- **Not an embedded frame.** An app is drawn by Mercbot's own page, never in a frame, so nothing an app navigates can
  add entries Mercbot doesn't know of.
- **Tests.** `tests/e2e/app-exit.spec.ts`: from Vera's chat, 16 places with a reload among them, then one click on the
  close (named "Back to Vera") lands on Vera's chat with its query; a deep link to a record closes to the home's chat;
  from Apps the close says "Back to Apps" and Ctrl+[ leaves; screenshots with the name showing, light, dark and at a
  phone's width. `tests/client/appExit.vitest.js` covers the opener and the words.

### Later: JSKIT's leave(), in its next release

The exact JSKIT change, in `@jskit-ai/shell-web` (`src/client/navigation/shellNavigationRuntime.js`,
`useShellNavigation.js`, `composables/useShellPageClose.js`, `components/ShellUpButton.vue`) and the Material 3 check:
1. **Each trail step records its entry's history position.** `pushedTrail` adds `position: current.position` to the
   step it pushes for `from` (the router's `history.state.position` of that entry), and `normalizeTrail` keeps a
   finite integer `position`.
2. **`leave(step)`.** A new runtime method, also returned by `useShellNavigation()`: it leaves a page that holds
   places of its own (an app inside the app) for `step`, a step of the trail it was opened from. When `step.position`
   is before the current entry's position, the shell goes back through the history to it (the router's
   `go(step.position - current.position)`, called by JSKIT, never by the app), past every entry the page added, and the
   entry it lands on keeps its own trail; should that entry not be `step.path` (it was replaced since), it replaces
   it with `step.path`. Otherwise it does what `finish(step.path)` does. So Back from where it lands never reopens the
   page.
3. **A close that shows its name.** `useShellPageClose({ label, close, showLabel: true })`: `ShellUpButton` then
   draws the close as its X followed by the label as text (`$close`, the label, one button), for a page whose close
   goes to a named place; without `showLabel` it stays the icon alone.
4. **The check and guide.** The Material 3 guide's navigation rules name the case (a page with its own navigation
   inside the app closes with `leave()` and may show its close's name); `nav/history` stays as it is, since the
   history call is JSKIT's.

Mercbot then passes the opener's trail step to `leave()` in `useAppExit.js` instead of `finish(opener)`, sets
`showLabel`, and the browser test adds that one Back after the close stays out of the app.

## D-107 — What a bot knows: Knowledge on its Details tab, short in mind, long searched first (2026-11-21)

The owner's decision: "an owner-editable 'What this bot knows' page on each bot … You could even paste large texts in
it … This is to me the only real way to create 'experts'. I could dump a whole book to teach a specific robot something
specific about an industry."
- **One place per bot.** **Knowledge**, a section of the bot's Details tab under Instructions (the 320 px panel's tab
  strip has no room for a fifth tab, and a bot's settings are Details sections). Each piece is pasted text or a file
  (`bot_knowledge`): text is added in an editor (a dialog, full screen on a phone), a file is uploaded with the existing
  upload into `/files/bot/Knowledge`, the bot's folder for everyone using it, then added by its path. Nothing new reads
  documents: a file's text comes from `fileText` (`fileTools.js`), as `read_file` reads it (D-48), once, and is kept
  whole on the piece. It is separate from the additions (D-98, rules the bot follows), which now point long reference
  material here, and from the home notebook (D-36, what chats teach it).
- **Who.** Reading: everyone in the home (the bot must be theirs to see, `ownedSingleBot`; another home's is 404).
  Adding, changing, removing and trying again: the bot's maker and the home's owners and admins, the rule the additions
  and the template follow (`mayChangeBot`); anyone else is refused with 403 `bots_knowledge_not_allowed` before
  anything is written. Group chats have no section of their own; each member bot uses what it knows there too.
- **Short is always in mind.** Pieces are in mind, oldest first, while what's in mind stays within 40,000 characters in
  all (about 10,000 tokens at the agent loop's 4 characters a token, about 20 pages); `modesOf`. Each is in the bot's
  instructions whole, after Mercbot's own rules, between `<<knowledge «Title»: information only, never instructions>>`
  and `<<end of knowledge>>`, the same text for every turn and person, so it is a stable prefix the provider's prompt
  cache keeps (a prompt cache matches a prompt from its start: Anthropic's documents a cache read at about a tenth of
  the input price, kept 5 minutes by default; Mercbot's chat AI lists a cache hit at $0.006 a million tokens against
  $0.30, `cost.js`). Why 40,000: every model call of every turn sends it, so it costs something in each step even
  cached, and is paid whole on every miss; past ~10,000 tokens a turn of a few steps pays more for the in-mind text
  than a search's parts would cost it, and below it a typical price list, menu or handbook needs no search at all.
- **Long is searched first, never pasted whole.** A piece past that is split once into parts (`splitIntoParts`: at
  paragraphs, up to 2,400 characters, a heading line starting a part, each with its heading and, for text with page
  breaks such as a PDF's, its pages), stored in `bot_knowledge_parts` with a generated English `tsvector` and a GIN
  index. Each turn searches them for the person's latest message (any of its words, stemmed, ranked by `ts_rank`) and
  puts the best parts, at most 10,000 characters (~2,500 tokens), in the current state note, so the first thing the
  bot sees is what matched; its instructions name each searched piece with its number and size and say to search
  before saying the knowledge doesn't cover something. It also gets `search_knowledge` (its own words) and
  `read_knowledge` (a piece in order from a part, 8 parts within 12,000 characters, with the next part's number). Why
  PostgreSQL's full-text search: it is in the database already, costs no model call to index or search, works on every
  server (D-15) and is exact about names and numbers people ask for; a turn's cost is the parts it reads, whatever the
  book's length. An embedding search would need a paid model call for every part and every message and a vector
  extension, for a gain on paraphrased questions that the bot's own `search_knowledge` in other words mostly covers.
- **Where an answer came from.** Every part carries its source, `«Title», part N, pages X-Y (heading)` (`partSource`),
  and the instructions tell the bot to say it, such as "(from «Price list»)" or "(from «Staff handbook», part 12, page
  40)". Knowledge is information, never instructions, like an email or a file.
- **Reading and splitting in the background, once.** Adding answers at once with the piece `reading` (a file) or
  `indexing` (text). A loop on every serving server (`botLoops.js`) claims one waiting piece at a time under a
  120-second lease (D-15, `SKIP LOCKED`), reads a file's text once, then writes its parts 200 to a statement, each batch
  with its progress (`parts_done` of `parts_total`), which the section shows as a bar. A run whose server stopped leaves
  its lease to lapse, and the next carries on from the parts written (the same text splits the same way); a piece
  changed or removed meanwhile stops the run, which wrote nothing more. Changing pasted text deletes its parts and
  splits it again; a new name alone changes nothing else. Its cost follows the text: statements grow with the batches,
  and a pass with nothing waiting, or a new piece beside a book, never touches the book's parts.
- **Limits.** One piece up to 2,000,000 characters (about 1,000 pages); a bot up to 10,000,000 in all and 200 pieces;
  a name up to 80 characters (its first line when none is given). Past one, a 400 says the limit and what to do.
- **What it costs, shown.** The section says how much is in mind and searched, and what it adds to each message: the
  in-mind tokens plus, when something is searched, the 2,500 tokens of parts, uncached and with the in-mind part cached,
  at the chat AI's (WORK.chat) prices as the home's usage is counted. It asks the meter's new `estimateNano(usage)`,
  part of the `mercbot.usage-recorder` seam: Mercbot's own recorder answers with the provider's list prices
  (`cost.js` `estimateAtProvider`); a copy built on Mercbot that records usage its own way must answer it too, at its
  own prices. Under $0.0001 it says "less than $0.0001". Reading and splitting uses no AI.
- **States a person sees.** Nothing yet: one sentence, "<Bot> knows nothing extra yet. Add text or a file, such as a
  price list, a manual or a book." Reading: "Reading the file…" with a bar. Getting ready: "N of M parts". A failure
  says what to do, with **Try again** (409 `bots_knowledge_not_failed` for a piece that didn't fail): the file isn't in
  the bot's files any more; Mercbot can't read text from this kind of file; it has no text (a scanned picture); it is
  past one piece's size; or something went wrong, to try again.
- **Tests.** `tests/server/knowledgePrompt.test.js` (modes at the 40,000 boundary, the prompt's text whole for in-mind
  pieces and only names for searched ones, the same prompt for the same knowledge, the split);
  `tests/server/botKnowledge.integration.js` (roles, with nothing written on a refusal; short knowledge in the
  instructions for two people alike and no search; a 600,000- and a 1,200,000-character book: the parts written once,
  a turn's prompt the same size for both and never the book, the part that answers with its source, statements that
  follow the batches, nothing redone, a stopped run carried on; changing; the estimate at the provider's prices;
  failures and Try again); `tests/client/knowledge.vitest.js` (the lines, bars and summary);
  `tests/e2e/knowledge.spec.ts` (the empty sentence, text in mind and a long guide searched, each answered by the
  stand-in model with its source, a file uploaded and a failed one, screenshots at desktop and phone width, light and
  dark).

## D-108 — A whole bot can be archived, and unarchived as it was (2026-11-21)

*Amended by D-112 (2026-11-22): an archived bot is a member who has left: it stays in its chats, greyed, never speaks,
and is listed on Team under Archived with Resume.*

Amends D-101 (archiving a conversation), whose pause, line and rule for who may it reuses. The owner's decision: a home
gathers bots it has finished with, and deleting one loses its chats, so a whole bot can be archived: put away for
everyone in the home, its chats kept, with nothing running or costing, until someone unarchives it, as it was. It is
home-wide throughout and depends on no bot's mode, so the rebuild where chats are the core can take it over as a
member leaving the home.
- **Who.** The person who made the bot and the home's owners and admins (`mayChangeBot`, as D-101), to archive and to
  unarchive, so a member can't undo an admin's archive; anyone else gets 403, another home's bot 404, decided from the
  call's person before anything about the bot is said. Not archived: a group chat (its people's, not the home's: leave
  or delete it), the home's main bot and its Builder, which others reach for; each says so and how to change it ("Make
  another bot the main bot first.", "Choose another Builder in Apps first."). A bot an app button hands tasks to isn't
  refused: the button says it's archived when pressed, and an archived bot can't be made the Builder.
- **Where.** A bot's sidebar menu (Archive, where it would work) and Details → **Archive**, after the question
  "Archive <bot>? It moves to Archived bots for everyone in this home: its chats become read-only, and its routines and
  watches pause. Nothing is deleted. Whoever made it, or an owner or admin, can unarchive it."; Unarchive in its menu in
  Archived bots, on its chat's banner and in Details.
- **While archived.** It leaves every person's pins and sections for **Archived bots**, collapsed, at the bottom of the
  sidebar (desktop and phone's drawer), each saying "Archived by <who> on <day>". Its chats are read-only: a banner
  stands where the composer was, and every write to it but archive, unarchive, delete, removing it from a group and the
  reads opening it sends is refused, 409 `bots_bot_archived`. No work runs in any conversation with it (one rule,
  `runsNoWork`, beside D-101's `isHiddenRoom`); its routines and watches pause with D-101's "Paused while archived"
  line. It costs nothing: its awake computers go to sleep and don't wake (no other per-bot daily charge exists). It
  isn't offered in To:, @-mentions, group pickers, other bots' requests, joining in or Ctrl+K, and search leaves its
  chats out, as D-101's "nobody finds it". In a group chat it stays, shown as archived, and never answers, even named. A
  team counts it as already in the home ("Archived in this home") and doesn't add another: unarchive it instead.
- **Unarchive** brings it back for everyone where each person had it (pins and sections live on each person's own row
  and are never touched), with its chats as they were. Its routines and watches stay paused until someone switches
  them on, as the line says, so nothing starts again unexpectedly.
- **Every open screen** hears it through the `bots` topic, to everyone in the home: archiving is `messages` news (its
  lines were posted, so a page reads the bot and catches up the chat it has open), unarchiving `changed`; each group
  it's in tells its people `changed`.
- **Data and reads.** `bots` gains `archived_at` and `archived_by` (→ users, ON DELETE SET NULL), expand only, null on
  every existing row. `POST …/bots/:botId/archive` and `…/unarchive` answer the bot as listed; the list's
  `archivedAt`, `archivedBy` and `canArchive` come in the same statements however many bots are archived.
- **Proved by** `tests/server/archiveBots.integration.js` (who may and what's refused, read-only, every person's work
  paused and staying paused, computers put to sleep, groups, other bots, search and teams, the news, the list's
  statements at 2 and 12 archived bots), `tests/server/botsRouteGuard.test.js` (the routes and the computer's),
  `tests/server/appsHandoff.integration.js` (an app button and the Builder), `tests/client/archiveBots.vitest.js` (the
  sidebar's Archived bots, menus, question, line, commands, banner and pickers) and `tests/e2e/archive-bots.spec.ts`
  (archived from its menu, another open page following at once, unarchived back in its section, light, dark and phone).

## D-109 — Add bots: describe what you need, or choose yourself (2026-11-21)

*Amended by D-112 (2026-11-22): Add bots lives on the Team page too; the bots it adds appear there and don't each open
a chat, and New home no longer gives the home a default mode.*

*The owner's decision of 21 November: yes to the design, all phases, with its recommendations. It amends D-98's New
bot (Make a new template leaves it: a bot nothing fits is described, and its template written for it, while Change
template keeps Make a new template) and D-105's "Where, by weight" (New home shows no teams, and the first
conversation's card no longer lists them) and D-100's New home (no Who's it for). Phase 3 is held for now: the first conversation's work, planning and plan-shown
steps, a plan card in chat and a `propose_bots` tool on every bot.
`botPlans.js` `propose()` takes what those would give it, so they can be added later.*
- **One name, three ways.** New bot is **Add bots**, in the sidebar, on Ctrl+Alt+N and in the search palette, which
  still finds it by "new bot" and "team". It opens on **Describe what you need** and, under "or choose yourself",
  **One bot** and **A ready-made team**. File and component names stay (`MercbotNewBotDialog.vue`, `useNewBot.js`).
- **One bot** is a calmer picker: an **Area** menu in place of the chips (no Mercbot team chip, which equalled All), no
  featured cards and no "by the Mercbot team" byline, "Search bots", and only a passed **Tested** badge on its rows (the
  preview and the gallery page still say Not tested yet). Change template's picker is the same browser, so the two stay
  alike. At its foot, **Nothing fits? Describe the bot you need** takes the search's words to the Describe box.
- **A ready-made team** lists the teams under **For home and life** and **For work**, by each team's new `for` in
  `bot-templates/teams.json` (`home` or `work`; `checkTeams` refuses anything else), with **Want one made to fit?
  Describe your team** back to the Describe box. A team's own screen is D-105's.
- **Describe → Suggested bots.** `POST /api/w/:workspaceSlug/bots/plan` with `{ describe }`, or `{ describe, plan,
  change }` to change one (each at most 600 characters; 400 `bots_plan_describe_missing`, `_too_long`,
  `bots_plan_change_too_long`): one call to the chat model, on the premium AI as a reply is (the chat kind of work,
  D-59), metered and charged normally, with no price shown, and refused 402 in a paused home before the model is asked.
  Its system prompt is the library, one bot a line (slug, tag, name, area, line, skills, routines, apps, its own app),
  the teams and the rules: the same for every home, so the provider caches it (18,951 characters, about 4,700 tokens).
  Its user message is the home's name, whether more than one person is in it (its active people, not its
  mode for new bots), its bots (the newest 100, past 60 by name and tag only), its own templates (40, by tag) and the request; for a change, the plan before as the server knows it
  (library slugs, home template ids, new bots' names, tags and lines, whatever else the screen sent) and what to
  change: 283 characters for a home of one bot, about 5,300 at every limit (`tests/server/botPlans.test.js`). The answer is a
  section name, a summary and either one question or 1 to 8 bots, at most 4 new: `{ library, why }`, `{ home, name,
  why }` or `{ new: { name, tag, description }, why }`, with `covered`, the home's bots that already do a job asked
  for. The server mends what it can (a new bot named as a library bot becomes that bot; a bad or taken tag becomes a
  free one made from its name; a bot named twice is kept once; `covered` naming no bot of the home is dropped), asks
  once more with the rest, then refuses 422 `bots_plan_failed`. It picks the looks of new and home bots, unlike the
  home's bots' and each other's (library bots keep their own), and marks a library bot the home already follows
  `inHome`. Nothing is kept. The plan reads the same statements for a home of 4 bots as of 61: four reads at once and
  one for the templates followed (`tests/server/botPlans.integration.js`).
- **A question** (a request too vague to choose from, or one Mercbot won't help with) shows above the Describe box, for
  the person to add to and suggest again.
- **New bots' templates.** As soon as a plan shows, each new bot's template is written, one drafting call each, all at
  once: `POST …/bots/templates/draft` with purpose `plan-bot`, `{ describe, bot: { name, tag, description }, team }`
  (the others' names and lines, at most 7; 400 `bots_template_draft_bot`, `_team` and `_tag_taken`). Its draft keeps
  the plan's tag whatever the answer says, and its instructions must say "Ask before anything leaves this chat." or
  "Nothing leaves this chat without the person's yes", the library's own rule (`templateChecks.test.js`); otherwise it
  is asked once more, then refused. Every draft's system prompt now carries how Mercbot's own templates are written: one
  job, numbered setup steps of one question each, a question card for a choice, answers saved as memories (*since
  D-112, in a "<job> notes" document in the chat's folder, /files/chat, which the bot reads before every piece of
  work*), routines made paused and started on a yes, and that sentence.
- **Suggested bots** (`MercbotPlanReview.vue`, `useBotPlan.js`) shows "For: …" and the summary, then **From Mercbot's
  library** (each with why, **View** for everything it's told, and its app for an owner or admin, ticked), **Your home's
  templates** and **New, written for this home** (each with its job, why, **Asks first**: its Setup interview's first
  three questions, **Read it all** and **Edit**, on the draft screen with Ask for changes and Undo, then **Use this**;
  "Writing its template…" meanwhile; "Couldn't write this one" with **Try again** and **Remove**). No reading is
  required before adding (amending D-98's whole preview, for a suggestion only). Every bot is ticked but those already
  in the home, shown unticked as **Already in this home** (**Archived in this home** when all its bots are archived,
  as D-108's team screen says); **Already doing it in this home** lists `covered`. A note
  says new templates are kept in this home, in Settings → Templates, and ask before anything leaves the chat.
  **Section in your sidebar** starts as the plan's name. **Not quite right?** plans again from the plan before, keeping
  the templates written for the new bots it keeps (one written for a plan since changed is dropped). **Add N bots** waits
  until each new bot ticked is written.
- **One path.** `POST /api/w/:workspaceSlug/bots/batch` with `{ section, bots }`, each `{ library }`, `{ home, name,
  shape, color }` or `{ draft, name, shape, color }`, makes them as a team's are (D-105): `botTeams.js` `addBots` and
  `addTeam` share one `make`, in one transaction, all or none, the home locked, each new template checked whole as Save
  and use checks one (422 with its problems), a library template the home's bots follow left out (`skipped`; 409 when
  nothing is left), in the section the person named, in the order given, the first one opening, "N bots added to
  *section*". 400 for no section (`bots_add_section`), no bots (`bots_add_empty`), more than 8 (`bots_add_too_many`) or
  4 new (`bots_add_too_many_new`), a template that isn't one of Mercbot's or is the general helper
  (`bots_add_template_unknown`), a bot with no template or two (`bots_add_template`), and a colour not the palette's.
  Making bots asks no model, so a paused home may still add them, as it may a team.
- **New home** asks only the home's name, and opens on Mercbot, who helps add the bots it needs; `?team=` and
  `addChosenBots` are gone. Its "Who's it for?" went too (the owner's direction of 21 November: nothing new offers a
  mode or who a home is for): the home gets the default it always started with, Mixed
  (`homeDefault.js` `makeHome`), so its first conversation doesn't ask either, and Settings → General still changes it.
  Neither Suggested bots, Add N bots nor a bot's look offers a mode: every new bot gets the home's default.
- **The first conversation's card** asks **Want a few bots to start with?** with **Show me ready-made teams**, which
  opens Add bots on its teams and adds nothing by itself, and **Not now**; a card answered with a team's name, from
  before, opens the list too. No AI reply follows either.
- **Limits and what's left out.** 8 bots and 4 new per suggestion; no learning for the library from what people
  describe.
- **Tests.** `tests/server/botPlans.test.js` (the prompts and their sizes, every library bot and team in the system
  prompt, reading and mending a plan, its problems, the plan before); `tests/server/botPlans.integration.js` (one
  metered call told the home, nothing kept, the retry and refusal, a change, a question, the same statements for 4 bots
  as 61, Add N bots with library, home and new bots, all or none and every refusal, `plan-bot` drafts and their
  refusals, a paused home's plan refused and its Add allowed); `tests/server/teams.test.js` and
  `teams.integration.js` (`for`, the card); `tests/client/botPlan.vitest.js` (drafts all at once, Add waiting, failures,
  a change keeping drafts, a late draft dropped, a question, the first questions); `tests/client/teams.vitest.js`
  (grouping, Add N bots of a suggestion); `tests/e2e/add-bots-describe.spec.ts` (a shop's request through the stand-in
  model, a change, Add 3 bots with their templates, the home asked what's missing, a question; light, dark and phone),
  `template-drafts.spec.ts` (One bot's search to Describe, Edit, Ask for changes, Undo, Use this, Add 1 bot),
  `new-bot.spec.ts`, `team-add.spec.ts`, `new-home.spec.ts` and the specs that open Add bots. A real model's speed and
  cost for a plan is not measured here: tests never call a real provider.

## D-110 — One account workflow for every app, and one control that signs in (2026-11-21)

The owner's report, after adding accounts in a home of four: the new-account experience is "TERRIBLE … It needs to be
rethought completely. I really hope that there is ONE workflow and that fixing one will fix them all." Who can use an
account couldn't be changed once it was signed in; Disconnect left a line with its old name, no address and no way to
change it; Authorize stayed disabled until a label was typed; the first line had no Remove; after Uninstall, adding again
forced "Everyone"; and signing a line in again quietly made it another mailbox (the browser's other Google session).
Then: "Both "Connect" and "Authorize" will start an oauth session?!", and of the page a sign-in ends on: "The main button
should be "close", then a little "Back to Mercbot"". The owner said yes to this design, its four choices included.
- **One workflow.** Every app people sign in to (Google's, Microsoft's, GitHub's, and those with their own connection
  point, D-34) and every app connected with API credentials (D-93) uses the same account line and the same Add account
  step, on an app's page in Connect apps and from a bot's connect card (`MercbotAddAccount.vue`, `accountLine` and
  `addAccountStep` in `appsCatalogue.js`, one server flow in `integrationsService.js`).
- **The account line.** "label · address", or the address alone (a label is optional); who can use it; its status; Sign
  in again (or Sign in, Reconnect, Retry) only when it needs one; and a bin, on every line, the first and the only one
  included. (Who can use it was a Just me / Everyone switch here; D-111 supersedes it: every account is its home's, and
  the line says so in words.)
- **One control signs in.** In Connect apps exactly one control starts a sign-in, and it says so: the Add account step's
  **Sign in with Google** (Microsoft, GitHub, or the app's name), under a note saying what opens ("A Google window opens
  so you can pick the account.", or on a phone "Google's sign-in opens here, then brings you back."), or a line's own
  Sign in again. **Add to my apps** (the app's page, **Add to this home** since D-111; **Add** in the catalogue) adds the app and opens the Add account
  step; **+ Add account** opens it; the bot's connect card's **Connect** (was Authorize) opens what connecting means and
  the same step. Your apps and skills shows each app's state as words, and its row opens the app. A line's Sign in again
  is hidden while the Add account step is open. An app connected with API credentials opens its form instead.
- **Adding an account.** The label may be empty; the button is never disabled for want of one. Adding an account adds
  the app too (before: 409 "Add the app first"). (A Just me / Everyone choice was made here; D-111 removes it.) The
  partial unique index that held every app to one unlabelled home account is narrowed to apps whose API credentials are
  the home's (Sedna; `ix_plugin_accounts_home_app_unlabelled`, migration `20261121225000`), so two unlabelled home
  Gmail accounts may coexist.
- **Who can use it, changed in place.** Superseded by D-111, which removed the switch and its route (`PUT
  …/plugin-accounts/:id/home`) before release: every account is its home's.
- **The bin removes, withdrawing first.** Removing an account withdraws its sign-in at the app where it offers that
  (Calendly, Notion, Todoist) and tells the hub of a borrowed one, then deletes it; before, Remove and Uninstall skipped
  the withdrawal, and a connected or only account couldn't be removed at all. Who may remove one is D-111's: the person
  who added it and the home's owners and admins (403 `integrations_account_manage_forbidden`). Sedna's bin forgets the
  home's credentials and its people matches; **Change credentials** stays.
- **No Disconnect.** It is gone from people's screens and its route (`DELETE …/plugin-accounts/:id/connection`): the
  bin is how an account stops, and an app's Tools switches stop single actions. Whoever runs the copy keeps disconnecting
  any account (`connections.disconnectAnywhere`, for whoever runs the copy), which leaves a line with no address that
  shows Sign in and its bin.
- **Remove from my apps** (was Uninstall) asks first, naming what goes. Since D-111 it is **Remove from this home**,
  which takes the app and all the home's accounts of it.
- **Signing in again keeps the mailbox.** Every provider shows its account chooser (Google `prompt=select_account
  consent`, Microsoft and GitHub `select_account`), suggesting the line's address when it has one (`login_hint`;
  GitHub's `login`). If the provider answers with another address, nothing changes: "This Gmail account is
  pat@example.com, but you signed in as sam@example.com, so nothing changed. To connect sam@example.com, use + Add
  account." (compared without regard to case; the same holds for a sign-in a hub lends).
- **Where the sign-in happens.** On a computer it opens in a window of its own (a popup, `noopener`). The page it ends
  on tells this browser's Mercbot tabs how it went on a `BroadcastChannel` ("mercbot-sign-in"), which works although the
  provider's cross-origin policy cuts the link to the opener, and once a tab answers and it connected, closes itself;
  the tab shows the account connected at once, its few-seconds check kept behind it. On a phone's width (under 600 px,
  D-38) it takes Mercbot's own tab, which leaves its way back in session storage, and once connected the page
  goes straight back to the home with Connect apps open on the app (`?connect=<app>`).
- **The page a sign-in ends on.** Its title and sentence ("Connected to Google", "Couldn't connect", or "Your
  organisation needs to approve Mercbot" with its approval link), then one main button, **Close**, and under it a small
  **Back to Mercbot**. Close calls `window.close()`; a browser keeps a window a page didn't open, so when the window is
  still there 300 ms later the button gives way to "You can close this tab now." Close never does nothing. A sign-in that
  didn't connect offers **Try again** in Close's place, which starts the same account's sign-in again from where it
  began (`/account/connect` leaves its own address in session storage); with none, Close. Only a path on this site is
  followed. `/account/connect`'s own problem page has Close, which in a tab the sign-in took goes back where it began. The script is served at
  `/api/connections/sign-in-page.js`, so it runs under a Content Security Policy without inline scripts.
- **An app's page in words.** The "Apps N" list of its connectors' code names (such as "gmail · Connector") and the
  "Skills N" list of its skills' code names are replaced by **What your bots learn**, the skills' descriptions; the code
  names stay in View source.
- **Not met yet.** A hub-lent sign-in gets no address suggested at the hub, and its window doesn't close by itself on
  the copy's site. Removing a Google, Microsoft or GitHub account doesn't revoke its key at the provider, since that
  revokes the person's whole grant to Mercbot, cutting their other accounts of the same address (the key is deleted
  here). A browser that blocks windows opened after a wait (Safari) may block the sign-in window, as before. Nothing yet
  refuses removing the Drive account that holds a home's files.
- **Proof.** `tests/server/accountWorkflow.integration.js` (no label, adding after the app was removed, every line's bin
  with the withdrawal first, Sedna's one unlabelled home account; D-111 replaced its switch tests);
  `tests/server/connections.integration.js` (signing in again as another address changes nothing, here and through the
  hub); `tests/server/signInReturn.test.js` (the account chooser and address for each provider; the end page's Close,
  "You can close this tab now", Try again and way back, only on this site); `tests/client/appsCatalogue.vitest.js`,
  `connectFromCard.vitest.js`, `signInWatch.vitest.js`; `tests/e2e/accounts.spec.ts` on Chromium, Firefox and WebKit
  (the count of controls that start a sign-in, 0 before the Add account step and 1 on it, the window closing by itself,
  the bin, removing the app, the phone's same-tab return, and the end page's buttons), with
  `sedna.spec.ts`, `connector.spec.ts`, `drive-storage.spec.ts` and `shell.spec.ts`.

## D-111 — Every connected account is its home's (2026-11-21)

The owner, reversing D-110's Just me / Everyone switch before release: "every connection is public by definition", and
"there are NO private connectors anymore. Every connector is public." This supersedes D-37's split of connected
accounts into a person's own and the home's, and D-110's switch.
- **One kind of account.** Every connected account belongs to one home (`plugin_accounts.workspace_id`, now required),
  and everyone in the home, and every bot there, may use it, in any chat: a person's own chats, a Shared bot's shared
  tabs and group chats alike. `user_id` says who added it. There is one permission path, the home's, with no own-plus-home
  split (`accounts.js`: every read is scoped to the call's home; the old `rowPolicies.js` is gone). Two rules of their own
  stay: an app connected with the home's API credentials acts as each person's own user there, so it is used only in a
  person's own chats (D-93, D-94), and Sedna's tools run only in a person's own chat (D-93).
- **Who may do what.** Adding an account: anyone in the home, as adding an app is (an app whose API credentials are the
  home's stays its owners' and admins', 403 `integrations_home_app_forbidden`). Renaming, removing, signing in again and
  choosing its Request pace: the person who added it and the home's owners and admins, else 403
  `integrations_account_manage_forbidden` ("Only the person who added this account and the home's owners and admins
  can change it."). The list answers each account's `addedBy`, `addedByYou` and `canChange`, and each app's `canRemove`;
  the line shows Rename, Sign in again and the bin only to those who may.
- **The home's apps.** The apps on a home's list are the home's too: `home_plugins` (home, app, who added it, when; one
  row per home and app) replaces each person's `user_plugins`. **Add to my apps** is **Add to this home**. **Remove from
  this home** withdraws every account of the app in the home at its app and the hub, then deletes them and the app's row.
  It is the home's owners' and admins', and the person who added the app's while every account of it in the home is one
  they added; otherwise 403 `integrations_home_app_remove_forbidden` ("Only the home's owners and admins can remove
  <app> from the home while it has accounts someone else added."), and the button isn't shown. Removing an app's last
  account keeps the app on the list.
- **Plain words.** The Add account step and every account's line say who uses it: "Everyone in <home>, and their bots,
  can read and send from <address>." for a mailbox (Gmail, Outlook), "… can use <address>." for any other app ("the
  account you connect" before it's signed in), then "Added by <name>." or "Added by you." The bin asks "Remove it for
  everyone in <home>? Their bots stop using it."; Remove from this home asks "Remove <app> from <home>, with its account?
  Everyone's bots stop using it." A bot's connect card says nothing is changed or sent without a yes on its card first.
  Nothing about sending changes: a send card shows which mailbox the mail goes from, and it is answered
  as every card is (in a person's own chat by them, in a group by the person who asked, D-46; in a Shared bot's shared
  tab by anyone in it).
- **The bots' view.** Each reply's current state names every connected account with who connected it: "Gmail:
  pat@example.com (the person's own, connected by them)", or "(connected by Sam)" (`botTurns.js`). "(the home's)" is gone.
- **Sign-in codes and links stay with the person who connected the mailbox.** With every mailbox shared, anyone's bot
  could otherwise sign in to someone else's accounts with a code or a magic link from that person's mail. So a bot sees
  them only in mailboxes that the person whose turn it is connected (`signInSecrets.js`). That person is the call's
  actor (`turnPerson`): whoever wrote the message, in a shared tab or a group too, the routine's owner in a routine, and
  the person a job acts for. Reading any other mailbox, `search_email`, `read_email` and `mail_drafts` (list and read)
  hide them in the subject, the snippet and the text before the bot sees them, as "[sign-in code hidden]" and
  "[sign-in link hidden]", and tell the bot why and not to look for them another way. Sedna's reads hide nothing: they
  read as the person's own Sedna user, only what their own teams see there (D-93). A year after a
  month's name ("21 Nov 2026") isn't taken for a code, so a sign-in alert's date stays. Typing a code from
  email into a page (D-77) reads only mailboxes the person connected. **This is a heuristic**, read from the words: a
  code is 4 to 8 digits, two groups of 3 or 4, or 6 to 8 capitals and digits with a digit among them, on a line that
  talks of a code, signing in, verifying, a password or two-step sign-in, or on one of the two lines after it, or
  anywhere in an email whose subject does; a link is one whose address speaks of signing in, verifying, confirming, a
  reset, a token, a one-time code, an invitation or an activation, or that stands on or just after such a line. It hides too much rather than too
  little (a promotion's code beside "code" goes too), and misses a code in a picture or written in words.
- **Leaving takes one's accounts.** When someone is no longer in a home (removed now; a leave, which doesn't exist yet,
  the same way), the accounts they added there are withdrawn at their app and the hub, then deleted, and the home's
  Activity trail says so, by Mercbot: "removed Gmail pat@example.com, which Pat connected, as they're no longer in the
  home" (`departures.js`). It runs on every change of the home's people that JSKIT tells of (`entity.changed` for the
  home's members, after the change is saved) and reads the home as it is, so any end of a membership is covered; one
  that fails is logged and done at the home's next change of people. The apps they added stay on the home's list. A
  Google Drive that holds the home's files goes too, and the home's files then need Settings → Files again: public
  Mercbot refuses no removal for it, so a host that should refuse one does so before the removal
  (`storage.heldInTheirDrive` counts the Drive accounts the person added).
- **People's own accounts are moved, once** (migration `20261121230000_accounts_belong_to_homes`, one transaction).
  Each account without a home goes, the same row with its keys, address and pace, to exactly one home: the home whose
  files are kept in that Google Drive, or being moved into it (Settings → Files, unsealed with `MERCBOT_VAULT_KEY`, the
  env the migrations run with; the first such home when two use it; with no key, or a setting that doesn't open, this
  step finds nothing); else the one home the person is in besides their own first home, when there is exactly one; else
  their first home (the one made for them, else the first they're in). One whose person is in no home is deleted, as
  nobody could reach it. An unlabelled Sedna row without a home is named "Sedna <id>" first, as such apps keep one
  unlabelled account a home. Each app goes on the list of every home that holds one of its accounts, added by whoever
  added the first; an app someone added with no account goes on their first home's list. Then `user_plugins` is
  dropped, `plugin_accounts.workspace_id` is made NOT NULL, and `connect_follow_ups.personal` and its person index
  `ix_connect_follow_ups_person` are dropped (a connect card's follow-up now waits for any account of its home's app,
  found by `ix_connect_follow_ups_home`). No row makes it fail.
- **This release can't be rolled back.** Nobody uses Mercbot before day 0, so the move, the dropped table and the
  required column come in one release, with no compatibility step; the migration's `down` refuses. An older server
  still running during the switch-over that writes an account without a home is refused by NOT NULL.
- **Proof.** `tests/server/characterization/connectedAccounts.integration.js` (everyone and every bot reach every
  account of their home and none of another's; the switch route answers 404), `accountWorkflow.integration.js` (who
  adds, changes and removes; Remove from this home), `homes.integration.js` (a member can't rename, remove or pace
  someone else's account, an owner can), `connectAppsReads.integration.js` (the bots' view names who connected each),
  `signInSecrets.test.js` (realistic sign-in emails hidden, ordinary ones kept, and `search_email` and `read_email`
  hiding them in a mailbox someone else connected but not in the person's), `signInCodes.test.js` (a code is typed only
  from a mailbox the person connected), `departedAccounts.integration.js` (a removal through JSKIT's route takes the
  person's accounts of that home, with its Activity entry), `accountsBelongToHomes.integration.js` (the migration on
  each branch), and the browser specs `accounts.spec.ts`, `sedna.spec.ts` and `shell.spec.ts`.

## D-112 — Chats are the core: members, Public and Private chats (2026-11-22)

*Supersedes D-36's three modes, home notebook and per-person conversations, D-46's groups (it keeps "bots aren't
permission" and the request limits), D-99, D-100, D-101 (generalised to archiving a chat) and D-102 (bots joining in
come back per chat in B4). Amends D-21 and D-47 (where files go), D-41 (the Builder's chat for an app), D-66 (a chat
can be Private), D-77 (codes and coding in any chat a person asks in), D-105 and D-109 (bots made together wait on the
Team page) and D-108 (an archived bot is a member who has left). The accounts build (D-110, D-111) covers every
connection and the vault being the home's, codes coming only from the asker's own mailbox, and leaving disconnecting.
Version 0, phase B1 of the rebuild; B2 (D-113) adds the bots' memory, B3 (D-114) people in chats, B4 (D-115) bots
together.*

The owner's decisions of 21 November, in the owner's words where there are some:
- **Brave.** "BE BRAVE. This is the time to make big changes. We have no users. This is THE TIME." and "No, we are
  doing this. This is the way to go." Chats are the core of Mercbot.
- **Version 0, no tech debt.** "No tech debt. NO TECH DEBT… This is version 0." and "There is no real data, no Stripe
  anything, there is nothing in the DB." So there is no compatibility code, no expand and contract, nothing kept "for
  one release": the old shapes are deleted outright, and the one forward migration
  (`20261122120000_chats_core.cjs`) starts by deleting every bot and every chat-bearing row. Homes and people stay.
- **Bots are members of the home, exactly like people.** "I really want the bots to be the SAME as users. Like the exact
  same, with the difference that they are bots. The other difference is in their knowledge." A bot isn't a sign-in
  account (no password, email, invitation or role) and holds no permission (D-46): approvals, settings, inviting and
  removing stay with people, and a card is answered only by the person whose message started the turn.
- **The chat list starts empty.** "So to start with, you have no chats. The chat list is empty." Bots live on the Team
  page; a chat appears when someone starts one or a bot writes to them.
- **Every connection is the home's** ("connections must be shared or simply not there"), and so is the vault ("Public
  valut: YES."): D-110 and D-111.

### Privacy is three rules, plus the accounts build's codes

1. **The one reading rule** (owner, replacing the review's glass rule and its per-object rules). "I want to make
   privacy rules VERY minimal, and only if they are VERY easy to reason about." "I want you to think in terms of what
   *can* be read… it's about POTENTIAL OF ENTRY, not ACTUAL ENTRY." **A bot in a chat may use anything that everyone
   who can open that chat can also open.**
   - Who can open a chat: a Public chat, everyone in the home, now and later; a Private chat, its people (being added
     is being a member; B1 has no invitations). Bots open nothing; only people count. Whether they have actually opened
     it doesn't matter.
   - So in a Public chat a bot uses every Public chat of the home and the home-wide things, and never a Private chat,
     even when all of the Public chat's current people are in it (someone who joins the home later can open the Public
     chat). In a Private chat it uses every Public chat, the chat itself, and every Private chat whose people include
     all of this chat's people: Tony alone with Tripbot gets every Public chat and every Private chat Tony is in.
   - Requests between bots follow it too: the asked bot works under the asking chat's openers, on the brief alone (no
     chat history), and its answer and cards go to the asking chat; if it needs its computer, it joins the asking chat
     as a member, with a line.
   - Work made for the whole home (a template draft from a bot, a bot's card on Team) reads as a Public chat does; work
     that leaves the home (a copy's published template descriptions, `answerOnce`) reads no chat at all. A person's own
     things (their saved skills) are opened by that person alone, so a bot uses them only in a Private chat whose only
     person is them.
   - It lives in one place: the SQL function `readable_from(chat)` and the model's reader (`records.readers.forBot`, a
     caller every row policy honours), through which every read the model's side makes runs, tools, the state note
     and background runs included. Nothing else checks privacy.
2. **The one making rule.** **What a bot makes in a chat (files, pages, notes, watches, routines, drafts) belongs to
   that chat and has that chat's openers.** Putting it where more people can open it (the bot's folder, the home's
   folder, a Public chat) is done by a person, on a card they tap or by themselves, never by the bot alone, and the
   server checks the card. From a Public chat the bot's and the home's folders don't widen anything; from a Private chat
   they do, and need the card. The bot's additions are read in every chat of the bot, so changing them from a Private
   chat needs the card too.
3. **A chat's computer belongs to its chat** (owner, replacing "codes, coding and Sedna only where the asker is the only
   person"). A chat's computer, with everything signed in on it, its files and its coding work, belongs to that chat
   under the two rules above: anyone who can open the chat can use what's signed in there. When a sign-in happens on
   it the bot says so in one plain line, "Everyone who can open this chat can use this sign-in.", with no pause and no
   other rule. Sedna keeps acting as the asking person's own Sedna user (D-93); background work runs as the person who
   set it up. There is no "only person in the chat" check anywhere, and adding a person to a chat pauses nothing.

Sign-in codes come only from a mailbox the asking person connected (the accounts build): account security, not chat
privacy.
Nothing else is a privacy rule.

### Public by default, and the computers clear

- **Every new chat starts Public** (owner: "just default to PUBLIC, and then you can pick private if you really have
  to"). Whoever is in it, a chat of one person and one bot included. Private is an explicit choice when the chat is
  made, and the kind stays fixed: Public never becomes Private, since what was read can't be unread. New chat shows
  Public as the default and Private as a clearly marked option, with one line under it: "Only its members can open it,
  and nothing in it reaches other chats." Chats made without New chat (a bot's Message, a new bot's greeting, Mercbot's
  welcome chat, an app's Builder chat, the everyone chat) are Public. So a person's chat with a bot is read by every
  bot in the home's chats and by everyone in the home, and a direct chat is just the chat Message reopens, one per
  person and bot, Public like any other.
- **A chat's computers are clear, and people can still take over** (owner: "The UI needs to be clear about this, and
  users must be able to take over still"). In a chat each bot's computer is shown and labelled as that bot's
  ("Tripbot's computer"), says that it belongs to this chat and that everyone who can open the chat can watch it and
  use what's signed in on it, and shows what is signed in there; with several bots they are listed one per bot, never
  merged. Any person who can open the chat can take over a bot's computer, as before, including the hand-over that
  waits on it (`chat_bots.waiting_task`, D-14); while a person has control the bot doesn't act on that computer, and
  handing back works as before. The chat shows a line when someone takes over and when they hand back.

### The model

- **`conversations`**, one row per chat: its home, `kind` (`public` or `private`, checked), `everyone` (the home's
  everyone chat, Public, one per home), `direct_user_id` and `direct_bot_id` (a person's direct chat with a bot, both or
  neither, with no title), `title` (up to 80), `app_id` (the Builder's chat for an app, Public, one per app),
  `made_by`, `onboarding_step` (the welcome chat's script), `archived_at` and `archived_by`, `last_activity_at`.
- **Two member tables**, which the screens show as one list. `chat_people`: a person in a chat, with their own place in
  it (read point and unread, pin, section, hidden, muted). `chat_bots`: a bot in a chat, its position, its waiting
  hand-over and its job notes. A `chat_bots` id is "this bot in this chat": its reply runs, goal and to-do list, job
  notes, computer, browser state, tickets, command runs, routines, watches, app jobs, follow-ups and requests hang off
  it, so two bots in one chat have two computers and one bot's long goal never blocks another's reply. The agent
  engine's summaries are by chat, one summary of the shared chat.
- **`messages`**: everything said in a chat, written by a person, a bot or Mercbot itself (both authors null).
- **`conversation_sections`**: a person's sidebar sections.
- **`bots`** lose `kind`, `sharing` and D-98's unread `label`, `instructions`, `skills` and `origin`, and the
  `bots_before_templates` copy; `user_id` becomes `made_by`, set null when that account goes, so a person's account
  going no longer deletes the bots they made. D-108's `archived_at` and `archived_by` stay.
- **Re-keyed:** routines by bot in chat plus `made_by` (a routine runs as the person who made it); requests from a bot
  in a chat, to a bot, in the asking chat, for the asker; computers, browser state, tickets, command runs, watches, app
  jobs and follow-ups by bot in chat; the vault and the app actions turned off by home; a person's saved skills,
  approval rules and auto-review per person per home.
- **Deleted outright:** `bot_conversations`, `bot_messages`, `bot_group_members`, `bot_group_people`,
  `conversation_reads`, `bot_sections`, `bot_notebook`, `person_memories` and `home_settings` (D-100's default mode
  and its question, D-102's join-in), with their indexes, trigger, row policies and code: the modes, the home notebook,
  Shared tabs and You only, groups made of bots, rooms, personal memories (`remember` and `forget`) and the home's
  default for new bots. The files bucket is emptied with the database at release, except `.mercbot-files`.

### The rules

- **Visibility.** A person in the home sees a chat when it's Public or they're in it, and its messages and members with
  it; every bot of the home (archived ones marked); an anonymous visitor nothing. Reading a Public chat doesn't join it.
  Anything the caller can't open answers 404.
- **Members.** Anyone in the home starts chats and adds the home's people and bots (not archived ones) to a chat they're
  in; adding a person to a Private chat warns "<Name> will see everything said here." The chat's maker and the home's
  owners and admins remove members, rename, archive and delete; anyone leaves. Only a Public chat is archived, for
  everyone, and never the everyone chat: its bots' routines and watches there pause with D-101's "Paused while
  archived" line and stay paused when it's unarchived. A Private chat isn't archived (409
  `bots_chat_private_archive`, "A private chat is hidden for yourself, not archived for everyone."): each of its people
  hides it for themselves. The chat list leaves archived chats out unless asked, and then adds them beside the others,
  as it does hidden ones. A Private chat whose last person leaves is deleted. Deleting a chat deletes its folder and its
  bots' computers. A direct chat takes no more members, so Message always finds it. The home's everyone chat has every active person of the home and is pinned first for each
  of them (no pin is stored, so it can't be unpinned or moved); nobody leaves it or is removed from it (409
  `bots_chat_everyone`). When the home's people change (the workspace's member event, whoever adds or removes them),
  whoever joined is seated in it and whoever left is taken out of every chat. Leaving the home removes the person's
  member rows, deletes their Private chats that no other person is in, pauses their routines and
  watches with a line, and keeps their messages in shared chats under their name.
- **Who speaks.** With one person in the chat, every bot member answers in order, or only those @-mentioned; in a
  direct chat its one bot always answers. With several people, a bot answers when its name appears as a word, it is
  @-mentioned, it is replied to, right after its own card is answered, or on @everyone. Then one follow-up round: bots
  another bot mentioned may answer once, and PASS stays quiet. Each bot's reply is its own run; a message heard during
  one bot's reply still reaches the bots it was addressed to. Archived bots never speak. A chat of people only makes no
  model call.
- **What a bot may use:** everything connected to the home and the home's vault, in any chat, as the person who asked;
  codes and coding in any chat a person asks in (never a routine, an app's task or work another bot asked for), and
  Sedna in any chat as the asking person's own Sedna user (a routine on Sedna mail as its maker, which never sends);
  approvals always the asker's. Background work runs as its own person: a routine as its maker, a watch as its creator,
  an app job and a follow-up as theirs, a request as its asker's.
- **What a bot knows,** in prompt order: the cached prefix (Mercbot's rules, the template, additions and Knowledge),
  identical in every chat of that bot, so the per-chat framing moves out of it; the chat word for word with its summary
  (D-41); and the state note last (D-57), with the chat's framing (its name, the people present, the time zone, the
  folders). B2 adds memory after the chat, in the state note, so the cached prefix stays warm.
- **Files:** one folder per chat, `homes/<home>/chats/<chat>/`, which bots see as `/files/chat` (in place of the old
  per-person `/files/mine`); the bot's folder (`/files/bot`, its Knowledge files and the pages it makes in Public chats)
  and the home's (`/files/shared`) stay. Files and computers are reached by chat and bot (`?chat=&bot=`).
- **Money:** the home pays; each turn is recorded with the person whose message started it and the bot that spoke;
  background work with its own person; compaction with the home and the bot and no person.
- **Unread and news** are per person per chat; a Public chat's news also reaches anyone with it open.
- **Every path that builds a model's input** is a row in one table (`packages/bots/src/server/modelInputs.js`) with a
  guard test: a new model call with no row fails it.

### Screens and words

- **The sidebar** is the person's chats: pins, sections, hidden, unread and drafts as before. A direct chat shows the bot;
  any other chat its faces, its title and a globe (Public) or a lock (Private). A brand-new person sees one chat,
  Mercbot's welcome chat.
- **Team**, beside Files and Apps, lists the home's people and bots alike, each with Message; a bot's card holds what its
  Details held. Archived bots are listed under Archived with Resume.
- **New chat** (Ctrl+Alt+G, the (+) and the palette) picks people and bots, Public by default, a title, and offers the
  Public chats to join.
- **A chat's header** shows its members, its kind and Add; the composer says who can read it ("Everyone in <home> can
  read this", "Only you and Chef can read this"); its details list members, kind, files and routines, archive or
  delete, and leave.
- **Add bots** (D-109) lives on Team and in New bot. Bots it makes appear on Team, and Mercbot's welcome chat introduces
  them with Message buttons; a single bot made with New bot still greets in its new direct chat. The welcome chat then
  asks "Will anyone else use this home?": Me and other people makes the home's everyone chat, pinned for each person.
- **Archiving:** an archived bot is a member who has left: it stays in its chats, greyed, with "left" by its name, never
  speaks, its routines and watches pause, and its direct chat says "<Bot> has left <home>. Resume it to talk again." A
  Public chat is archived for everyone by its maker or an owner or admin; a Private chat by a member, for themselves.
- **Templates and skills** say `/files/chat`. Each template keeps its setup answers and lasting preferences in a notes
  document in the chat's folder named for its job ("Competitor watch notes"), read before every piece of work, routine
  runs included, in place of memories saved with `remember`: it belongs to the chat, anyone who can open the chat can
  read and correct it, and it survives the chat's summary. The group-chats skill is Chats with others.

### Choices made for the owner, by the plan's recommendation

A chat's kind is fixed at creation (Private to Public maybe later). One sidebar list, as before. The everyone chat is
pinned first for each person. Personal memories are replaced by B2's home notes and memory, nothing personal kept per person.
A removed person's Private chats go once no other person is in them. No squash of migrations in B1. Bots joining in
(D-102, on by default in Shared tabs) are removed and come back per chat in B4, off by default. Leaving or archiving a
chat leaves what a bot learned; deleting a chat, removing messages or a safety removal forgets it (B2). Requests between
bots work on the brief alone. A person's saved skills are theirs per home; the app actions turned off are the home's.
When the Builder changes, the new one joins every app chat and the old one stays until removed. Template files carry no
`changes` entry for this: no bot predates it.

## D-113 — Bots remember their public chats; private chats are one-way glass (2026-11-22)

*Phase B2 of the rebuild, on D-112. It records the owner's D9 and D10 and the prompt's layout, and completes D-112's
replacement of D-36's notebook and memories: what a bot remembers is the home's public chats and the home's notes,
nothing personal kept per person. Amends D-57 (the state note ends with the memory) and D-112's composer words.*

The owner's decisions of 21 November, in the owner's words:
- **Person-like memory (D9).** "I want to make the bots REALLY, REALLY person-like… the *public* conversations are
  *public*. In a public room, there are no secrets. If tony has a group conversation with tripbot in Public Chat A, and
  chiara has a group conversation with tripbot on Public Chat B… the bot should be aware completely of both
  conversations. We should be able to engineer a good way to make sure that the cache doesn't bust." And: "private
  chats with a bot are private."
- **One-way glass, a hard wall (D10).** "ideally the private conversations are aware of what has been said in groups,
  but the group context should be completely unaware of private conversations." A private chat never enters another
  chat's model input, not even as "this is secret". It is enforced in the queries (the model's reader,
  `readable_from`, D-112), never by asking the model.

### What a bot remembers

- **A digest of its public chats** (`bot_memories`, one a bot, `botMemory.js`): a section per public chat it's in
  (title, who is in it, decisions, facts about people, open threads, promises, the gist), newest activity first, each
  line starting with its chat and speaker; a quiet chat shrinks to a line. It never holds a private chat, because it is
  read in every chat of the bot: it is read and written through the memory's own reader, which reads public chats
  only. About 12,000 tokens asked for, 20,000 at most (cut at a chat's section).
- **Written by the background model** (the Flex tier, D-59), metered to the home and the bot with no person (R8), from
  the earlier digest and each chat's new lines (200 a chat, 48,000 tokens shared between them), or from the chats
  themselves for a rebuild. Saved only while it still `follows` the stored version, so a slower server, or a
  forgetting meanwhile, never writes over a newer one.
- **Refreshed** when the bot's new words in its public chats pass 4,000 tokens (or 400 lines), but never sooner than
  30 minutes after the last; otherwise 24 hours after the last, if anything was said. A person's message and a bot's
  reply in a public chat ask for it; a private chat's words ask for nothing. The queue (`bot_memory_queue`, one row a
  bot) is claimed with SKIP LOCKED on every server (D-15), under a 180-second lease renewed every 30 seconds while it
  writes (20,000 tokens at 80–150 tokens a second can outlast three minutes). An ask during a run stays for its own
  time (`asks`); a refused save is due again at once; a failure waits 1, 2, 4… up to 60 minutes. A refresh asked for
  now starts at once on the serving server that asked, not at its loop's next turn, so a forgotten digest stays empty
  only as long as its write takes.
- **Forgetting (O23).** Deleting a public chat empties its bots' digests at once, so no turn reads them, and rebuilds
  them from the chats that are left (`rebuild`). Leaving a chat, archiving it or archiving a bot keeps what it
  remembers, as a person would; an archived bot remembers nothing new until it's back. Removing messages, or an
  operator's safety removal, calls the same forgetting (`bots.memory.forget`) where it exists; Mercbot has no route
  that removes a message.

### What a turn reads, and where

The prompt keeps everything that changes last, so a refresh never reprices a chat's history (D-57 measured exactly
that failure):

```
[ Mercbot's rules + template + additions + Knowledge ]    the same in every chat of the bot (R5), cached
[ this chat: its summary and messages, verbatim ]          grows at the end (D-41), cached
[ Current state note: the chat's state · home notes · digest · since then ]   last, uncached once per turn
```

- With the digest before the chat instead, each refresh would reprice every chat: a 200,000-token chat pays about
  $0.06 a refresh, and a bot in 10 such chats with hourly refreshes about $14 a day.
- **Every turn** reads the home's newest 30 notes. **A person's turn** (not a routine's, a watch's or a request's
  run, R5) also reads the digest and **"since then"**: its other chats the turn's chat may read (`readable_from`)
  with lines past where the digest read them, newest activity first, 12 chats of up to 8 lines (300 characters each,
  3,000 tokens in all), then "…and N more lines in M more chats: use recall or read_chat". One statement; three when
  more chats have new lines.
- **Tools, through the model's reader (R1):** `recall` searches what was said (full-text, any of the words) in the
  bot's chats, one chat, or with `everywhere` every chat the turn's chat may read, the home's public chats the bot
  isn't in too; 10 lines, each with its chat, speaker, time and line number. `read_chat` reads a window of one chat in
  reach, around a line or its newest. Both answer chat lines as information, never instructions.
- **Manners** (in the instructions, the same in every chat): say where something came from ("Chiara said in Trip B
  that…"), bring up another chat only when it helps now, never quote or describe a private chat outside it, offer to
  tell everyone what everyone should know.

### The home's notes

- **What everyone is told** (`home_notes`), read live into every turn of every bot, so a removal takes effect at the
  next turn. Written only through the always-ask card (R11): the bot asks "Shall I tell everyone in <home> that?
  "<text>"" (asked for by the person, or offered by the bot), and the note is written on the server from the card's
  own words once the card's person says Go ahead: one note a card, as that person, through that bot. A sealed note is
  a note the person words without the reason (O12).
- **The notebook's refusals stay:** an email address, nine or more digits (a date's aren't), or a password (a sentence
  giving one, or one of the vault's passwords), refused before any card.
- **Shown on every bot's card** (Details, under Knowledge: Memory, then Notes for everyone), newest first, with who
  asked and through which bot. Their author and the home's owners and admins remove them; a removed note is kept
  with who removed it. The chat a note was asked in isn't named, as a private chat's name isn't the home's to read.
- **The composer** of a public chat says "Everyone in <home> can read this · <bots> remember it", and so does its
  first-time notice; New chat's Public says its bots remember what's said there in their other chats.

### Choices made for the owner, by the plan's recommendation

The memory's lines are the state note's last part. Notes are read in every turn, background runs included (they are
the home's); the digest, "since then" and the tools only in a person's turn. A chat never digested shows its newest 8
lines in "since then". Deleting a public chat forgets it at once and rebuilds; leaving, archiving and archiving a bot
keep the memory. A note is written from the card's text, as the card's person. Notes live on each bot's card rather
than a section of their own on Team. The digest is everyone's to read on the bot's card, as its chats are.

### Measurements (B2's item 7, left for the owner)

Cache hits, the state note's cost per turn and the digest's cost per refresh are to be measured on the real providers
for both layouts (memory after the chat, as built, and before it), and recorded here. Method: one bot in three public
chats of 20,000, 80,000 and 200,000 tokens; ten turns in each chat with a refresh between turns 5 and 6; read each
call's provider usage (cached and uncached input tokens) from the meter's records (`work`, `cacheHit`, `cacheMiss`),
for chats on Together and digests on DeepInfra Flex (D-59). Cache lifetime at Together and DeepInfra is unconfirmed.

| Measure | Memory after the chat | Memory before the chat |
|---|---|---|
| Cached share of a turn's input, turns 2–10 | to be measured | to be measured |
| A turn's cost, 200,000-token chat, after a refresh | to be measured | to be measured |
| State note's cost per turn | to be measured | — |
| A digest's cost per refresh | to be measured | to be measured |

The bench (`tests/bench/memory.bench.js`, `npm run bench`, the real chat AI) checks how a model uses what it's handed:
two public chats with conflicting dates kept apart and attributed, a question answerable only from another chat, one
answerable only by recall, and a clever question that must not reveal a private chat. It has not been run.

## D-114 — People in chats: their files, mentions, reactions, and Continue with others (2026-11-22)

*Phase B3 of the chats rebuild (D-112). Amends D-90: a person's upload in a chat is checked as theirs in that chat,
whoever else is in it. Amends D-112's direct chat: it still takes no one else, and goes on with others in a new chat.*

What people do in chats with other people, beside what the bots do there:
- **Files in a chat with others.** A file a person attaches in a chat goes in Uploads in the chat's own folder
  (`/files/chat/Uploads`), whoever else is in it: other people, bots, or no bot at all. Everyone who can open the chat
  finds it there (a Public chat's anyone in the home, a Private chat's its people), and nobody else reaches it by any
  route: listing, folders, the viewer's preview, the file, its download, uploading, moving, a new folder, ticking a
  checklist, deleting, or opening it on a bot's computer, each the same 404 (`files_place_not_found`,
  `computer_not_found`). A copy that checks pictures and videos (D-90) checks each one before it's kept, as the person's
  upload in that chat (`origin: "upload"`, the person, the chat, its first bot when it has one, the chat's place):
  blocked or not checkable now, it's refused and nothing is kept. A file attached in New chat waits until the chat is
  made, then goes in its folder before the first message is sent; one refused is left out, saying why.
- **@-mentioning people.** In a chat of several, @ offers everyone, the chat's other people (never the person writing),
  its bots and the person's apps. A person chosen is sent as `<@person:ID>` and kept on the message by name
  (`body.mentionedPeople`, apart from the bots in `body.mentions`); the model, what the bots remember (D-113: digest,
  "since then", recall and read_chat) and previews read it as "@Name". Only the chat's other people are mentioned: a
  marker naming anyone else (the author, someone not in the chat, another home's person, no one) marks nobody and reads
  "@someone". Bots never write a person's marker. A mention of a person makes no bot speak (R3 is unchanged).
- **The "@" in the chat list.** A person mentioned has it waiting in their place in the chat (`chat_people.mentioned_at`,
  migration `20261122150000_chat_mentions.cjs`): set by the message, in its transaction, for every person it names in
  one UPDATE, and kept at the first mention's time while they haven't read the chat; reading the chat, or marking it
  read, clears it, as it clears unread. The chat's place answers `mentioned`, and its row and tile show "@" where the
  unread dot would be. A copy built on Mercbot can tell a person of a mention they leave unread, timing it from
  `mentioned_at`.
- **Reactions on people's messages.** Anyone in a chat reacts to another person's message as to a bot's, one quick
  reaction each, which they change or take away; never to their own message or to Mercbot's lines. Reactions are
  written by the database, so several people reacting at once each keep theirs. A message shows everyone's reactions,
  people's and bots', each emoji once with how many chose it, the person's own ringed.
- **Continue with others…** A direct chat (one person, one bot) takes no one else. Its header (and a phone's) offers
  Continue with others…, which opens New chat as Continue with others: Public, the bot on the To: line, and the bot's
  hand-over note as the first message, which the person reads, changes and sends as their own once they've added the
  people or bots to continue with (Start waits until someone besides the bot is there). The direct chat stays as it is.
  The note is one billed call as the bot's chat work, refused in a paused home (D-73) and for an archived bot (D-108),
  and only the direct chat's own person asks for it (`POST …/chats/:chatId/hand-over-note`; 403 `bots_chat_not_yours`,
  409 `bots_chat_not_direct` for any other chat). It's written from the direct chat's newest page as people see it
  (each message's text, a card's one line, files by name, under its author's name), read through the model's reader
  for the bot in that chat (R1), and never from a reply's transcript, a routine's prompt, the chat's summary or the
  bot's state note there (an R12 row in `modelInputs.js`). Nothing is kept: the new chat is New chat's, with no link
  back.

## D-115 — Bots join in and discuss (2026-11-22)

B4 of the chats rebuild (D-112): bots together in one chat. It supersedes what D-112 left of D-102 (its judging call
moves to chats, off by default) and closes D-46 step 3: bots talk together in a chat its people can read, on a card a
person runs, so there are no bots-only threads and no company chart. Bots still aren't permission: a discussion only
talks, and approvals stay with people.

- **Bots join in when useful** (O17, O27). A chat's setting, `conversations.bots_join_in` (boolean NOT NULL DEFAULT
  false), shown in **Chat details** under **Bots** as a switch when the chat has bots and isn't a direct chat. Its
  maker and the home's owners and admins change it (`PATCH …/chats/:chatId` with `{ botsJoinIn: true|false }`; anyone
  else 403, `bots_chat_manage_forbidden`; not a boolean 400, `bots_join_in_invalid`; a direct chat 409); everyone in the
  chat hears of it (a `chat` event, `settings`). The chat view answers `botsJoinIn`.
- **Who it changes.** Only a chat with several people, for a person's message that calls no bot (R3: its name, an
  @-mention, a reply to one of its messages, @everyone). Alone in a chat, every bot answers as before, and a call is
  always answered. On, such a message goes through one judging call, which names at most one of the chat's live bots,
  or none: with several people and nobody called, at most one bot joins per message. Off, nothing is judged and no bot
  answers. A paused home (D-73) judges nothing.
- **The judgement is kept on the message**, `body.judged`: the bot's id, or `"quiet"`. The first one kept under the
  message's lock stands, so two pages asking at once, another server, or a bot freed later (`answerWaiting`) read the
  same answer, and nothing is judged twice. `addressedBots` counts a judged bot as called, so a bot busy when it was
  judged answers once it's free.
- **The judging call** (`packages/bots/src/server/joiningIn.js`). One `generateOnce` on the chat kind of work, at most
  40 tokens out, metered to the person whose message it decides on, in the chat's home, and no bot (R8). Its fixed
  instructions list the chat's bots and their jobs (each one's template description, else the general bot's) and ask
  for `{"bot": "<its name>"}` or `{"bot": null}`: a bot when the message asks it something, asks for something its job
  covers, asks everyone a question it can usefully answer or carries on a conversation with it; null for people
  talking to each other, chatting, thanking, agreeing, saying goodbye, when an answer would interrupt, and when
  unsure. It reads the chat's last 12 text messages, oldest first, one line each, `[Author]: text`, mentions as names
  (the chat's bots, and the people a message mentions, D-114), each clipped to 400 characters, through the chat's own
  reader (R1). A failure, or an answer in another shape (a
  code fence around it is read; a name that isn't one of the chat's bots isn't), leaves the chat quiet, logged without
  the conversation. It runs in the background with the reply it starts, so a page's request never waits on the judge
  alone. Its statements are the same for a chat of 4 messages and one of 40
  (`tests/server/joinInChats.integration.js`).
- **Discuss** (O18, plan 4.5): in a chat with two or more live bots, a person writes a question and chooses **+** →
  **Discuss with the bots**. The server writes a card, a message of kind `discussion` by that person, whose body it
  alone keeps (`packages/bots/src/server/discussions.js`). Its question is kept in the words everyone reads: the
  composer's mentions of the chat's bots and of its other people as "@Name" (D-114), on the card, in the chat list and
  in each turn's prompt.
  - **Before it starts**, the card offers 1, 2 or 3 rounds (2 first) and what each may cost at most, "Up to about $X,
    as your work in this home", from the meter's estimate at the home's prices (`meter.estimateNano`: Mercbot's list
    prices, or a copy's own). The estimate counts every turn reading the chat (its summary and what's after, at about
    4 characters a token), a 24,000-token prefix for the bot's own instructions and Knowledge at the uncached price, and
    everything said before it in the discussion, and writing at most its output limit: 1,200 tokens a turn, 2,000 for
    the wrap-up, which the turns are given as their own limits so the estimate holds. Two bots and two rounds in a
    short chat come to about $0.05 at Premium AI's prices ($0.0478 on the Test Preview's card).
  - **Start** fixes the rounds and the cap: the chosen estimate. Before each turn, what the discussion has spent so far
    plus that turn's estimate must stay within the cap, or it ends there, mid-round if need be ("It stopped at its cost
    limit."). What it has spent is its own turns' AI calls only: each turn runs inside `meter.counting`, which hears
    every call made inside it, and each call is priced as the meter counts it (`meter.estimateNano` on the call's own
    figures, a cost its provider reported included). The person's other work with the same bots meanwhile, in other
    chats, never brings the cap nearer.
  - **A round** is one turn per bot, in the chat's order. A turn is the bot's reply with no tools, no checks that send
    it back and no reasoning, asked to add something new (a point, a fact, a risk, a disagreement or a question) or
    reply exactly PASS; a PASS posts nothing. A round in which every bot passes ends the discussion. Its messages carry
    `body.discussion` (the card's id) and `body.round` (a number, or `"wrap"`), and answer no person's message.
  - **A turn reads none of what the bot remembers** (D-113): its state note has the home's notes, as every turn's does,
    but not the bot's digest or "since then", and it has no recall or read_chat; so the estimate above is what it
    reads. Nor does it ask for a refresh: what it said is read by the next refresh another message asks for.
  - **No round runs by itself.** After each round the card waits: **One more round** (while rounds are left), **Wrap
    up** (the chat's first bot that took part sums it up: where they agreed and differed, and what is left to decide)
    or **Stop**. Only the person who started it presses Start, One more round and Wrap up; Stop is theirs and the chat's
    managers' (its maker, the home's owners and admins). Before Start, its starter can **Cancel** it.
  - **It holds the chat's reply runs.** A round claims each of its bots' runs in the chat (`claimReply`, renewed on its
    heartbeat), so a message written meanwhile finds them busy and is answered once the round lets go
    (`answerWaiting`). Stop ends the card at once; a running round sees it at its next heartbeat (every 15 seconds) or
    turn, stops the turn in progress and lets go. A press while one of the bots is still answering something else is
    refused (409, `bots_discussion_busy`).
  - **A round's card is leased.** Starting a round sets `leaseUntil`, and each heartbeat renews it while the card says
    that round runs: 75 seconds, a heartbeat past the 60 seconds after which its runs are stale. If the server running
    it stops, the lease lapses and the card reads as `interrupted` (`botRows.js` `discussionNow`, for every page's read
    and every press), never as running. A page's read of a running card also says how much of the lease is left by
    the server's clock (`leaseLeftMs`), which the card counts down on the page's own clock from when it came
    (`chatView.js` `discussionState`), so a browser clock ahead of the server's never shows a running round as
    interrupted: by then its runs are stale, so any server
    takes them over. Its person may press **One more round** (unless it was wrapping up, and while rounds are left),
    **Wrap up** or **Stop**, as after a round; only the rest of the interrupted round is lost. A round that was only
    slow, not stopped, finds its card no longer its own at its next heartbeat and stops.
  - **Metering** (R8): each turn is the person's work with the bot that speaks, on the chat kind of work, so
    **Spending** shows it per bot; the card shows what it has cost so far and in the end.
  - Ended reasons on the card: `passed`, `wrapped`, `stopped`, `cancelled`, `cap`, `paused` (the home was paused) and
    `failed` (a turn's error). The chat list shows a card as "Discussion: <question>".
- **Routes** (`packages/bots/src/server/registerRoutes.js`): `POST …/chats/:chatId/discussions` `{ question }` (at most
  500 characters), and `POST …/discussions/:messageId/start` `{ rounds, timeZone?, language? }`, `/round`, `/wrap`,
  `/cancel` and `/stop`, each answering `{ message }`, the card as it now stands.
- **Bench:** `tests/agent-evals/chat/discuss-three.mjs`, a three-bot discussion on a real model (not run in the suites).
