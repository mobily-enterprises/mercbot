# What's next

Everything planned, approved or promised for Mercbot that isn't done, in one place. Tick an item when
it's done and checked in the running app; add new items here instead of leaving them only in a design or
a decision. Rebuilt on 2026-11-11 from every design, decision, help page and code comment, each checked
against the code at the time (built items left out; done items from earlier lists are in git history).
Decisions (D-numbers) are in `docs/decisions.md`.

## 1. Unblocked, not started

What these waited for has happened, so nothing stops them now.

- [x] **Rich HTML pages** (D-40, D-63, D-74; `docs/pages-design.md`). Built 2026-11-11 (D-74): HTML pages
  with Mercbot's look and blocks, the bot's own look and scripts, nothing loaded from outside, a sealed
  frame from a page-only address, the card with a live preview, the viewer in place of the chat, ticks
  saved in the file, Share, Versions and Restore, a standalone copy, and the doorway to apps. Since
  2026-11-12 a page leaves the home on the person's own website (D-84).
  - [x] Recheck the design's sharing against D-66: "Only you" dropped, a page is the home's (D-74).
  - [x] Settle D-40's open quiz question: the app opens in its own view through the doorway (D-74).
  - [ ] Moving or renaming a page's folder (not the page itself) in Files doesn't take its versions and
    website publication along, and a renamed page's own files stay in the old `<name>.files/` until the bot
    saves it again.
  - [ ] A page deleted in Files (not from the Library) loses its versions, but its cards aren't marked
    Deleted (Files can't reach the chats); opened, they say "This page isn't here any more."
  - [ ] Pages people answer (an RSVP, a course's questions): LATER, through the doorway to an app meanwhile.
  - [ ] A page's script can take the focus as it loads and reuse the click that opened it: for the few
    seconds that click stays active, it opens a link in a new tab or one of the home's apps unasked (tried
    in Chromium, 2026-11-12). Mercbot's window can't tell that focus from a click in the page. Proposed:
    Mercbot's helper, which runs first in the frame, tells Mercbot of each trusted click or key over a
    private MessageChannel port Mercbot hands it as the page loads, and links and apps open only just after
    one; or links become the frame's own `allow-popups` (Chrome's popup blocker counts only clicks in the
    frame), leaving the doorway to the port.
- [x] **Drop the old permission columns** `apps.access`, `app_members`, `app_tables.writers`,
  `app_table_editors` (D-66, D-78): `app_members` and `app_table_editors` dropped 2026-11-12; nothing needed
  carrying over (D-66 keeps no grants inside a home).
  - [ ] Drop `apps.access` and `app_tables.writers` in a new migration (`alter table apps drop column access`,
    which takes `apps_access_check` with it, and `alter table app_tables drop column writers`). Nothing reads
    them since D-78.
