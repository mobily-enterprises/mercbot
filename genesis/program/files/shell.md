# Bots' command line

Every bot in a chat can run bash scripts on its own Linux command line there, in gVisor, on that chat's folders, with
no network of its own: it reaches public internet addresses only through Mercbot's gateway, as the computer's browser
does, within limits per command, per bot and per home (D-47, D-112, D-126, D-127).

## Sources

- Main: `packages/files/src/server/shell.js`
- `packages/files/src/server/gateway.js`
- `packages/files/src/server/internetUsage.js`
- `packages/files/src/server/secretMask.js`
- `packages/files/src/server/gvisor.js`
- `packages/files/src/server/storeToolbox.js`
- `scripts/build-toolbox.sh`
- `scripts/hosting/store.sh`
- `scripts/hosting/vibe64.sh`
- `scripts/store-toolbox.mjs`
- `scripts/install-tools.sh`
- `scripts/toolbox-run.sh`
- `scripts/tools-store.sh`
- `migrations/20261113120000_baseline.cjs`
- `migrations/20261123171500_internet_limits.cjs`
- `packages/bots/src/server/botTools.js`
- `packages/bots/src/server/commandTools.js`
- `packages/bots/src/server/githubCommands.js`
- `packages/bots/src/server/botLoops.js`
- `packages/bots/skills/command-line.md`

## Public contract

- **Toolbox:** `npm run tools:install` installs gVisor (`.tools/bin/runsc` with `gvisor-bin/`,
  pinned and checked) and `scripts/build-toolbox.sh` builds `.tools/toolbox/rootfs`. That's Ubuntu
  24.04 plus the listed packages, obtained by the host's script into a private folder and installed
  offline inside gVisor, plus pinned PyPI wheels and Node.js (the LTS Mercbot runs on, with npm,
  from nodejs.org, pinned by sum, in `/usr/local`). A stamp (`etc/mercbot-toolbox`) skips rebuilding
  until the package list or `REVISION` changes; the list is sorted bytewise for it (`LC_ALL=C`), so
  the stamp is the same in every locale (`tests/server/toolsStore.test.js`). No root. The install runs in gVisor through
  `scripts/toolbox-run.sh`, which keeps the sandbox off the build's own output (gVisor shuts down an
  inherited socket, as Publish's output is, when its sandbox ends) and says which failed: the host
  refusing the sandbox, the install inside it, or the build's own output closing (status 141).
- **Mount points:** every toolbox has the folders sandboxes are given folders at (`TOOLBOX_MOUNT_POINTS`,
  `gvisor.js`: `/files/chat`, `/files/bot`, `/files/shared`, `/files/db`, `/runs`, `/gateway` and the rest) from when
  it's made: `makeStoreToolbox` makes them, and `build-toolbox.sh` runs `scripts/toolbox-mount-points.mjs`
  (`makeMountPoints`, `storeToolbox.js`) on a toolbox it builds and on one it already has. gVisor makes a missing mount
  point in the toolbox itself, which only the user running runsc can do where it may write; a toolbox made by root for
  a host's servers to share starts no sandbox given a folder at a point it lacks (`cannot create sandbox`), so no
  mount point is left to gVisor or made by hand (`tests/server/storeToolbox.test.js`). And just before each sandbox
  starts (`runSandboxed`, `gvisorProcess`, the session's and the desktop's), `ensureMountPoints` makes each point its
  spec gives a folder at that the toolbox lacks, where this server may write in it (its own toolbox, while
  `MERCBOT_SANDBOX_USER` runs runsc too); where it may not, the sandbox is refused in words naming
  `node scripts/toolbox-mount-points.mjs <toolbox>`, which the toolbox's owner runs, in place of gVisor's
  `cannot create sandbox`; a refused session or desktop leaves nothing open (its gateway closed, its folder gone), and a
  toolbox that isn't there is left so, nothing made in its place (`tests/server/sandboxMountPoints.test.js`).
