# Mercbot on your own computer: a plan

**Status: a plan written on 2026-11-11 and checked against the code of the time. All ten questions were agreed
as recommended on 2026-11-12, and the same day a person's own copy became single-user (D-81). Phase 1 is built
(changes 2–5 and 7, D-81); phase 2, below, is the installer and the proof on fresh machines.** Mercbot runs as
standalone software on people's own computers. Spending still matters there, because it shows which bot is
expensive, and nothing is ever paused or refused for it (D-73). **(unproven)** marks what is expected but hasn't
been tried.

A standalone copy is D-15's one-server case, not a second product: one computer and one Mercbot, used by a
person or a family at `http://localhost:3001`. Everything bots run stays in gVisor (D-49), and nothing is
quietly switched off (D-68).

## What stops it today

### The bots' computers

- **Stock Ubuntu 24.04 refuses the sandbox.** Its `apparmor` package sets
  `kernel.apparmor_restrict_unprivileged_userns = 1` (`/usr/lib/sysctl.d/10-apparmor.conf`). As a result,
  `unshare --user --map-root-user` fails with "write failed /proc/self/uid_map: Operation not permitted"
  (reproduced on 24.04.5, 2026-11-11). Mercbot then stops with "This host doesn't let Mercbot create its
  own sandboxes" (`scripts/hosting/vibe64.sh:19-24`). Lifting this takes root (question 2). Later Ubuntu
  releases are expected to do the same (unproven).
- **x86_64 only.** Every download is pinned to amd64 or x86_64 (`scripts/install-tools.sh:65, 76, 95, 114,
  141`, `scripts/build-toolbox.sh:21, 50, 53`, `vibe64.sh:64`), and Chrome for Testing has no Linux arm64
  build.
- **Only Vibe64's hosting script exists** (the default, `scripts/namespace.sh:19`). It needs `apt-get`
  (`vibe64.sh:57-58`), so Fedora and Arch can't build the toolbox. It checks `Xvfb` and `x11vnc` but not
  `openbox`, without which the desktop silently has no window manager
  (`packages/computer/src/server/desktop.js:356-361`).
- **`npm start` and the `Procfile` skip the host checks** (`package.json:17`); only `scripts/serve.sh`
  runs them. On a host that lacks something, the server starts anyway. The failure shows only when a bot
  first uses its computer: "This server can't sandbox the bot's browser"
  (`packages/computer/src/server/computerManager.js:224`).
- **Sized for a server:** the first tools install takes 15–25 minutes and the toolbox is about 2.3 GB
  (`docs/deployment.md:19-20, 34`); up to 3 computers stay awake (`computerManager.js:160`), each 310–460 MB
  plus 180 MB per office app (`help/own-copy.md:25`); Mercbot itself about 0.75–1.5 GB (`genesis/stack.md`'s
  estimate).
- **Sandboxes run as the person.** D-51's powerless sandbox user keeps a program that escaped gVisor away
  from Mercbot's keys. That user needs root to set up (`scripts/setup-sandbox-user.sh`). Without it, such
  a program is the person, with all their files.
- **No home network.** The gateway refuses private addresses
  (`packages/computer/src/server/gateway.js:11-23`, D-49), so bots can't reach the router, a NAS or a
  printer. This is by design, and at home it keeps bots off the home network.

### Sign-in and mail

**Settled by D-81 (2026-11-12):** a person's own copy has one person, opened with its key (`mercbot open`), and no
sign-in, registration, invitations, members or mail. What a copy with sign-in found on 2026-11-11 (anyone reaching
the address could register, no password recovery, invitations waiting for SMTP, a setup code easy to miss) no
longer applies.

### Address and network

- **Production refuses `http://localhost`.** It needs an https `APP_PUBLIC_URL`
  (`server/lib/runtimeEnv.js:43-48`, D-65). Without production mode, there's no setup code, and
  confirmation and recovery links appear in answers and the log.
- **It listens on every interface.** `HOST` defaults to `0.0.0.0` (`runtimeEnv.js:33`, `server.js:242`),
  so a laptop on café Wi-Fi offers Mercbot to everyone there.
- **Phones and other computers need https,** because browsers give the microphone (voice) only to https or
  localhost.
- **`localhost` stays on that computer:** public apps and links work only there, and Connect apps asks
  the person to paste the address the provider's sign-in ended on
  (`packages/integrations/src/server/oauth.js:68-76`). A hub (`MERCBOT_HUB_URL`, D-31) lends its own
  provider apps.

### Data and AI