- [x] **Google Drive as a place to keep bots' files** (D-26, D-80): built 2026-11-12. Settings → Files offers
  **In Google Drive** with a connected Google Drive account. Mercbot makes one folder, `Mercbot – <home>`, and
  mounts it with rclone like WebDAV storage, asking its own server for each key. A refused renewal shows **Sign
  in again** on the Files page and in Settings, and loses no files.
  - [x] Built the same day (D-80): a key Drive turns down (access withdrawn in Google) is renewed at once, so
    "Sign in again" shows within seconds; Settings → Files shows the Drive's free space, warns under 1 GB free,
    and says when Mercbot's folder is in the bin or deleted, with Choose again; a save waiting on a machine that
    stops while signed out may be lost (accepted, as with WebDAV).
  - [x] Every switch of a home's storage moves all its files (an overwrite, every time), built the same day
    (D-80): a background move, one per home, claimed under the home's row lock and carried on by another server
    if its own dies; the files read-only meanwhile; the copy checked before the switch, in one write; the old
    Drive folder to its bin, Mercbot's own copy deleted; a cancelled or failed move leaves the home where it was.
  - [ ] An upload that started just before a move and is still writing after the move's last check (15 s of settling,
    then the copy and three checks) can be missed by the copy; nothing tracks a request's writes in the database
    (D-80, D-15).
  - [ ] A person who disconnects their Google Drive in Connect apps while a home keeps its files there still can:
    the home then says the account was removed, and the person switches storage without the files, which stay in
    that Drive (D-80).
  - [ ] During a move the Files page says the files are read-only, but its new-folder and upload buttons stay
    enabled: what they try is refused with the move's reason (D-80).
  - [ ] Once a home's files are in a Google Drive, Settings → Files offers no link to connect another one: the
    person connects it in Connect apps first (D-80).
  - [ ] A Drive connected through a hub whose renewal the hub refuses should say "Sign in again" too (D-80, D-31).
  - [ ] Deleting a file kept in Google Drive (or Nextcloud) puts it in that storage's bin, as help/files.md says, but
    the Files page's delete dialog says "It's gone for good" (D-80).
  - [ ] An account connected without full Drive access (Google lets a person untick it) can't have Mercbot's folder
    made, and saving says "Try again in a few minutes" instead of asking to connect it again with full access (D-80).
  - [ ] A mount the home no longer uses (another server's, after the home chose other storage) gets no Drive keys,
    but its rclone keeps running until that server stops, as WebDAV mounts do (D-80, D-15).

## 2. Approved, not built

- [ ] **Mercbot on your own computer** (2026-11-11): the plan is `docs/standalone-plan.md`, with what each part
  needs and what fails today, the recommended install (one command on Linux and in WSL2 on Windows, Docker Compose
  for macOS later) and ten questions, all agreed as recommended on 2026-11-12. A person's own copy is single-user,
  opened with its key (D-81, 2026-11-12).
  - [x] Phase 1 (2026-11-12): `scripts/hosting/local.sh`, no start without the host's checks, one data folder,
    loopback http in production, the single-user copy and the `mercbot` command.
  - [ ] Phase 2 (`docs/standalone-plan.md`, Phase 2): numbered releases, `install.sh` with its root step, the help
    around it, and the proof on a fresh Ubuntu 24.04 VM and Windows 11 with WSL2, which needs a disposable VM the
    test hosts don't have yet.
- [x] **The general connector** (D-33, D-34; `docs/apps.md`): built 2026-11-11 with Calendly, Notion and
  Todoist, the first apps in tier-1 order that let Mercbot register itself. 10 apps connect now; 460
  show "Coming soon"; every app still has the "b" badge.
  - [ ] The five-minute test of Calendly, Notion and Todoist with real accounts (steps per app in
    `docs/apps.md`), then their badges.
  - [ ] The next apps in tier order: Trello (self-registration, checked 2026-11-11), then the ones needing an
    app registered for the copy (Dropbox, Zoom, Slack, Canva: `mcp.env`).
  - [x] Two servers renewing one account's key at the same moment: the renewal holds the account's row, so
    the second takes the first's new key instead of being refused (Notion and Todoist take each refresh key once).
  - [ ] An app that only offers the older SSE transport isn't supported; none of the first three needs it.
- [ ] **Every bot template tested once end to end, with an honest badge** (D-43, D-79): 0 of 48 tested.
  - [x] the static checks of every template in `npm test` (`tests/server/templateChecks.test.js`);
  - [x] the end-to-end check, `npm run check:templates [-- <slug> ...]`, proved on a stand-in model in
    `npm run test:database` (`tests/server/templateCheck.integration.js`);
  - [x] the badge, "Tested <date>" or "Not tested yet", in the gallery, on a template's page and in the
    preview before Add bot, from `bot-templates/checks/results.json`;
  - [ ] the real run, waiting for development AI keys: put `AI_PREMIUM_PROVIDER`, `AI_PREMIUM_API_KEY`,
    `AI_ECONOMY_PROVIDER` and `AI_ECONOMY_API_KEY` in `.env` (with `TEST_DB_NAME` set), run
    `npm run check:templates`, read the failures, fix those templates and run them again by slug, then
    commit `bot-templates/checks/results.json`. Without the keys it refuses and writes nothing;
  - [x] an automatic behaviour fingerprint instead of a hand-raised generation (2026-11-12, D-79):
    `BEHAVIOUR_SOURCES` in `packages/bots/src/server/templateResults.js` names the files, and a result counts only
    for the fingerprint it ran on; `npm test` warns how many team templates are Not tested yet for it;
  - [ ] **a stand-in GitHub** (2026-11-12): the four templates whose setup needs GitHub connected
    (bug-triage-helper, failed-build-investigator, pull-request-digest, release-notes-writer) stay skipped
    until the check's home can connect a stand-in GitHub, as the Drive stand-in does for its own
    (`tests/support/fakeDrive.mjs`): one that answers the GitHub calls their setup and
    jobs make (`packages/bots/src/server/githubActions.js`), connected in the check's home before it plays them;
  - [ ] with no connected apps in the check's home, "sends nothing without a yes" can only catch a send
    the test copy simulates (D-69) or a draft marked sent; a template whose job sends through Gmail or
    Slack is only checked properly once the check's home can connect them. A send from the bot's own
    computer isn't simulated in a test copy (D-69), so the check can't hear one;
  - [ ] a file that comes to define how bots behave (a new setup tool, a second provider for chats) goes into
    `BEHAVIOUR_SOURCES`; `npm test` only notices a path the list names that has gone (D-79).
- [x] **The final sweep's interface fixes**:
  - [x] the "N new messages" pill when a reply arrives while scrolled up;
  - [x] right-click menus on messages, and copy/save on pictures;
  - [x] the Library's hover card and age, Open and Share for pages, delete a page with a confirmation;
  - [x] a deleted page's cards in other conversations (a shared bot's other rooms, a group) are marked
    Deleted too, wherever the same file shows, and a pin that lands during the delete keeps the mark (D-74).

