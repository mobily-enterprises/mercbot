# Bots' command line

Every bot can run bash scripts on its own Linux command line, in gVisor, on its conversation's
folders and without network (D-47).

## Sources

- Main: `packages/files/src/server/shell.js`
- `packages/files/src/server/gvisor.js`
- `scripts/build-toolbox.sh`
- `scripts/hosting/vibe64.sh`
- `scripts/install-tools.sh`
- `scripts/toolbox-run.sh`
- `scripts/tools-store.sh`
- `migrations/20261113120000_baseline.cjs`
- `packages/bots/src/server/botTools.js`
- `packages/bots/src/server/commandTools.js`
- `packages/bots/src/server/botLoops.js`
- `packages/bots/skills/command-line.md`
- `tests/server/shell.integration.js`
- `tests/server/toolboxRun.test.js`
- `tests/server/toolsStore.test.js`

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
  Mercbot make its own namespaces and gives it `/dev/fuse`), `host_display_programs` (finds `Xvfb`
  and `x11vnc` and sets `MERCBOT_XVFB` and `MERCBOT_X11VNC`), `host_desktop_tools` (the desktops'
  `tint2`, `hsetroot` and `xterm` where the system lacks them),
  `host_fuse_tools` (a `fusermount3` without the set-user-ID bit from Ubuntu's `fuse3`, through which
  rclone mounts in Mercbot's namespace), `host_unpack_deb` (rclone's release) and `host_toolbox_packages` (on Vibe64, the host's `apt-get
  download`). The install (`npm run tools:install`, which the Stack's Deployment Prepare step runs
  through `npm run deploy:prepare`) and the start check the host through it before anything else
  (`scripts/namespace.sh --check`). A path to no file stops them naming the variable, the path it
  was given and the scripts in `scripts/hosting/`; a host without one of these stops them with one
  plain sentence ending "See README → Hosting requirements." and the error underneath. gVisor, the
  base image, the offline install inside gVisor, the Craft apps and Chrome are the same on every
  host.
- **One sandbox's pieces (`gvisor.js`, `@local/files/gvisor`):** what the command line, the office
  apps, the computers' desktop and their coding runs (`computer/bot-computer.md`) are each made of.
  `sandboxSpec({runtimeEnv, args, cwd, env, limits, mounts, rootReadOnly, hostname, terminal})` is a
  sandbox's OCI spec: the toolbox as its system, a private `/tmp` of `limits.scratch`, no
  capabilities and no new privileges, its own namespaces, the limits on processes, open files, file
  size and (unless 0) each process's memory, and only the `mounts` given; `folderMount(source,
  destination, {readonly, exec})` is one folder in it, `noexec,nosuid,nodev` unless `exec`.
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
- **`shell.start({place, workspaceId, botId, conversationId, userId, why, script, readOnly,
  foregroundSeconds, maxSeconds})`** runs `bash -c script`:
  - **How it runs:** `runsc --rootless --network=none --ignore-cgroups --overlay2=root:memory`, so
    changes to the toolbox vanish. It sees a 1 GB scratch `/tmp`, the place's folders at
    `/files/mine` (the bot folder for a place without a person), `/files/bot` and `/files/shared`
    (`readOnly` names folders mounted read-only), all mounted `noexec,nosuid,nodev` so nothing in
    them starts as a program, and the Craft apps at `/opt/apps` on PATH. Its
    environment is only the listed variables, never the server's.
  - **Limits:** each process gets `RLIMIT_AS` 2 GB, 128 processes, 1024 open files and 4 GB per
    file. A watchdog kills the sandbox above 3 GB in all. Output keeps the first and last 8 KB;
    when that cuts it, the whole output (up to 16 MB) is written once at the end as
    `/runs/<run>.log` (D-48): the conversation's runs folder (`store.runsFolder`, on the shared
    volume, outside every person's folders), mounted read-only at `/runs` in its sandboxes.
  - **Concurrency:** at most `MERCBOT_SHELL_RUNS` (2) at once per server; one per conversation,
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
- **The computer's session:** `shell.attach({key, place, label})` (key: the conversation's id)
  starts a detached gVisor sandbox with the same mounts as a run, `/runs` included, running tmux:
  the top pane follows `/tmp/bot.log` under `label`, the bottom pane is a bash loop for the person.
  While it exists, that conversation's runs (except those with `readOnly`) execute in it with
  `runsc exec` (`IN_SESSION`): each is shown in the log with its heading and `(exit N)`, keeps
  its own time limit, and shares the session's `/tmp`. The log starts again once past 1 MB and
  takes at most 1 MB of one command; the run's own output is unaffected.
  - **The Terminal:** `shell.terminalCommand(key)` is the command the desktop's xterm runs
    (`tmux attach`).
  - **Sleep:** `shell.detach(key)` is called when the computer sleeps. New runs go back to fresh
    sandboxes at once, but a run still going in the session finishes there, and the session
    ends after it.
  - **Memory:** a session above the sandbox memory limit is ended at once.
- **Bots:** every bot with files gets `run_command {why, script, seconds?}` and `check_command
  {run}`. In turns another bot started (D-46), `/files/mine` and `/files/shared` are read-only. A
  reply's commands become one `event` with `icon: "command"` and `commands: [{why, script,
  output, exitCode, run, running}]`, shown in the chat as one line that opens to each script and
  its output.
- **Background ends:** `botLoops.js` queues an `app_jobs` task of kind `shell` in the run's
  conversation. The task posts "Command finished" (or "Command stopped") and a turn in which the
  bot reports. Replies with the shell may take 40 steps. The standing rules (`FILES_RULES`)
  explain the folders and the command line, and the skill "Working on the command line" has
  recipes.

## Owned data

- `shell_runs`: one row per command a bot ran.
