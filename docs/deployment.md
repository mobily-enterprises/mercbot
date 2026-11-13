# Deploying Mercbot

Mercbot is a standard Node application on PostgreSQL, run as a person's own copy on their own computer (D-81): one
person, opened with its key, reached only from that computer. `scripts/mercbot` installs releases, starts and stops it,
backs it up and upgrades it (help/own-copy.md is the person's guide). A copy built on Mercbot that serves many people
starts Mercbot's server without the single-user gate (`gate: false`) and describes its own deployment.

## Before each release

- After changing how bots behave, run `npm run check:templates` before a release, with the
  development AI keys in `.env` (D-79), and commit `bot-templates/checks/results.json`. A
  template's badge counts only for the fingerprint of the files `BEHAVIOUR_SOURCES` names
  (`packages/bots/src/server/templateResults.js`): Mercbot's own rules for bots, the agent loop,
  the setup tools, approvals, drafts and sending, and the chat kind's provider and model. A release
  can't run it, since it needs real AI: `npm test` ends with a warning while templates are Not
  tested yet.

## The computer

- Ubuntu 24.04 or Debian 12 on x86_64 (`scripts/hosting/local.sh`), Node 26, plus the system programs for bots'
  computers: `Xvfb`, `openbox`, `x11vnc` and `tar` with zstd. `tint2` and `hsetroot` draw the desktop's bars
  and wallpaper (D-23); `npm run tools:install` unpacks them when the system lacks them, the host's way (the
  hosting script, D-68). Bots' Chrome is the toolbox's own, in gVisor (D-47).