## 3. Waiting on something outside Mercbot

- [ ] **Draft card Send for real:** built; not yet tried with a real mailbox.
- [ ] **Picture making:** built with Gemini (the images kind, `AI_IMAGES_API_KEY`, D-72); check it with a Gemini
  project that has billing (the free tier allows no picture requests).
- [ ] **Voice with real audio:** built; check it on a machine with a microphone and speakers.
- [ ] **Bots' own email addresses** (`help/faq.md`): waits for an email service and a domain's DNS.
- [ ] **Outside channels: Slack, Telegram:** not built. WhatsApp is out: Meta's terms rule out general-purpose
  assistants (`docs/apps.md`).
- [ ] **Coding hand-off** (`packages/bots/skills/coding.md`): built 2026-11-11 (Claude Code or Codex CLI on the
  bot's computer, signed in with the person's own account; `packages/computer/src/server/codingRuns.js`,
  `packages/bots/src/server/codingTools.js`); since 2026-11-12 each run and each sign-in is in a gVisor sandbox
  of its own with only the project and the sign-in (D-77, `codingSandbox.js`), proved in real gVisor with the
  real Claude Code on a stand-in AI; waits for a check with a real account (§7).
- [ ] **Work-account admin approval page:** verify with a work account whose organisation requires an
  administrator's approval.
- [ ] **KVM for gVisor and the separate sandbox user** (D-49, D-51, `docs/deployment.md`): both are settings a
  copy can use; neither has been measured on a person's own computer yet.
- [x] **Switch the default AI provider to DeepInfra** (D-48, D-58): settled by D-72, each kind of AI's provider
  is a setting; chats stay on Together, the rest on DeepInfra.
- [ ] **Bot-only threads and a company chart** (D-46 step 3, `LATER.md`): to decide after using steps 1 and 2,
  which are built.
- [ ] **Mid-turn summaries in the agent loop** (`docs/agent-loop.md`): when a long build shows the need.
- [ ] **CONTRIBUTING and a CLA** (`docs/architecture.md` §9.1): they wait for a lawyer's advice. With them:
  whether the README's trademark line and a copyright line are right.

## 4. Ideas, to approve or drop

- [x] **What each home spends** (D-56, D-73): every AI call recorded with what it cost at its provider, a
  computer's days and its commands' time counted as use, each bot's figure in the sidebar and Settings → Spending.
- [x] **Spending reports** (D-76): any day, week, month or range of days, with a chart by day, totals by kind and
  bot, and a CSV (docs/usage-tracking-design.md).
- [ ] **The rest of D-56's design** (`docs/usage-tracking-design.md`, "Still to come"): the Routines screen
  and per-routine costs, drilling down to a reply's calls, the daily reconciliation against the providers'
  figures, and file storage per home.
