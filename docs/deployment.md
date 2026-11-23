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
- `npm run tools:install` (part of `deploy:prepare`): the office apps bots make files with (D-20), rclone for people's
  own storage, Piper for voice memos, all pinned and checksummed, into `.tools/`. No root needed.
- `npm run tools:install` also installs gVisor (`runsc`, pinned) and builds the toolbox (D-47,
  `scripts/build-toolbox.sh`): Ubuntu 24.04 with the tools and Chrome for Testing, about 2.3 GB in
  `.tools/toolbox`, around 10 minutes the first time and skipped afterwards until its package list
  changes. It needs `apt-get` and Ubuntu's package archive reachable while preparing, and
  user namespaces (README → Hosting requirements; nothing needs FUSE, D-91). The host's script
  (`HOSTING_SCRIPT`, D-68) checks them and obtains the toolbox's packages; it stops,
  saying so, on a host without them. No root. **Everything bots run is in gVisor (D-49):** their commands, their computers' Chrome and
  Craft apps, the office apps behind their document tools and previews, and voice memos. Without
  gVisor and the toolbox, none of these are available and bots' computers don't start; nothing
  runs outside it. Commands run rootless with no network of their own: they reach public internet addresses only
  through Mercbot's gateway (D-126), so the servers need outbound internet for them as for the bots' browsers;
  `MERCBOT_SHELL_RUNS` (default 2) caps how
  many run at once. Their internet has limits (D-127), each Env name's default applying when it's unset:
  `MERCBOT_INTERNET_COMMAND_IN_MB` (2048) and `MERCBOT_INTERNET_COMMAND_OUT_MB` (200) a command,
  `MERCBOT_INTERNET_CONNECTIONS_PER_MINUTE` (120) new connections a minute a bot, and `MERCBOT_INTERNET_HOME_DAY_MB`
  (20480) a day a home, kept in the database for every server. KVM can make gVisor faster, but only measure first (below).
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
  doesn't allow one. It mounts nothing: bots' files are in the files bucket or folder (below), which
  Mercbot reaches itself. On SIGTERM Mercbot drains for up to 25 seconds, sends what it wrote to the
  files bucket, then exits.
- Migrations: `mercbot upgrade` runs `npm run db:migrate` for the new release after a backup, and puts the database
  back from that backup if a migration fails.

### A host whose programs come from a read-only Nix store

Some hosts start applications from a read-only Nix store: Mercbot and the packages the host was asked for are in the
store, their commands are on `PATH`, and nothing is installed or built there (D-86). On such a host the bots' toolbox is
made from the store at every start, and its desktops' programs are the store's. Mercbot's release brings its downloads
(D-92): `npm run tools:install` with `HOSTING_SCRIPT=scripts/hosting/store.sh`, run where the release is built (such as
`HOSTING_SCRIPT=scripts/hosting/store.sh npm run deploy:prepare`), installs rclone, Piper, the Craft apps, the coding
tools and gVisor into `.tools/` as everywhere, and never builds the toolbox (`.tools/toolbox`) or obtains the desktops'
programs (`.tools/desktop`); it doesn't check the host either, which is checked when Mercbot starts there. That keeps a
release about 2.2 GB smaller than one built for an Ubuntu host, and its build about 7 minutes shorter.

- `HOSTING_SCRIPT=scripts/hosting/store.sh`, `MERCBOT_TOOLBOX_STORE`: the store (such as `/nix`), and
  `MERCBOT_TOOLBOX_DIR`: a writable folder the toolbox is made in, where programs may run. It holds only links and
  settings files and nothing is started from it, but gVisor mounts it again, read-only, as each sandbox's system, and in
  Mercbot's own user namespace a host's `noexec` refuses that mount; the start stops, saying so, on such a folder.
  `scripts/serve.sh` runs `node scripts/store-toolbox.mjs`, which makes it in seconds (1.3–3.4 s on a test machine whose store held 12,800 packages), before the server; every
  gVisor sandbox then sees the store read-only at its own path.