- **The data lives in the code's folder.** Without `MERCBOT_FILES_DIR`, files go to `.data/files` where
  the server runs (`packages/files/src/server/fileStore.js:48`), ignoring `MERCBOT_DATA_DIR`, which only
  computers and people's own storage use (`computerManager.js:159`,
  `packages/files/src/server/remoteMounts.js:131`). Profile pictures go with the files, in
  `profile-pictures/` (since 2026-11-11; before, in JSKIT's `data/storage`). An upgrade that unpacks a release beside the old one leaves them behind,
  and `MERCBOT_FILES_DIR` can't name a plain folder, since `scripts/serve.sh:12-21` mounts JuiceFS there.
- **Two AI accounts.** Mercbot doesn't start without premium (`together`) and economy (`deepinfra`), each
  with its own key (D-72, `checkAiSettings` in `packages/account/src/server/providers/index.js`). Images
  (`gemini`) are optional; without them, a bot says pictures aren't set up.

### Running, upgrading and the help

- **Background work runs only while the computer is on** (routines, watches, app jobs and summaries run
  inside the server, D-15). Runs missed while it slept become one catch-up run
  (`packages/bots/src/server/routineRunner.js:14-18`), and a run in progress when Mercbot stops is lost
  until its next run (D-59; resuming is being built).
- **No installer, service, upgrade or backup** (`docs/architecture.md:349`, M7). Today it is a clone,
  `.env` by hand, `deploy:prepare`, `build`, `db:migrate` and `scripts/serve.sh` (`docs/deployment.md`),
  on Node 26 and PostgreSQL 16 or later (`docs/architecture.md:45`), which most systems don't ship. Only
  Vibe64's Deploy generates the secrets (`genesis/stack.md:64-65`). A backup needs the database, the data
  and the settings: without the same `MERCBOT_VAULT_KEY`, saved logins, connected accounts and saved
  browsers can't be opened.
- **The help says otherwise:** "Does a bot ever work on my own computer? No"
  (`help/security-questions.md:15-17`), About says "Mercbot updates itself" (`help/settings.md:109`), and
  `help/own-copy.md` describes several servers and DeepSeek.

## Per operating system

| | Linux | macOS | Windows |
|---|---|---|---|
| Mercbot and PostgreSQL | Native | `npm start` only, without computers, commands, office apps or voice (unproven) | As macOS |
| Bots' computers (gVisor) | Native, x86_64 | Only in a Linux VM (Docker Desktop, OrbStack, Colima); none on Apple Silicon yet | Only in a Linux VM: WSL2, or Docker Desktop on it |
| Root | Once: packages, and on Ubuntu question 2's step | Installing Docker | Installing WSL2 (`wsl --install`) |
| Proven | Vibe64's Ubuntu servers only | Nothing | Nothing |

- **gVisor is Linux only.** It is a kernel for Linux programs, built on Linux's namespaces and system-call
  filters.
- **Apple Silicon** runs arm64 VMs, and gVisor isn't expected to work under Rosetta, since it traps every
  system call. gVisor, Node, Ubuntu, JuiceFS, rclone and Piper have arm64 builds; Chrome would become an
  arm64 Chromium; the Craft apps' arm64 builds are unknown.
- **WSL2** is a real Linux kernel built into Windows 10 and 11. Its Ubuntu has apt and `/dev/fuse`, and
  with no AppArmor in its kernel the restriction above shouldn't apply (unproven). WSL may stop Ubuntu
  when its last window closes, which would stop routines.
- **Docker** must let the container make namespaces and open `/dev/fuse`, through `--privileged` or
  through unconfined seccomp and AppArmor plus `--device /dev/fuse`. On a Linux host that amounts to root.

## The smallest path

**Recommended:** one command that downloads a release's `install.sh` and runs it, on Linux and in WSL2's
Ubuntu on Windows, with no Docker; macOS gets Docker Compose in a second release, once there is an arm64
toolbox. One script covers two of the three systems. On Linux, Docker would need a privileged container,
which is root on the host, while the script runs as the person and needs root only for question 2. WSL2
is free and built in, and Docker Desktop runs on it anyway (paid for larger companies). macOS needs a VM
either way: Docker is the one Mac users know, Compose brings PostgreSQL along, and the privileged
container stays inside Docker's VM.

### What `install.sh` does

1. **Checks the computer:** x86_64, Ubuntu 24.04 or Debian 12 (WSL2's Ubuntu included), and about 8 GB of
   memory and 15 GB of free disk (to be measured). It names whatever is missing. Debian 12 is unproven:
   its PostgreSQL is 15, and the toolbox would be built through Debian's apt.
2. **One root step,** shown first and run with sudo once the person agrees: `apt-get install postgresql
   xvfb x11vnc openbox fuse3 zstd`, the database and its user, lingering (so Mercbot runs while nobody is
   signed in) and, on Ubuntu, question 2.
3. **Installs as the person:** Node 26 and the release go into `~/.local/share/mercbot`, then it runs
   `npm run deploy:prepare` (tools kept in `~/.cache/mercbot-tools`, D-70), `npm run build` and
   `npm run db:migrate`.
4. **Writes the settings below,** once, with mode 600 and outside the release, asking for the AI keys.
5. **Starts Mercbot** with `mercbot start`, which adds the user service (`systemctl --user`) that runs
   `scripts/serve.sh` at start-up and drains it on stop. The first start makes the key and the one person
   (D-81).
6. **Opens Mercbot** with `mercbot open`; there is no setup code or first account.

### The settings for one computer

These are ordinary settings. The code gains no "standalone mode".

| Setting | Value | Why |
|---|---|---|
| `NODE_ENV`, `APP_PUBLIC_URL`, `HOST` | `production`, `http://localhost:3001`, `127.0.0.1` | Production's protections, on this computer only (question 4); Mercbot, opened with its key, refuses any `HOST` but loopback (D-81) |
| `SIDE_EFFECTS` | `live` | A person's own copy acts for real (D-69) |
| `AUTH_LOCAL_SESSION_SECRET`, `MERCBOT_VAULT_KEY` | generated | As Vibe64's Deploy does |
| `AUTH_LOCAL_EMAIL_CONFIRMATION` | `false` | JSKIT's production start needs it without a confirmation sender; nobody registers (D-81) |
| `MERCBOT_DATA_DIR`, `JSKIT_STORAGE_FS_BASE_PATH` | under `~/.local/share/mercbot/data` | Upgrades keep the data; the key is `mercbot.key` there (mode 600) |
| `MERCBOT_MAX_COMPUTERS` | `1` | Fits a laptop |
| `MERCBOT_SANDBOX_USER` | question 2's user | D-51 |
| `HOSTING_SCRIPT` | `scripts/hosting/local.sh` | Change 2 |
| `MERCBOT_TRUSTED_DIR` | unset (`/usr/local/lib/mercbot`) | Where question 2's root step puts its `unshare` and `runsc` |
| `AI_PREMIUM_*`, `AI_ECONOMY_*`, optionally `AI_IMAGES_*` | asked | D-72 (question 5) |

No `MAIL_URL`, `AUTH_LOCAL_SELF_REGISTRATION` or `AUTH_LOCAL_SETUP_CODE` (D-81: the one person runs the copy, and
nobody registers), and no files volume.

### The changes, in order

1. **Licensed, with releases:** the LICENSE, the source published (question 1), and
   numbered releases (`package.json` is still `account-app` 0.1.0).
2. **`scripts/hosting/local.sh`,** D-68's script for another host (Ubuntu 24.04 and Debian 12 on x86_64):
   it uses question 2's `unshare` and `runsc`, also checks `openbox` (as `vibe64.sh` now does too), and each
   refusal names the command that fixes it.
3. **No start without the checks:** `npm start` and the `Procfile` go through `scripts/serve.sh`, or
   `bin/server.js` refuses to start outside Mercbot's namespace.
4. **One data folder:** with no volume, files go to `<MERCBOT_DATA_DIR>/files`. Profile pictures already go
   with the files (2026-11-11).
5. **Loopback in production:** `checkPublicUrl` also accepts `http://localhost` and `http://127.0.0.1`
   (question 4).
6. **Dropped (D-81):** a person's own copy has no invitations, passwords or mail.
7. **A `mercbot` command:** `start`, `stop`, `status`, `upgrade` (the new release beside the old, tools
   linked, a backup, the migration, the switch, the old release kept to go back to), `backup` and `restore`
   (one archive of the database, the data and the settings, marked as holding the vault key). About stops
   saying "Mercbot updates itself" on such a copy.
8. **Help:** `help/own-copy.md` rewritten around the install, the security and About answers corrected,
   and no pages about who runs the copy (question 8).
9. **Proof:** on a fresh Ubuntu 24.04 desktop and on Windows 11 with WSL2, timed from the one command to a
   bot's first reply that used its computer. Then an upgrade, and a restore onto a clean machine.
10. **macOS, in a second release:** an arm64 toolbox, then the Compose file and its proof.

## Questions (all agreed as recommended, 2026-11-12)

1. **Publish the source** with the first standalone release? The AGPL gives everyone using a copy its source
   anyway. (Recommended: yes.)
2. **One root step on Ubuntu,** shown to the person and asked first, without which bots' computers can't
   start there:
   - an AppArmor profile that lets only root-owned copies of `unshare` and `runsc` make namespaces, since a
     profile on `/usr/bin/unshare` would cover every user's;
   - D-51's sandbox user, so a program that escapes gVisor isn't the person.

   D-68 says Mercbot ships no script that changes a host's security settings, though
   `scripts/setup-sandbox-user.sh` already writes a sudo rule; and a `runsc` upgrade would need root again.
   (Recommended: yes to both, never the system-wide switch. Neither is proven on a person's computer, and
   D-51 was tried only with a stand-in for sudo, so change 9's proof decides.)
3. **The install method above:** one command on Linux and in WSL2, with Docker Compose for macOS after an
   arm64 toolbox? (Recommended: yes.)
4. **Loopback without https:** may production accept `http://localhost` on that computer only, as an
   exception to D-65? (Recommended: yes, only while `HOST` is loopback too. Phones wait for the person's
   own https proxy.)
5. **Two AI accounts:** within D-72, a person needs a Together AI key and a DeepInfra key, and images stay
   optional. Is that fine for the first release? (Recommended: yes. Both kinds run DeepSeek V4.1 Flash, so
   a later `together` type for economy could let one key serve both. Other types, such as a local model,
   come later too, as D-72's type setting allows.)
6. **No computer prices on a person's own computer.** **Moot:** Mercbot keeps no prices. A computer's days and
   its commands are counted as use, with no cost, and Settings → Spending shows what the AI providers cost (D-73).
7. **Inviting without mail:** show an invitation's link to copy when the copy has no mail, until the users
   app? (Recommended: yes.) **Moot since D-81:** a person's own copy has no invitations.
8. **Pages about who runs the copy:** a standalone copy shows no terms, privacy, cookies or acceptable-use
   pages, contact address or prices of anyone's service. (Recommended: none; About keeps the software's
   copyright line.)
9. **A hub,** offered by the installer for Gmail or Calendar? (Recommended: not in the first release.)
10. **A ready-made toolbox download** instead of building it on each computer? It needs hosting and a
    licence check of Chrome for Testing and of the sources for the toolbox's GPL packages.
    (Recommended: later.)

## Phase 2: the installer and the proof on fresh machines

Phase 1 (2026-11-12) built what the test hosts could prove: `scripts/hosting/local.sh`, no start without the host's
checks, one data folder, loopback http in production, the single-user copy (D-81), the `mercbot` command
(`scripts/mercbot`: `start`, `stop`, `status`, `open`, `new-key`, `backup`, `restore`, and `upgrade` from a release
archive given to it). It was tried on a test host's loopback from `mercbot open`'s
page to a bot's first reply, with the server started directly: the test hosts have no openbox or x11vnc and keep
Ubuntu's namespace restriction, so `mercbot start` there stops at `local.sh`'s refusal, as it should. Left, in order:

1. **Releases (change 1):** numbered releases, each an archive of one folder; `mercbot upgrade` then fetches the newest itself (today it takes the archive's path).
2. **`install.sh`:** the steps above. It writes `mercbot.env` once (mode 600, the table above, the secrets
   generated), links `~/.local/bin/mercbot` to `current/scripts/mercbot`, and sources that script for its last steps
   (`mercbot_start`, then `mercbot_open`). Its root step: the packages, a database and user that owns it (so
   `mercbot restore` can replace its schema), lingering, D-51's sandbox user, and on Ubuntu question 2's AppArmor
   profile with root's copies of `unshare` and of `runsc` at `install-tools.sh`'s pinned release (checked against its
   digest) in `/usr/local/lib/mercbot`. Without the trusted `runsc`, `local.sh` refuses a computer that restricts
   namespaces, naming this step.
3. **Help (change 8):** `help/own-copy.md` around the installer, the key and the `mercbot` command.
4. **The proof (change 9), which needs machines the test hosts don't have:** a disposable Ubuntu 24.04 desktop VM
   with its own kernel (a container shares the host's kernel, AppArmor and FUSE, so it proves nothing about a
   person's computer): 4 vCPUs, 8 GB of memory, 30 GB of disk, sudo inside it, network for apt, npm, Node and the
   tools' downloads, and the stand-in AI reachable from it. None of the test hosts has one yet. Then Windows 11
   with WSL2. Each is timed from the one command to a bot's first reply that used its computer, then an upgrade, a
   `mercbot backup` restored onto a second fresh VM, and `mercbot new-key` signing the browser out.
5. **macOS (change 10),** in a second release.