- [ ] **From `LATER.md`:** a personality for bots; a hierarchy between bots and premade charts; connecting to any
  service (partly: bots use websites in their own browser); live pages people answer, for courses.
- [ ] **Apps:** shared core tables (`docs/apps-design.md`, "Still open"); bringing back a removed field
  (there, "Not in this release").
  - [x] Calculated fields and named formulas (D-78, 2026-11-12).
  - [x] Filtering, sorting and grouping by a calculated field, and the 5,000-record bound on a calculated field's
    sum or average: both kept (2026-11-12, D-78); the Builder says so when it adds one and offers a stored field
    instead, and the help page, the Data tab and its Fields say so too.
  - [ ] A cost bound for the formulas the server runs on screens, watches and queries: `matches` (a regular
    expression, which can backtrack for minutes on one long text) and list comprehensions (`map`, `filter`, `all`,
    `exists`, `exists_one`, which multiply when nested) are still open to them; calculated fields refuse them (D-78).
    A linear-time regular expression engine, or a step budget in the formula evaluator, would close it.
- [ ] **Views:** export, scheduled snapshots, live updates for an app's own screens, views inside pages
  (`docs/views-design.md`, `docs/pages-design.md`).
- [ ] Ready-made executables (D-22).
- [ ] Hosts other than Vibe64 and a person's own Linux computer (D-68, `README.md`).
- [ ] A screenshot-and-click browsing mode with a vision model (D-13,
  `packages/computer/src/server/computerManager.js`).
- [ ] Sharing skills on their own (`help/skills-and-routines.md`).
- [ ] **Reading a card from a photo:** the card form shows Scan with camera and Upload a photo, but they aren't
  built, because a card's number would go into an AI's prompt (`docs/architecture.md` §3.1, `help/vault.md`).
  Ways forward: read it in the browser without an AI, change the rule for cards, or take the two buttons off the
  card form. Contact info is read with Gemini since 2026-11-11.
- [ ] **Photo reads aren't rate-limited:** each Scan with camera or Upload a photo on the Vault's contact form
  is one call on the images kind of AI (`packages/account/src/server/vaultPhoto.js`), counted with what it cost
  (D-73), with no limit on how often.
- [ ] **Spending's images line counts photo reads from the totals** (`src/components/mercbot/spendingView.js`
  kindAmount): every images call that made no picture shows as a photo read, so a picture call that failed or was
  blocked counts as one too. The totals keep no purpose; telling them apart needs one (D-73).
- [ ] **Gemini's list prices** (`packages/account/src/server/providers/gemini.js`): its reading model's,
  Gemini 3.8 Flash's $0.75 in and $3.75 out a million tokens, double on 2027-01-01 ($1.50 and $7.50, Google's
  price list on 2026-11-12); and that list now gives its picture model, Gemini 3.1 Flash Image, as $0.50 in and
  $60 a million picture tokens out, where `prices` still says $0.30 and $30. Check and update both: they're what
  Spending counts a call as costing (`cost_nano`, `cost.js`).
- [ ] A model-based reviewer of bots' actions; rule-based auto-review exists (`docs/architecture.md` §3.7,
  `docs/agent-loop-dsh.md`).
- [ ] **From the first architecture brief** (2026-10-24, "an order of work, not a promise";
  `docs/architecture.md`): MCP servers people add themselves; a replay cache for browser steps; a cost estimate
  before turning on a schedule; Firecracker microVMs; load tests, a US/EU AI provider option, a self-host
  installer and upgrade command, export and import.
- [ ] **Prove the agent loop** on very long builds, breadth, and how often the final-reply check fires
  (`docs/agent-loop.md` §12).
- [ ] **Development on the stand-in model too (D-83)?** Every Test Preview (the browser suites' too) now runs on
  Mercbot's stand-in model and never reaches a provider. A copy given real AI keys with no stand-in (development's
  Preview, with Development Env's keys) still uses the providers, as `npm run check:templates` must. Routing
  development to the stand-in as well would take real AI away from trying bots in Preview; still to decide.

## 5. Known gaps and bugs

- [ ] **A sandbox's memory limit is what gVisor counts** (D-77 Measured, `packages/files/src/server/gvisor.js`
  `sandboxMemory`): with Claude Code waiting, gVisor counted 437 MiB while its memory file held 818 MiB of the host's
  memory, so a sandbox at its 3 GB limit can hold more than 3 GB. Recommended: measure the gap during a real run, and
  if it stays, read the memory file's own size (its allocated blocks) from outside instead.