- What has to be on `PATH`, from the store: `runsc` (gVisor; the hosting script names it as `MERCBOT_RUNSC` unless set),
  `Xvfb`, `x11vnc` and `openbox`, a browser (`chromium`), `python3` and `bash`; and for a nicer desktop `tint2`,
  `hsetroot` and `xterm`. Fonts come from the store itself (every package's `share/fonts`). In nixpkgs: `gvisor`,
  `xvfb`, `x11vnc`, `openbox`, `chromium`, `python3`, `bash`, `coreutils`, `tint2`, `hsetroot`, `xterm`,
  `liberation_ttf`, `dejavu_fonts` and `noto-fonts-color-emoji`. Without a browser, `python3` or `bash` the start stops,
  saying so.
- Bots get their command line only when the store also has every tool they're told of (`files/shell.md` in the
  Program lists them, with Python's pandas, numpy, matplotlib, openpyxl, python-docx and python-pptx, and `git`,
  `curl` and `pip`); otherwise the start says which are missing and bots work without it.
- Bots' commands check https sites against root certificates: `MERCBOT_TOOLBOX_CERTIFICATES` names a bundle in the
  store, nixpkgs' `cacert`'s `etc/ssl/certs/ca-bundle.crt`, which the toolbox puts where the store's programs read it
  (D-126). Without it the start says commands can't check https sites.
- The computers' own launchers are written while Mercbot runs and started as programs: the browser's (`chrome.sh` in
  the temporary folder, `TMPDIR`) and the dock's (`launch-*.sh` under `MERCBOT_DATA_DIR`). Both folders must be
  writable and allow programs; on a host where only one work folder does, put them and `MERCBOT_TOOLBOX_DIR` there.
  Every folder a sandbox sees keeps `nosuid` and `nodev`, and the display's sockets `noexec`, so a sandbox never asks
  to drop a restriction the host set on them.