- `npm run deploy:prepare` (`npm ci --include=dev`, then `npm run tools:install` with its store in
  the home's cache), then `npm run build`. The install reapplies the patches in `patches/`. `mercbot upgrade` does
  both for a new release, beside the one that runs.
- `npm run tools:install` (part of `deploy:prepare`): the office apps bots make files with (D-20), JuiceFS,
  Piper for voice memos, all pinned and checksummed, into `.tools/`. No root needed.
- `npm run tools:install` also installs gVisor (`runsc`, pinned) and builds the toolbox (D-47,
  `scripts/build-toolbox.sh`): Ubuntu 24.04 with the tools and Chrome for Testing, about 2.3 GB in
  `.tools/toolbox`, around 10 minutes the first time and skipped afterwards until its package list
  changes. It needs `apt-get` and Ubuntu's package archive reachable while preparing, and
  user namespaces and `/dev/fuse` (README → Hosting requirements). The host's script
  (`HOSTING_SCRIPT`, D-68) checks them and obtains the toolbox's packages; it stops,
  saying so, on a host without them. No root. **Everything bots run is in gVisor (D-49):** their commands, their computers' Chrome and
  Craft apps, the office apps behind their document tools and previews, and voice memos. Without
  gVisor and the toolbox, none of these are available and bots' computers don't start; nothing
  runs outside it. Commands run rootless with no network; `MERCBOT_SHELL_RUNS` (default 2) caps how
  many run at once. KVM can make gVisor faster, but only measure first (below).
- **Coding runs (D-77)** each start a gVisor sandbox of their own beside their computer's, only while
  a run or a coding tool's sign-in goes on: the same `runsc`, toolbox and `.tools/coding`, so nothing
  more to install. Measured (D-77): a start takes 0.2–0.3 s; idle one holds about 70 MB; with Claude Code
  working, about 0.85 GB of its own (Codex 0.25 GB), plus the tools' program files (0.6–1 GB) once in the host's
  file cache. A copy runs at most one per awake computer (`MERCBOT_MAX_COMPUTERS`), so size its memory for
  about 1 GB more per computer.
- **Tools kept between releases (D-70):** each tool is installed once per pinned version into a
  store and hard-linked into the release's `.tools/` (`scripts/tools-store.sh`), so a release adds
  no disk of its own. `deploy:prepare` and `mercbot upgrade` keep the store in `$HOME/.cache/mercbot-tools`
  (`MERCBOT_TOOLS_STORE` chooses another folder; a checkout's `npm run tools:install` uses
  `.tools/store`), which outlives the releases, so only the first install puts everything there (15–25 minutes); a
  later release reinstalls only a tool whose version changed, and otherwise just links them, in about 2 seconds (a
  test machine, 2026-11-11), without downloading or checking anything again. An install cut short is redone: a tool
  counts as installed only once the marker written after it is there, and the toolbox only once its stamp is. The
  store keeps the versions in use; a running release keeps its own links to older ones. A store on another file
  system than the release is copied from instead of linked.
- `mercbot start` runs `bash scripts/serve.sh` as the person's systemd service. It
  runs Mercbot in a user and mount namespace of its own (`scripts/namespace.sh`, D-68), or stops saying the host
  doesn't allow one. When `MERCBOT_FILES_DIR` is set it first mounts the files volume there
  (`npm run files:mount`, through `/dev/fuse` as the namespace's root), creating it the first
  time, and unmounts it after Mercbot stops. The mount, and people's storage (rclone), exist only
  inside that namespace. On SIGTERM Mercbot drains for up to 25 seconds, then exits.
- Migrations: `mercbot upgrade` runs `npm run db:migrate` for the new release after a backup, and puts the database
  back from that backup if a migration fails.

### Root steps (once per computer)

Everything bots run is in gVisor (D-49). These steps need root, so the person agrees to them or does them by hand:
1. **Namespaces on Ubuntu.** Ubuntu lets only programs AppArmor trusts make user namespaces. The installer's root step
   puts root's own `unshare` and `runsc` in `MERCBOT_TRUSTED_DIR` (`/usr/local/lib/mercbot` by default) under an
   AppArmor profile that lets just those two make them; Mercbot never switches the restriction off for the whole
   computer. Debian 12 allows namespaces already, so it needs none.
2. **A separate, powerless sandbox user** (optional). Run
   `sudo bash scripts/setup-sandbox-user.sh <Mercbot's user> <MERCBOT_FILES_DIR> <MERCBOT_DATA_DIR> /var/lib/mercbot-sandbox/tmp`
   from Mercbot's folder, then set `MERCBOT_SANDBOX_USER=mercbot-sandbox` and
   `TMPDIR=/var/lib/mercbot-sandbox/tmp` and restart Mercbot.
   - **What it does:** every sandbox runs as `mercbot-sandbox`, through one sudo rule that allows
     only Mercbot's `runsc`. A program that got out of gVisor can't read Mercbot's settings
     file or process environment (database password, keys).
   - **Shared files:** the two users share the group `mercbot-shared` for the folders both write.
   - **Run it again** after the files volume or `.tools` moves.
3. **KVM for gVisor, only if it's faster.** The setup script adds `mercbot-sandbox` to the `kvm`
   group (without a sandbox user, add Mercbot's user: `usermod -aG kvm <Mercbot's user>`). KVM is
   off until `MERCBOT_GVISOR_PLATFORM=kvm` is set. Set it only if measuring shows it faster.
   - **Why opt-in:** on bare metal KVM should help. Inside a virtual machine it's nested, and on the development VM
     (2026-10-31) it was slower: Chrome start 4.1 s against 2.5 s, scrolling 3.9 s against 0.8 s, and commands
     25–70% slower.
   - **Measure, both ways:** run `node scripts/measure-browser-speed.mjs` (needs `Xvfb`) once
     plain and once with `MERCBOT_GVISOR_PLATFORM=kvm`, as the sandbox user's setup will run it. It
     prints Chrome's start, page loads, typing and scrolling in gVisor. Keep whichever is faster.

## Settings

The person's settings are in `~/.local/share/mercbot/mercbot.env` (mode 600), which the service reads. Mercbot starts
with its database and `AUTH_LOCAL_SESSION_SECRET` alone. Every other key below turns its feature on when it's set;
without it, the feature is off and says so where it's used, and the server logs one line at start for each missing
key, naming it and what's off (`packages/account/src/server/keys.js`). A value that is set but wrong (a provider a kind
doesn't accept, a public address that isn't https) still stops the start, saying which to fix.

- `HOST` `127.0.0.1` or `::1` (D-81): Mercbot has one person, opened with the key in
  `<MERCBOT_DATA_DIR>/mercbot.key` (`mercbot open`), no sign-in, registration, invitations or members' changes, and
  refuses to start on any other `HOST`. The one person runs the copy, so they may choose a folder on its computer for a
  home's website (D-84). `PORT` is 3001 unless set.
- `APP_PUBLIC_URL`: the copy's own address (e.g. `http://localhost:3001`), the one place it is set:
  connected accounts build their links from it, never from a request's Host header. With `NODE_ENV=production` the
  server refuses to start with one that isn't an `https://` address (D-65), or `http://localhost`, `http://127.0.0.1`
  or `http://[::1]` while `HOST` is `127.0.0.1` or `::1`. Without one it starts, and links point at `http://localhost`.
- The database: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`.
- Mercbot's three kinds of AI (D-72), each with its provider (the type, which picks the provider's layer
  in `packages/account/src/server/providers/`) and its key there. Each kind accepts one provider for now.
  Any kind may be left out, and is off. Without the premium or the economy kind, bots start no work: each
  says this copy's AI isn't set up and which settings to add, and a new bot's welcome uses its standard
  words. Without images, bots asked for a picture say pictures aren't set up on this copy, and the
  Vault's photo buttons say reading photos isn't (503 `account_vault_photo_unavailable`). Mercbot doesn't
  start while a provider setting names a provider its kind doesn't accept, and says which to fix. What
  each kind of work runs on is one table, `WORK` in `packages/account/src/server/providers/index.js`.
  - Premium AI, for people's chats and group chats, requests between bots, tasks app buttons hand to a
    bot, and the bots' browser steps: `AI_PREMIUM_PROVIDER=together` and `AI_PREMIUM_API_KEY`, a
    Together AI key.
  - Slower, cheaper AI, for the Builder's replies (DeepInfra Standard), and routines, watch runs,
    finished background commands, goal rounds and conversation summaries (DeepInfra Flex):
    `AI_ECONOMY_PROVIDER=deepinfra` and `AI_ECONOMY_API_KEY`, a DeepInfra key.
  - Images, optional, for making and editing pictures and reading contact details from photos in the
    Vault: `AI_IMAGES_PROVIDER=gemini` and
    `AI_IMAGES_API_KEY`, a Google Gemini API key on a project with billing.
- `MERCBOT_VAULT_KEY`: 32 random bytes, base64. It seals vault secrets, bots' saved browsers and where a home publishes
  its pages (D-84) with that website's keys. Keep it safe; anything sealed with a lost key can't be recovered.
  `mercbot backup` keeps it with the settings.
- `AUTH_LOCAL_SESSION_SECRET` as JSKIT requires.
- `HOSTING_SCRIPT=scripts/hosting/local.sh` (D-68), and `MERCBOT_TRUSTED_DIR`: where the root step put root's own
  `unshare` and `runsc` (above); `/usr/local/lib/mercbot` by default.
- Bots' files (D-20, D-21): without `MERCBOT_FILES_DIR`, or without `MERCBOT_FILES_PASSPHRASE` (`scripts/serve.sh`
  then says the volume isn't mounted), files stay in `<MERCBOT_DATA_DIR>/files` (`.data/files` without
  `MERCBOT_DATA_DIR`). With both, they're on an encrypted JuiceFS volume mounted at `MERCBOT_FILES_DIR`:
  `MERCBOT_FILES_PASSPHRASE` unlocks the volume's encryption key (keep it safe), and `MERCBOT_FILES_STORAGE` and
  `MERCBOT_FILES_BUCKET` (e.g. `s3` and the bucket's address) say where the data goes, with `ACCESS_KEY` and
  `SECRET_KEY` when the storage needs them. The volume's metadata lives in the app's database, in its own `juicefs`
  schema. While the volume isn't mounted, Mercbot says files are unavailable rather than writing them to its own disk.
- `AUTH_LOCAL_EMAIL_CONFIRMATION`: whether new accounts confirm their email address, which needs a sender for the
  links that Mercbot doesn't have. In production it is `false` unless set, as nobody registers on a person's own copy;
  a copy built on Mercbot that confirms new accounts' addresses sets it and adds its own sender.
- Usage (D-73) needs no setting: every AI call is recorded with what it cost at its provider, and a
  computer's days and its commands' time as use, with no cost; nothing is ever refused or paused. Daily
  totals older than 13 months are archived to
  `<MERCBOT_FILES_DIR>/usage-archive/daily/<YYYY-MM>/homes-<from>-<to>.csv.gz`, one file per 100,000 homes,
  so the files volume holds seven years of them; each AI call's own row is kept 14 days in the database and
  not archived.
- `SIDE_EFFECTS=live` only in a copy for real use (D-69). Anywhere else, unset
  included, the copy is a test copy: what bots would send from connected accounts and scripts' web
  calls other than GET are only logged,
  and every page shows a small "Test copy" tab at the top.
- Connected accounts (D-31): Every provider sends people back to
  `<APP_PUBLIC_URL>/api/connections/callback`, which must be registered with
  each provider's app. The person's own apps: `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`,
  `MICROSOFT_CLIENT_ID`/`MICROSOFT_CLIENT_SECRET`, `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`
  (`<PROVIDER>_TEST_CLIENT_ID`/`_SECRET` are used instead while the public address is
  `localhost`). A copy without its own apps can link to another Mercbot that connects accounts for it instead:
  `MERCBOT_HUB_URL`, that copy's address (no default: without it, linking is off).

## Optional

- `MERCBOT_MAX_COMPUTERS`: bots' computers awake at once (default 3).
- `MERCBOT_TOOLS_DIR` (default `.tools`) when the tools live elsewhere.
- `MERCBOT_TOOLS_STORE`: where `npm run tools:install` keeps each tool's installed versions (D-70;
  default `.tools/store`, and `$HOME/.cache/mercbot-tools` through `npm run deploy:prepare`).
- `HOSTING_SCRIPT`'s default is `scripts/hosting/vibe64.sh`, for development in Vibe64. The hosting
  script, relative to Mercbot's folder, checks the host, finds `Xvfb` and `x11vnc` (it sets
  `MERCBOT_XVFB` and `MERCBOT_X11VNC` for the server) and obtains the toolbox's packages (D-68). A
  path to no file stops the install and the start, naming the variable, the path and the hosting
  scripts there are.
- `MERCBOT_GVISOR_PLATFORM`: `kvm` to run gVisor on KVM where it measured faster (above); unset,
  gVisor's own default.
- `MERCBOT_SANDBOX_USER`: the powerless user bots' sandboxes run as (above); unset, they run as
  Mercbot's own user.
- `MERCBOT_FILES_CACHE`: the files volume's JuiceFS cache, on fast local disk.
- People who keep files in their own storage (D-26) have it mounted with rclone, with its cache under
  `MERCBOT_DATA_DIR` (`mount-cache`); that needs FUSE and `MERCBOT_VAULT_KEY`.
- Profile pictures are with bots' files (`profile-pictures/`). One saved before 2026-11-11 in JSKIT's own folder
  (`data/storage`, or `JSKIT_STORAGE_FS_BASE_PATH`) moves there the first time it's shown.