- [ ] **A server with an awake computer may not finish draining** (`bin/server.js` DRAIN_MS 25 s, D-19): in three
  of four Test Preview runs on a test host with an awake computer (2026-11-12, with timing lines), only the apps'
  `preClose` hook ran before the 25 s ran out: Fastify's close was still waiting, so no feature's shutdown ran, the
  computer was never put away and its desktop and command-line session sandboxes were left running after the server
  exited (a later server's sweep removes their folders). In the fourth it finished in 23 s, and each computer was
  torn down two or three times at once, its profile saved each time. Recommended: find which connections keep the
  close waiting (the browser bridge or the screen relay), close them in `preClose`, and put each computer away once.
- [ ] **The live view on x11vnc 0.9.17** (`computerManager.js` startScreen): this x11vnc, from a test host's Ubuntu,
  closes every client on its Unix socket right after the version exchange when given `-localhost`, so the screen
  never shows (`Couldn't reach the screen.`). `-localhost` only limits TCP, which `-rfbport 0` already turns off.
  Recommended: check the computer's x11vnc version, and drop `-localhost` before any host has 0.9.17.
- [ ] **A fresh toolbox has no mount points, and a sandbox user can't make them** (D-51,
  `scripts/build-toolbox.sh`, `scripts/setup-sandbox-user.sh`): gVisor's gofer makes each missing mount point
  (`/files/mine`, `/runs`, `/io`, `/profile`, `/gateway`, `/opt/coding`, ...) in the toolbox itself the first time a
  sandbox needs it. The server's own user can; with `MERCBOT_SANDBOX_USER` the toolbox is only readable by that
  user, so after a toolbox rebuild every sandbox with a folder would fail to start ("mkdir /proc/fs/root/files:
  permission denied", seen on a test host with a root-owned toolbox, 2026-11-12). A copy on Vibe64 doesn't use a
  sandbox user (D-68). Recommended: `build-toolbox.sh` makes them (with a `REVISION` change), before a sandbox user
  is set up anywhere. Coding sandboxes never put a project's name there (D-77).
- [ ] **A coding run refused while the home's files move, or while its Google Drive needs signing in again, names
  no reason** (D-77 on D-80; found landing the coding sandbox, 2026-11-12): its folder is for writing, so the store
  refuses it then (`store.existingFolder`, `tests/server/files.test.js`), as D-80 has a computer woken meanwhile go
  without files. But `computers.js` `projectFolder` turns every refusal into "There's no folder <folder> in the bot's
  files.", as the coding hand-off did before its sandbox, so the bot's `start_coding` answers "It couldn't start:
  There's no folder …" where D-80 has the bots say the files are being moved, or that the Drive needs signing in
  again. D-80 names saves and commands, not coding runs. Recommended: let `projectFolder` pass a `FilesError`
  through (`files_storage_moving`, the Drive's sign-in), so the bot says why.
- [ ] **A move of the home's files stops its coding runs, without saying so** (D-77 on D-80): the move's start puts
  the home's awake computers to sleep and waits for it (`computers.sleepHome`); sleep stops a computer's coding run
  and sign-in first and waits until the run's report is queued (`computerManager.js` teardown), so nothing writes
  while the files are copied. The run ends "(Stopped: the computer went to sleep.)" and the bot's report then finds
  the files read-only until the move ends. D-80 waits for commands that started before the move (at most 30
  minutes); a coding run (up to 2 hours) is stopped instead, and nothing tells the person a move was why. The pieces
  are proven apart (`computers.integration.js` puts a home's computers to sleep; `codingHandoff.test.js` stops a run
  on sleep); together they need a real desktop. To decide: whether a move waits for coding runs as for commands or
  stops them; either way the run's ending says why.
- [ ] **A coding run's own sandbox is part of its computer's day** (D-73, D-77): its work is not counted as
  commands' computation, as when it ran in the computer's sandbox, though one may run 2 hours with up to 3 GB.
  To decide: whether a coding run's hours count as commands' hours.
- [x] Profile pictures are kept on the server's local disk (D-19, `docs/deployment.md`): on the files volume since
  2026-11-11, moved from a server's disk the first time that server shows each one.
- [x] The licence (`docs/architecture.md` §9.1; D-35): the AGPL-3.0 text in `LICENSE`, `AGPL-3.0-only` in
  `package.json` and every workspace package's, and a Licence section in the README (2026-11-11). CONTRIBUTING and
  the CLA wait for a lawyer (§3).
- [ ] The bots' desktop has no real transparency, window shadows or custom button shapes (D-23).
- [ ] **Bots' abilities not built yet:**
  - [ ] a connected password manager; Bitwarden shows "Coming soon";
  - [x] fetching a sign-in code from an inbox the bot can read: `fill_sign_in_code`
    (`packages/bots/src/server/signInCodes.js`), the person's own Gmail or Outlook, typed unseen, by
    itself only into the pages the sign-in the person asked for led to, otherwise after their yes on a
    card (D-77);
  - [ ] generating a password on sign-up and saving it unseen;
  - [x] the bot finishing the task by itself after the person connects an app from the in-chat card: started by
    the sign-in finishing, on whichever server it lands (`packages/bots/src/server/connectFollowUps.js`, D-77);
  - [ ] "mark as sensitive" for mail.
- [x] Release notes: `help/release-notes.md` said they were on their way, and the bots' "what's new"
  (`packages/bots/skills/whats-new.md`) stopped at 2026-10-27 (no homes, Apps, views, groups or command line); a
  dated list now.
- [x] The Vault's Import from a CSV file, and Scan with camera and Upload a photo for contact info,
  since 2026-11-11 (`help/vault.md`, `genesis/program/account/account-menu.md`). The card form's two
  photo buttons stay disabled: see the card item in §4.
- [x] A routine or watch run in progress when its server stops is lost until its next run (D-59): runs hold a lease
  and are taken over once, from their saved steps (`packages/bots/src/server/runLease.js`).
- [x] **From the 2026-11-11 review of the new-bot fixes** (low severity):
  - [x] a home opened without `?bot=` still follows the newest bot, so another bot's news moves the chat
    until the person picks one (`src/components/mercbot/MercbotShell.vue`);
  - [x] picking the bot already shown adds a history entry, so Back can land on a bare address showing
    another bot (`MercbotShell.vue`);
  - [x] the toolbox build's gVisor pipe: a failing `cat` is reported as "sandboxes not allowed", and a
    sandbox process outliving `runsc run` would hang Prepare (`scripts/build-toolbox.sh`); nothing
    runs the SIGPIPE path in tests;
  - [x] the browser tests' API guard misses requests with no answer and late answers, and only the shell
    and new-bot specs turn it on (`tests/e2e/harness.ts`);
  - [x] other bot routes still pass a model's own HTTP status (401, 429, 5xx) through to the page.
- [ ] **From the 2026-11-12 check of those fixes** (low severity):
  - [ ] a teaching recording that fails leaves the bot's row in the list saying "Putting it together" until
    the page is reloaded: `setWork(botId, "")` clears the status line but not the row's preview
    (`src/components/mercbot/useBotWork.js`, `useLiveView.js`);
  - [ ] every AI SDK error counts as the provider's failure (502 `bots_model_failed`), Mercbot's own
    mistakes in a request too (a prompt or tool schema the SDK refuses), and is logged with its message
    only, no stack (`packages/bots/src/server/modelFailures.js`);
  - [ ] a provider's error message goes into the log word for word, and some providers repeat part of
    the key they refused in it (`modelFailures.js`).
- [ ] **Practice data for draft previews** (D-71, built 2026-11-11), tried in a test copy on 2026-11-12 with the
  Builder's tools called directly, as no AI keys were there; the real Builder's own `app_try` and its Publish
  reminder are still to be watched:
  - [ ] there is no Discard draft action, so a draft's practice copy goes only when it's published or after 7 days
    unused (`packages/apps/src/server/practice.js`, `remove` is ready for one);
  - [ ] a copied record whose link points to a record outside the newest 1,000 shows the link as missing;
  - [ ] a preview's changes have no History or Activity of their own (both show live changes only);
  - [ ] the 2026-11-12 review's low findings (`practice.js`, `anyapi.js`, `dataGate.js`):
    - [ ] a write that passed this server's "already copied" check just before another server reset,
      published or swept the copy lands under the dropped copy's tenant; those records have no
      `any_resource_configs` row, so the sweep never finds them (storage only, a narrow window);
    - [ ] each server's list of tables already copied (`copiedHere`) grows for the life of the process;
    - [ ] what the Builder saves with `app_try` doesn't refresh a preview that is already open (practice
      writes send no `apps-data` notice); it shows on the next load or screen change;
    - [ ] a view placed in a draft's screen still reads the live records;
    - [ ] the first copy of a table inside a write group holds two or three pool connections at once.
    - [x] publishing from a draft's preview raced the preview's own first reads of the draft (fixed
      2026-11-12): the views test (`tests/e2e/views.spec.ts`, "an app shows a shared view and its own copy")
      failed about 1 run in 6 on `409 POST /api/w/<home>/apps/reports/query` right after its Publish: a draft
      read still on its way, making the new practice copy (`practice.js`, `ensure`) when Publish cleared it, so
      `apps_practice_gone`, which the page didn't show but the browser logged. The screen's own queries can meet
      it, and so can those of the view copy on it, which runs a screen runtime of its own (`AppViewBody.vue`);
      Reset can too. The page now stops a screen's reads it no longer needs, with its views' (`appRuntime.js`
      `stop()` and `signal`, an aborted fetch), before Reset and Publish and when it opens another screen, and
      each new screen runtime starts the screen's parts again. `tests/e2e/apps.spec.ts` (the screen's own reads)
      and `tests/e2e/views.spec.ts` (a view copy's) hold the draft's reads on their way through both
      (`harness.ts`, `holdDraftReads`).
  - [ ] an app's older draft cards keep **Preview** and **Publish** after their draft is published or changed
    again, and after a chat reloads a published card offers Publish again: a card learns its draft is gone
    only when pressed, and its Publish publishes the app's draft as it is now (`MercbotAppDraftCard.vue`).
- [ ] **The person's picture** (D-82, the sidebar's account button since 2026-11-12): Settings → General's account row
  and group chats' cluster avatars still show the person's initials when they have a picture
  (`MercbotSettingsGeneral.vue`, `shellInitials.js`). Show it there too?
  - [ ] JSKIT's account page doesn't follow a new picture until a reload (found 2026-11-12, tried in a test copy
    at 1280 then 390 px): after uploading one, going Up to the home and opening Account details again, Profile
    shows the default silhouette and no **Remove avatar**, though each `GET /api/settings` it made answered
    `hasUploadedAvatar: true`; a reload shows the picture. The sidebar's button shows it all along. JSKIT's
    account settings runtime (users-web) owns that page's state.