- The office apps, voice memos, coding runs and rclone come from `npm run tools:install`'s pinned downloads
  (or the same downloads put in `MERCBOT_TOOLS_DIR` by whatever builds the host's release), not from the store:
  without them their features are off, as on any server without them.
- The office apps, Piper and Claude Code are made for an ordinary Linux system and ask for its loader and libraries
  (D-89). With `nix-ld` and glibc on `PATH` (nixpkgs' `nix-ld` and `glibc`), the toolbox makes nix-ld their loader with
  glibc's `ld.so`, and gives them the libraries of the folders `MERCBOT_TOOLBOX_LIBRARIES` names (folders in the store,
  separated by `:`; the first file of each name wins): gcc's runtime libraries, `libstdc++.so.6` and `libgcc_s.so.1`,
  for all of them (Codex is a static program and needs nothing), and on a server that holds computers what the office
  apps' windows load, the `lib` folders of nixpkgs' `libx11`, `libxcursor`, `libxi`, `libxkbcommon` (X11, its cursors,
  input and keyboard), `alsa-lib` (sound) and `vulkan-loader`, or `libglvnd` to draw through EGL instead. There
  `MERCBOT_TOOLBOX_MESA` names nixpkgs' `mesa`, whose software drivers they draw with: its lavapipe Vulkan manifest and
  EGL vendor file go where the desktop looks for them. Without nix-ld or `ld.so` the start says those features can't
  start; a library folder that isn't in the store, or a Mesa without both files, stops the start, naming it.

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
   - **Run it again** after the files folder or `.tools` moves.
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
  connected accounts build their links from it, never from a request's Host header. In staging and production
  (`APP_ENV`) the server refuses to start with one that isn't an `https://` address (D-65), or `http://localhost`, `http://127.0.0.1`
  or `http://[::1]` while `HOST` is `127.0.0.1` or `::1`. Without one it starts, and links point at `http://localhost`.
- `TRUSTED_PROXIES`: the addresses (or ranges) of a proxy or load balancer in front of the server, whose
  `X-Forwarded-For` it believes, so each visitor keeps their own address for the sign-in limits. Unset, only a proxy on
  this computer is believed. A value that would believe anyone's header (`true`, a hop count) stops the start.
- The database: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`.
- Mercbot's three kinds of AI (D-72), each with its provider (the type, which picks the provider's layer
  in `packages/account/src/server/providers/`) and its key there. Each kind accepts one provider for now.
  Any kind may be left out, and is off. Without the premium or the economy kind, bots start no work: each
  says this copy's AI isn't set up and which settings to add, and a new bot's welcome uses its standard
  words. Without images, bots asked for a picture say pictures aren't set up on this copy, and the
  Vault's photo buttons say reading photos isn't (503 `account_vault_photo_unavailable`). Mercbot doesn't
  start while a provider setting names a provider its kind doesn't accept, and says which to fix. What
  each kind of work runs on is one table, `WORK` in `packages/account/src/server/providers/index.js`.
  - Premium AI, for chats, requests between bots, tasks app buttons hand to a
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
- `MERCBOT_WEBSITE_FOLDERS=off` on a copy run on more than one server: homes' websites (D-84) are then only in
  S3-compatible storage, since a page written to a folder would be on one server alone. Unset, whoever runs the copy may
  choose a folder on its computer.
- `HOSTING_SCRIPT=scripts/hosting/local.sh` (D-68), and `MERCBOT_TRUSTED_DIR`: where the root step put root's own
  `unshare` and `runsc` (above); `/usr/local/lib/mercbot` by default.
- Bots' files (D-20, D-21, D-91): on a copy run on more than one server, an S3 bucket they all share, AWS's or any
  store speaking the S3 API (Garage, MinIO, R2 and the like): `MERCBOT_FILES_S3_BUCKET`, `MERCBOT_FILES_S3_REGION`,
  `MERCBOT_FILES_S3_ACCESS_KEY_ID`, `MERCBOT_FILES_S3_SECRET_ACCESS_KEY` and `MERCBOT_FILES_PASSPHRASE`, with
  `MERCBOT_FILES_S3_ENDPOINT` for a store other than AWS (reached path-style, `<endpoint>/<bucket>/<key>`) and
  `MERCBOT_FILES_S3_PREFIX` to keep Mercbot's keys in one folder of a bucket shared with other things. Every file is
  sealed before it leaves the server; the passphrase opens the key that seals them, which is kept in the bucket
  (`.mercbot-files`): keep the passphrase safe, as the files can't be read without it. Each server works on a copy of
  what it uses in its files folder (`MERCBOT_FILES_DIR`, else `<MERCBOT_DATA_DIR>/files`), emptied at every start, so
  give it fast local disk with room for the files in use. Without every one of the five settings (the start names each
  missing one), files stay in that folder: one machine's, or, with `MERCBOT_FILES_DIR`, a folder the host shares
  between servers, which must hold an empty `.mercbot-files` file to show it's there. While the bucket can't be used
  (a passphrase that doesn't open its key, a store that doesn't answer) or that shared folder isn't there, Mercbot says
  files are unavailable rather than writing them to its own disk.
- `AUTH_LOCAL_EMAIL_CONFIRMATION`: whether new accounts confirm their email address, which needs a sender for the
  links that Mercbot doesn't have. In staging and production it is `false` unless set, as nobody registers on a person's own copy;
  a copy built on Mercbot that confirms new accounts' addresses sets it and adds its own sender.
- Usage (D-73) needs no setting: every AI call is recorded with what it cost at its provider, and a
  computer's days and its commands' time as use, with no cost; nothing is ever refused or paused. Daily
  totals older than 13 months are archived to
  `usage-archive/daily/<YYYY-MM>/homes-<from>-<to>.csv.gz` with bots' files, one file per 100,000 homes,
  so the files bucket or folder holds seven years of them; each AI call's own row is kept 14 days in the database and
  not archived.
- `APP_ENV=production` with `NODE_ENV=production` in a copy for real use (D-87); `SIDE_EFFECTS` is gone, and JSKIT
  refuses to start while it is set. Mercbot doesn't start without `APP_ENV`, naming the fix. In `development`, `test`
  or `staging` (which needs `NODE_ENV=production` too) the copy is a test copy (D-69): what bots would send from
  connected accounts and scripts' web calls other than GET are only logged, and every page shows a small tab naming
  the environment ("Development", "Test" or "Staging").
- Connected accounts (D-31): Every provider sends people back to
  `<APP_PUBLIC_URL>/api/connections/callback`, which must be registered with
  each provider's app. The person's own apps: `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`,
  `MICROSOFT_CLIENT_ID`/`MICROSOFT_CLIENT_SECRET`, `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`
  (`<PROVIDER>_TEST_CLIENT_ID`/`_SECRET` are used instead while the public address is
  `localhost`). A copy without its own apps can link to another Mercbot that connects accounts for it instead:
  `MERCBOT_HUB_URL`, that copy's address (no default: without it, linking is off).
- GitHub for bots' commands (D-128): GitHub is signed in to through the copy's GitHub App, which lets a bot's command
  push to a repository its person allowed. `GITHUB_APP_ID` (the App's numeric id), `GITHUB_APP_SLUG` (its name in
  `github.com/apps/<slug>`) and `GITHUB_APP_PRIVATE_KEY` (a private key generated on the App's page, in PEM: with its
  line breaks, or with `\n` for each), and `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` are then the App's own client id
  and a client secret generated there (`GITHUB_TEST_APP_ID`, `GITHUB_TEST_APP_SLUG`, `GITHUB_TEST_APP_PRIVATE_KEY` and
  `GITHUB_TEST_CLIENT_ID`/`_SECRET` instead, when set, while the public address is `localhost`). The App is registered with the callback
  above, **Expire user authorization tokens** on, **Request user authorization (OAuth) during installation** off, its
  Setup URL `<APP_PUBLIC_URL>/api/connections/github/installed` with **Redirect on update** on, no webhook, and
  repository permissions Contents, Pull requests and Issues read and write, Actions, Checks, Commit statuses and
  Metadata read; no Workflows, and no organisation or account permissions. The private key stays on the server: a
  command gets a key of the App's for one repository, made for it and withdrawn when it ends. Without the three
  `GITHUB_APP_*` settings, GitHub signs in as before (a classic OAuth app's client in `GITHUB_CLIENT_ID`), for the
  reading tools only, and commands can't push. Switching `GITHUB_CLIENT_ID`/`_SECRET` to the App's leaves accounts
  signed in before reading with their old keys, which don't expire, until the old OAuth app is deleted or its keys
  withdrawn; each shows **Sign in again**, and signing in again goes through the App. A copy for checking (`APP_ENV=staging`)
  uses a test App of its own, registered with its own callback and Setup URL, under the same names in its settings.

## Optional

- `MERCBOT_MAX_COMPUTERS`: bots' computers awake at once (default 3).
- `MERCBOT_TOOLS_DIR` (default `.tools`) when the tools live elsewhere.
- `MERCBOT_TOOLBOX_STORE` and `MERCBOT_TOOLBOX_DIR`: on a host whose programs come from a read-only Nix store, the store
  and the folder the toolbox is made in (above). `MERCBOT_TOOLBOX_DIR` alone names a toolbox kept elsewhere than
  `<MERCBOT_TOOLS_DIR>/toolbox/rootfs`.
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
- People who keep files in their own storage (D-26) reach it through rclone's remote control, with each home's
  working copy under `MERCBOT_DATA_DIR` (`mounts/<home>`); that needs `MERCBOT_VAULT_KEY`, and no FUSE.
- Profile pictures are with bots' files (`profile-pictures/`). One saved before 2026-11-11 in JSKIT's own folder
  (`data/storage`, or `JSKIT_STORAGE_FS_BASE_PATH`) moves there the first time it's shown.