- **Toolbox from a host's store (D-86):** on a host whose programs come from a read-only Nix store, nothing is
  installed or built: `MERCBOT_TOOLBOX_STORE` names the store (such as `/nix`) and `MERCBOT_TOOLBOX_DIR` the folder the
  toolbox is made in, and `scripts/serve.sh` runs `scripts/store-toolbox.mjs` (`makeStoreToolbox`, `storeToolbox.js`)
  before the server at every start. It links each program on `PATH` whose real file is in the store, the first by each
  name, as `usr/bin/<name>` (`bin` and `sbin` lead there, `sh` is bash where the store has no `sh`; a program outside
  the store isn't linked and doesn't take its name), the first of `chromium`, `chromium-browser`,
  `google-chrome-stable` and `google-chrome` as `opt/chrome/chrome`, and writes `etc/fonts/fonts.conf` (every
  `share/fonts` folder in the store, a fontconfig package's `etc/fonts/conf.d` where there is one, and stand-ins for
  sans-serif, serif, monospace, Arial, Helvetica, Times New Roman and Courier New), `etc/passwd`, `etc/group` and
  `etc/hosts`. Only links and settings files, and nothing in the folder is started from there, but it must be where
  programs may run: gVisor mounts it again, read-only, as each sandbox's system, and in Mercbot's own user namespace a
  host's `noexec` refuses that mount (`mountedNoexec` reads `/proc/self/mountinfo`, and the start stops, saying so).
  It is made beside the old one and replaces it whole. Its stamp, which offers bots the
  command line, is written only when every tool they're told of is there (`bash`, `tmux`, `tail`, `ffmpeg`,
  `ffprobe`, `convert`, `tesseract`, `pdftotext`, `pdftoppm`, `qpdf`, `gs`, `pandoc`, `python3` with pandas, numpy,
  matplotlib, openpyxl, python-docx and python-pptx, `node`, `npm`, `sqlite3`, `jq`, `git`, `curl`, `pip`); otherwise the start says
  which are missing and bots have no command line. Without a browser, `python3` or `sh` there, the start stops,
  saying so. Programs made for an ordinary Linux system (the office apps, Piper, Claude Code; D-89) get their loader
  when `nix-ld` and `ld.so` are on `PATH`: `lib64/ld-linux-x86-64.so.2` leads to nix-ld, and
  `run/current-system/sw/share/nix-ld/lib`, where nix-ld looks, holds glibc's `ld.so` and a link to each library in
  the folders `MERCBOT_TOOLBOX_LIBRARIES` names (`storeLibraries`: `lib*.so*` files whose real file is in the store,
  the first of each name; a folder that isn't one in the store stops the start, naming it). Without either program
  the start says those features can't start. `MERCBOT_TOOLBOX_MESA` names Mesa's folder in the store, whose lavapipe
  Vulkan manifest and EGL vendor file are linked where the desktop sandbox names them (`mesaManifests`,
  `DESKTOP_GRAPHICS` in `gvisor.js`); one lacking either stops the start, naming it. `MERCBOT_TOOLBOX_CERTIFICATES`
  names a root certificates bundle in the store (nixpkgs' `cacert`'s `etc/ssl/certs/ca-bundle.crt`), linked at
  `etc/ssl/certs/ca-certificates.crt`, which the store's python3, curl, git, node and pip read to check an https site
  (`storeCertificates`, D-126); one that isn't a file in the store stops the start, naming it, and without one the
  start says commands can't check https sites. `serve.sh` also points `FONTCONFIG_FILE` at the toolbox's fonts.conf for the desktops' own programs.
  `HOSTING_SCRIPT=scripts/hosting/store.sh` is such a host's script: `host_check` refuses without the two settings or
  without `runsc` on `PATH` (it sets `MERCBOT_RUNSC`), then checks namespaces as on Vibe64. Its
  `host_store_toolbox` says the toolbox and the desktops' programs come from the store (D-92): `install-tools.sh`,
  run with it where the release is built, installs only the downloads (rclone, Piper, the Craft apps, the coding
  tools, gVisor), skips `build-toolbox.sh` and the desktop programs and leaves no `.tools/toolbox` or `.tools/desktop`,
  and its first check (`namespace.sh --check-install`) leaves the host to the start's check; its toolbox and desktop
  steps refuse.
- **Tools' store (D-70):** every tool `npm run tools:install` installs, the toolbox included, is
  installed once per pinned version (with the install's `REVISION`) into its own folder of a store
  and hard-linked into `.tools/` (`scripts/tools-store.sh`), so readers of `.tools` and
  `MERCBOT_TOOLS_DIR` see plain files. A version already in the store is linked without
  downloading or checking anything; only a missing or changed one is installed, and the store's
  other versions of it are removed (a release's own links keep the files it runs). An install
  counts only once its marker (`.done`, or the toolbox's stamp) is written, last; one cut short is
  redone. The store is `MERCBOT_TOOLS_STORE`: `.tools/store` by default, and the home's
  `$HOME/.cache/mercbot-tools` through `npm run deploy:prepare`, which on Vibe64 is the app
  account's own home, kept across releases. One install runs at a time per store (`flock`).
- **Hosting script (D-68):** `HOSTING_SCRIPT` names it, relative to Mercbot's folder (default
  `scripts/hosting/vibe64.sh`); it is the only host-specific part: `host_check` (the host lets
  Mercbot make its own namespaces; nothing asks for FUSE since D-91), `host_display_programs` (finds `Xvfb`
  and `x11vnc` and sets `MERCBOT_XVFB` and `MERCBOT_X11VNC`), `host_desktop_tools` (the desktops'
  `tint2`, `hsetroot` and `xterm` where the system lacks them),
  `host_unpack_deb` (rclone's release), `host_toolbox_packages` (on Vibe64, the host's `apt-get
  download`) and `host_store_toolbox` (whether the toolbox and the desktops' programs come from the
  host's store, D-92). The install (`npm run tools:install`, which the Stack's Deployment Prepare step runs
  through `npm run deploy:prepare`) and the start check the host through it before anything else
  (`scripts/namespace.sh --check-install` and `--check`; the install's leaves a store host to the start's). A path to no file stops them naming the variable, the path it
  was given and the scripts in `scripts/hosting/`; a host without one of these stops them with one
  plain sentence ending "See README → Hosting requirements." and the error underneath. gVisor, the
  base image, the offline install inside gVisor, the Craft apps and Chrome are the same on every
  host.
- **One sandbox's pieces (`gvisor.js`, `@local/files/gvisor`, and `gateway.js`, `@local/files/gateway`):** what the
  command line, the office apps, the computers' desktop and their coding runs (`computer/bot-computer.md`) are each
  made of. The gateway is every sandbox's only way to the internet but the office apps', which have none (D-126);
  `sandboxGateway(dir, start)` is one sandbox's own (its socket and forwarder in `dir`, shown at `/gateway`).
  `sandboxSpec({runtimeEnv, args, cwd, env, limits, mounts, rootReadOnly, hostname, terminal})` is a
  sandbox's OCI spec: the toolbox as its system (`toolboxRoot`: `MERCBOT_TOOLBOX_DIR`, else `.tools/toolbox/rootfs`),
  a private `/tmp` of `limits.scratch`, no capabilities and no new privileges, its own namespaces, the limits on
  processes, open files, file size and (unless 0) each process's memory, and only the `mounts` given, with the host's
  store read-only at its own path, its programs startable, when `MERCBOT_TOOLBOX_STORE` names one (`storeMounts`); `folderMount(source,
  destination, {readonly, exec})` is one folder in it, always `nosuid,nodev` (gVisor mounts it again with its options,
  and in a user namespace a host refuses a mount that drops a restriction it set) and `noexec` unless `exec`.
  `sandboxPlace(kind)` is a new sandbox's id and folder, named after this server's process.
  `runSandboxed({env, place, spec, flags, maxSeconds, memory, onOutput, wrap, input})` runs one to
  its end, rootless with no network but what `flags` add: it kills it past `maxSeconds` or past
  `memory` bytes (`sandboxMemory`, read from outside every second), and however it ends it deletes the
  sandbox (`runsc delete -force`) and its folder before `done` resolves to `{exitCode, seconds,
  killed}`. `wrap` runs runsc inside another program, such as a window on a computer's screen.
  `sweepSandboxes` removes, once per server, what servers that are gone left.
  `sandboxMemory(env, place)` is gVisor's own count of what a sandbox holds (`runsc events
  -stats`): its programs, its files in memory and itself. Its process's resident memory isn't it:
  gVisor keeps the programs' memory in a file only they map, so a watch on that never fired.
- **Sandbox user (D-51):** every runsc call goes through `runsc(args)`, which with
  `MERCBOT_SANDBOX_USER` set runs `sudo -n -u <user> -- runsc …` (`scripts/setup-sandbox-user.sh`
  prepares the user, the sudo rule and the shared group). The sandbox's umask and the server's
  are then 002, and scratch folders the sandbox writes (`sharedScratch`) are group-writable.
- **`shell.available()`:** `runsc` and a stamped toolbox exist. Without them bots aren't offered
  `run_command`.
- **`shell.start({place, workspaceId, botId, chatBotId, userId, why, script, readOnly,
  foregroundSeconds, maxSeconds})`** runs `bash -c script` for a bot in a chat (`chatBotId`, its seat):
  - **How it runs:** `runsc --rootless --network=none --ignore-cgroups --overlay2=root:memory --host-uds=open`, so
    changes to the toolbox vanish. It sees a 1 GB scratch `/tmp`, the place's folders at
    `/files/chat`, `/files/bot` and `/files/shared` (read-only where the place only reads them, a Private chat's bot
    and home folders, D13; `readOnly` names more, of "chat", "bot" and "shared"), all mounted `noexec,nosuid,nodev` so nothing in
    them starts as a program, the Craft apps at `/opt/apps` on PATH, and its gateway's folder at `/gateway`. Its
    environment is only the listed variables, never the server's.
  - **The internet (D-126):** each run has a gateway of its own (`sandboxGateway`, `@local/files/gateway`: the
    computer's and coding runs' gateway, `computer/bot-computer.md`), on a socket in its folder made through the
    folder's open handle, since under a long TMPDIR its path passes the 107 bytes a socket's may have. The script runs
    after the forwarder (`START_FORWARDER`) listens at 127.0.0.1:3128 (at most 5 s), as a bash of its own
    (`WITH_GATEWAY`), and the gateway closes when the run ends. The gateway connects only to public addresses: never
    loopback, private, link-local (cloud metadata), CGNAT, reserved or multicast ones, the server's own, or the mail
    ports 25, 465, 587 and 2525; through CONNECT, any other port of a public address. The environment adds
    `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY` and their lower-case spellings, `NO_PROXY`/`no_proxy`
    (`localhost,127.0.0.1,::1`: the sandbox's own loopback), `NODE_USE_ENV_PROXY=1` (Node's own fetch and http),
    `NPM_CONFIG_PREFIX=/tmp/home/.local` and `PIP_BREAK_SYSTEM_PACKAGES=1` with `/tmp/home/.local/bin` on `PATH` (global
    npm and pip installs in the run's `HOME`, since a store host's toolbox is read-only), `PIP_ROOT_USER_ACTION=ignore`
    (pip doesn't warn the bot about running as root, which a sandbox's command always is), and `GIT_SSH_COMMAND`, which
    answers a `git@host:` address with "There's no ssh on this command line: use the repository's https:// address".
    A direct connection finds no network. Installs last one run: each starts from the same clean toolbox, and only what
    it writes in the folders (a clone, a project's `node_modules`) stays.
  - **Internet limits (D-127):** one command may receive `MERCBOT_INTERNET_COMMAND_IN_MB` (2048) and send
    `MERCBOT_INTERNET_COMMAND_OUT_MB` (200); past either its gateway ends every connection it has open and refuses
    the rest (403). A bot may open `MERCBOT_INTERNET_CONNECTIONS_PER_MINUTE` (120) new connections in a clock minute,
    across all its commands on every server (429, "slow down", when to try again), and a home's commands may use
    `MERCBOT_INTERNET_HOME_DAY_MB` (20480) a UTC day, both ways added up (open connections end, new ones are refused,
    until midnight UTC); each name's default applies when it's unset, and a value that isn't a positive number keeps
    it, said as the server starts (`internetLimits`, `internetUsage.js`). Each gateway has a meter
    (`createInternetUsage(...).forGateway({workspaceId, botId})`): it reads the home's day at its first connection,
    adds what it counts to `internet_days` in one statement every 10 s while data moves, once 64 MB wait and as it
    closes (never once a connection), each write answering the day's total, and takes the bot's connections from
    `internet_minutes` 1, 2, 4, 8 then 16 at a time, giving back the rest as it closes. A failed read or write is
    logged and never refuses. Whatever the gateway refused or ended, and why, is a note (the private addresses and
    mail ports too), at most ten and then a count: the run's output, and its whole output when kept, end with them,
    after a blank line (`withNotes`). `files.internet.today(options, homeId)` is the home's day for Settings →
    Spending (`GET /api/w/:home/files/internet`, everyone in the home), and the hourly sweep removes days older than
    two weeks (`internet.removeOld`).
  - **Limits:** each process gets `RLIMIT_AS` 2 GB, 128 processes, 1024 open files and 4 GB per
    file. A watchdog kills the sandbox above 3 GB in all. Output keeps the first and last 8 KB;
    when that cuts it, the whole output (up to 16 MB) is written once at the end as
    `/runs/<run>.log` (D-48): the seat's runs folder (`store.runsFolder(chatBotId)`, with the bots'
    files, outside every chat's and bot's folders; pulled from the files bucket first and sent to it once
    written, `store.settleRuns`, D-91), mounted read-only at `/runs` in its sandboxes.
  - **Concurrency:** at most `MERCBOT_SHELL_RUNS` (2) at once per server; one per bot in a chat,
    else `{status: "busy"}`.
  - **Answer:** `{status: done|failed|stopped, run, exitCode, output, truncated, seconds, stopped?,
    changed}` (files changed in the folders), the status its record has (`stopped` when the server's
    shutdown stopped it, or its home's work was paused: the meter refused its next block, which Mercbot's own recorder
    never does; `stopped?` says why for every stop). A run still going after `foregroundSeconds` (120)
    answers `{status: "running", run}` and carries on up to `maxSeconds` (1800).
- **Records:** every run is a `shell_runs` row. The running server heartbeats it every 20 s with
  the output so far. `shell.sweep()` (every 30 s on each serving server) marks a running row whose
  heartbeat is older than 90 s `stopped`, once, and (at most hourly) deletes run logs over a week old.
  `shell.check(home, run)` reads a run of that home.
  `shell.onEnd(handler)` hears the end of background runs (finished, failed or stopped).
  `shell.drain()` on shutdown kills running commands, which end as `stopped`.
- **The computer's session:** `shell.attach({key, place, label})` (key: the computer's, the seat's chat_bots id)
  starts a detached gVisor sandbox with the same mounts as a run, `/runs` and a gateway of its own included (closed
  when the session ends), running tmux:
  the top pane follows `/tmp/bot.log` under `label`, the bottom pane is a bash loop for the person. The sandbox's
  own process only keeps it up; attach starts its tmux in it with `runsc exec` (`SESSION_TMUX`) and answers once that
  has, so the session's runs and the Terminal find `main` from the start, however slowly the sandbox started. A
  session whose tmux didn't start ends, and attach fails (the computer goes on without it).
  While it exists, that seat's runs (except those with `readOnly`) execute in it with
  `runsc exec` (`IN_SESSION`): each is shown in the log with its heading, its output and then `(exit N)`, written
  once the log's copy of its output is (`tests/server/sessionLog.test.js`), keeps
  its own time limit, and shares the session's `/tmp`. The session's gateway counts each run's internet from its start
  (`gateway.begin()`) and again from its end, and the run's output ends with that run's notes (D-127); the person's
  shell counts toward the bot's minute and the home's day. The log starts again once past 1 MB and
  takes at most 1 MB of one command; the run's own output is unaffected.
  - **The Terminal:** `shell.terminalCommand(key)` is the command the desktop's xterm runs
    (`tmux attach`).
  - **Sleep:** `shell.detach(key)` is called when the computer sleeps. New runs go back to fresh
    sandboxes at once, but a run still going in the session finishes there, and the session
    ends after it.
  - **Memory:** a session above the sandbox memory limit is ended at once.
- **Bots:** every bot with files gets `run_command {why, script, seconds?}` and `check_command
  {run}`; `run_command`'s description and the standing rules say what commands reach (D-126): the public internet
  through the gateway (git clone over https, downloads, npm or pip installs for the job), no ssh, and each run from the
  same clean toolbox. Without the copy's GitHub App, or in work another bot asked for, they say there's no GitHub
  sign-in to push with.
- **Signed in to GitHub (D-128):** on a copy with its GitHub App (`integrations.connections.github.ready()`),
  `run_command` also takes `github` (owner/name), except in work another bot asked for. `githubCommandKey`
  (`githubCommands.js`) finds the repository with the turn's person's own GitHub (`github.repository`), and checks
  that person let this bot use it (`records.githubRepos.allows`, always or for this seat's task). If they haven't,
  nothing runs and a card goes under the reply (`purpose: "github-repo"`). If they have, the app makes a key for that
  repository alone (`github.commandKey`). `shell.start({ secret })` runs the command in a fresh sandbox, never the
  computer's session, with `secret.env` (`githubEnv`: `GH_TOKEN`, `GH_PROMPT_DISABLED`, `GIT_TERMINAL_PROMPT=0`, git's
  credential helper for `https://github.com` through `GIT_CONFIG_COUNT`, and the bot's name as author and committer at
  `<slug>[bot]@users.noreply.github.com`). `secretMask` replaces each of `secret.hide` and git's Basic form of it
  (base64 of `x-access-token:<key>`) with `***` as output streams, holding back the end of each piece until the next.
  Everything downstream reads the masked output: the bot, `shell_runs.output`, `/runs/<run>.log` and the chat line.
  `secret.ended` withdraws the key once the command ends, whatever happens: refused, failed to start, finished or
  stopped. The app's private key is never in a sandbox's variables. In turns another bot started (D-46), `/files/chat` and `/files/shared` are read-only. A
  reply's commands become one `event` with `icon: "command"` and `commands: [{why, script,
  output, exitCode, run, running}]`, shown in the chat as one line that opens to each script and
  its output.
- **Background ends:** `botLoops.js` queues an `app_jobs` task of kind `shell` for the run's seat in its chat. The task posts "Command finished" (or "Command stopped") and a turn in which the
  bot reports. It listens through the server's shutdown: Files drains after Bots and stops the commands still running,
  each reported so, and another server runs the task. Replies with the shell may take 40 steps. The standing rules (`FILES_RULES`)
  explain the folders and the command line, and the skill "Working on the command line" has
  recipes.

## Owned data

- `shell_runs`: one row per command a bot ran, keyed by its seat (`chat_bot_id`).
- `internet_days`: what a home's bot commands received, sent and opened on the internet each UTC day, one row a home and
  day, kept two weeks (D-127).
- `internet_minutes`: each bot's new connections in its present minute, one row a bot (D-127).

## Proved by

- `tests/server/shell.integration.js`
- `tests/server/commandInternet.test.js`
- `tests/server/commandGithub.test.js`
- `tests/server/githubCommands.integration.js`
- `tests/server/commandInternetWords.test.js`
- `tests/server/gateway.test.js`
- `tests/server/internetLimits.test.js`
- `tests/server/internetLimits.integration.js`
- `tests/e2e/spending.spec.ts`
- `tests/server/storeToolbox.test.js`
- `tests/server/toolboxRun.test.js`
- `tests/server/toolsStore.test.js`