- [x] **The theme from the search palette didn't save to the account** (found and fixed 2026-11-12): Theme: Light,
  Dark or System applied at once but showed "The theme didn't save to your account.", as its save went to
  `PATCH /api/w/<home>/settings/preferences` (404) since homes (D-36). It now goes to JSKIT's
  `/api/settings/preferences` (`botsApi.js`, `setThemePreference`), which `tests/e2e/shell.spec.ts` checks.
- [ ] **`tests/server/driveMount.test.js` needs about 95 s where it runs, and the unit suite stops a file at 40 s**
  (found 2026-11-12, landing the coding sandbox): on a test host its three real Drive mount tests skip under the
  test runner's `TMPDIR` (a folder under `/var/tmp`: `fusermount3: mount failed: Permission denied`; the same mount
  in `/tmp` works). Run with `TMPDIR=/tmp` and the toolbox's rclone 1.75.2, the mount test passed in 5.6 s, and the
  file was stopped at the 40 s file bound (`unitRun.mjs`) during the next test, twice (load 4 and 8). Alone and
  unbounded, "a key Drive turns down before it runs out is renewed at once, once…" passed in 50.0 s and "a renewal
  that fails for another reason isn't tried again at once" in 38.7 s. A file stopped at its bound leaves its rclone
  mount for a few seconds (gone by the next look). Recommended: find where those tests' time goes (rclone's own
  retry pacing after a refused key, against the 10–25 s waits in the tests) before changing the bound.

## 6. Docs that say something the code doesn't

- [x] `help/security.md` said the bots' browser isn't fenced off from the server's network; the gateway fences it
  (D-49).
- [x] `help/WRITING.md` said voice conversations aren't available; they're built.
- [x] `genesis/program/bots/conversations.md` said opening a template link isn't built; `src/pages/t/[slug].vue`
  exists.
- [x] `docs/deployment.md` said the AI provider defaults to DeepSeek; the code defaults to Together.
- [x] `LATER.md` still listed items that are built (safe scripts, user roles, workspaces, and the structured
  information store, which the home's Apps tables are).
- [x] `docs/colleague-usage/starting-app.md` was the JSKIT starter's generic text, not Mercbot's.
- [x] `src/components/mercbot/MercbotPlaceholderDialog.vue` was never opened (dead code): nothing set
  `useShellDialogs`' `dialog`. It is deleted, with its import, `DIALOG_TITLES`, the `dialog`/`dialogOpen` pair
  and its overlay entry.
- [x] `help/shared-bots.md` said a group chat is always its maker's alone, and `help/messaging.md`'s group section
  never mentioned people, though people from the home can be added to a group (D-46 step 2, **Add a person** in the
  group's Details, `src/components/mercbot/MercbotDetailsPanel.vue`).

## 7. Steps that need a person

- [ ] **Every time, after changing how bots behave and before a release** (D-79): run `npm run check:templates`
  with the development AI keys in `.env`, fix what fails, and commit `bot-templates/checks/results.json`. What
  counts as bot behaviour is the list in `BEHAVIOUR_SOURCES` (`packages/bots/src/server/templateResults.js`);
  `npm test` ends with a warning while team templates are Not tested yet for it.
- [ ] **Check the coding hand-off with a real account**, on a copy that has run `scripts/install-tools.sh` (it
  installs `.tools/coding`):
  1. In a bot's own chat, put a small git project in its files (e.g. upload a folder, or ask it to
     make `/files/mine/demo` with `git init` and one file).
  2. Ask "Use Claude Code to add a README to /files/mine/demo". The bot opens the sign-in on its
     screen and posts **Your turn**: take over, sign in with your own Claude account in the
     terminal window (first start, then `/login` if it doesn't ask), and select **I'm done**.
     Check that `/profile/.coding/.claude/.credentials.json` exists in the computer (a later
     `connect_coding_account` says "signed in") and that nothing new is in the bot's files.
  3. Ask again: the bot starts it, a window shows Claude Code at work, the chat shows
     "Claude Code started working" with the brief, and a report follows when it ends, with the
     change left in the folder (not pushed). Ask it once to list `/profile` and `/files`: only
     `.coding` and the project are there (D-77).
  4. Repeat with Codex: its window shows a device code to enter on your phone.
  5. Let the computer sleep and wake it: the tool is still signed in. **Reset** in Settings signs it
     out. If a flag no longer fits the pinned tool versions (`codingRuns.js` CODING_TOOLS), fix it there.
- [x] **The three items D-77 left open were all built on 2026-11-12** (`docs/decisions.md`, D-77): a coding
  run's own sandbox with only the project and its sign-in, never the browser profile
  (`packages/computer/src/server/codingSandbox.js`); connect follow-ups started by the sign-in finishing instead of
  every server checking every card every 5 seconds (`packages/bots/src/server/connectFollowUps.js`); and codes on
  sites where others publish, which go in by themselves only where the person's sign-in led
  (`packages/computer/src/server/signInChain.js`).
- [ ] **Drop `ix_bot_messages_connecting`** in a new migration: nothing reads it since connect follow-ups (D-77).
- [ ] **Check with real AI** what could only be proven without it (D-77): a sign-in code typed into a real site's
  page from a connected Gmail, and a bot that finishes its task with a real reply after the person connects an app
  from its card. Also that the model starts a sign-in the person asks for with `start_sign_in` (not
  `open_web_page`), so its code goes in without a card, and stops at the card on a page outside it; the chain
  itself is proven in a real Chromium with stand-in sites and a stand-in inbox (`tests/e2e/sign-in-chain.spec.ts`),
  not on a real site.
