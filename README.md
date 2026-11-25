# Mercbot

Mercbot is your own copy of personal AI agents ("bots") that do real work for you. It is a Fastify and Vue application
built with JSKIT, on PostgreSQL; each bot has a small desktop computer and a Linux command line, both in gVisor.
`genesis/blueprint.md` explains what it does, and `help/` is the help centre people read.

## Run locally

Install Node.js 26 and Git. Create a PostgreSQL database and an application user with permission to migrate its tables.

```sh
npm ci
cp .env.example .env
```

Edit `.env` with your own database connection. Generate a fresh session secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and set `AUTH_LOCAL_SESSION_SECRET`. Keep `.env` private. Then run:

```sh
npm run db:prepare
npm run develop
```

The schema starts from one baseline migration (`migrations/20261113120000_baseline.cjs`); later changes are forward
migrations after it. A database migrated before that baseline can't be migrated any further (Knex finds its earlier
migrations missing): recreate it empty, then run `npm run db:prepare` again. This covers development databases, the
test template (`<TEST_DB_NAME>_tpl`, which a test run rebuilds by itself) and a Preview's or Test Preview's database.

Open Mercbot with its key, as a person's own copy opens (D-81): http://localhost:3001/open?key= followed by the key in `.data/mercbot.key`, which the first start makes. Without it, Mercbot's server answers only that Mercbot opens with `mercbot open`. `npm run build` followed by `npm start` serves a production build. `npm start` (like the `Procfile`'s web process and `npm run server`) goes through `scripts/serve.sh`, so it starts only on a host that passes the checks below. `PORT` chooses the port.

`APP_ENV` says where a copy runs (D-87), and Mercbot doesn't start without it: `development` (as `.env.example` sets it, and as `npm run develop` and `npm run dev` set it themselves), `test` (which the test suites and the Test Preview set), `staging` or `production`. Staging and production also need `NODE_ENV=production`, which only picks optimised builds. Only `production` sends for real what bots send from connected accounts and what scripts send to outside web services; anywhere else each is logged instead (D-69), and every page shows a small tab naming the environment. `SIDE_EFFECTS` is gone: JSKIT refuses to start while it is set.

## Hosting requirements

Bots' computers and commands run in gVisor (`runsc --rootless`), and Mercbot itself runs in a user
and mount namespace of its own (`scripts/namespace.sh`, D-68). Nothing mounts and no host is asked for FUSE: bots'
files are in an S3 bucket Mercbot reaches itself, or a folder, and people's storage goes through rclone's remote
control (D-91). What depends on the host lives in one hosting script, named by
`HOSTING_SCRIPT` relative to Mercbot's folder (default `scripts/hosting/vibe64.sh`): it
checks that the host lets Mercbot make its own namespaces, finds `Xvfb`,
`x11vnc` and `openbox`, and obtains the Ubuntu packages Mercbot needs: the toolbox's, and the desktops' own
programs (`tint2`, `hsetroot`, `xterm`) where the system lacks them. Everything the same on every
host (gVisor, the toolbox's base image and its install inside gVisor, the apps, Chrome,
rclone, Piper) stays in the shared install. A host that lacks any of these stops
`npm run tools:install`, `npm run develop` and `scripts/serve.sh` with one sentence saying so and
the error underneath; Mercbot never switches its computers off quietly. Check a host with
`bash scripts/namespace.sh --check`.

- **Vibe64** (`scripts/hosting/vibe64.sh`), for developing Mercbot in a Vibe64 session: Vibe64's machines have
  `Xvfb`, `x11vnc`, `openbox` and `apt-get`; the script uses only that and never works around Vibe64's rules. The
  first install on a host installs the tools and builds the toolbox (15–25 minutes); they are kept in the app's own
  home (`$HOME/.cache/mercbot-tools`), so a later install reinstalls only a tool whose version changed (D-70).
- **A person's own computer** (`scripts/hosting/local.sh`, Ubuntu 24.04 or Debian 12 on x86_64; not yet
  proven on a fresh computer, docs/standalone-plan.md): the same checks, and each refusal names the
  command that fixes it (`sudo apt-get install xvfb x11vnc openbox`, or the
  installer's root step). Ubuntu lets only programs AppArmor trusts make namespaces, so there Mercbot uses
  the root step's own copies of `unshare` and `runsc` in `/usr/local/lib/mercbot` (`MERCBOT_TRUSTED_DIR`),
  only if root owns them, and refuses to start once the tools' gVisor is newer than that copy. Such a copy
  listens on this computer only (D-81, `HOST=127.0.0.1`) and, like every copy, has one person and no sign-in: it
  opens with its key by `mercbot open`. `scripts/mercbot` runs it (`start`, `stop`, `status`, `open`, `new-key`, `backup`,
  `restore`, `upgrade`) from `~/.local/share/mercbot`.
- **A host whose programs come from a read-only Nix store** (`scripts/hosting/store.sh`): nothing is installed
  there; Mercbot's release brings its downloads, which `npm run tools:install` with this hosting script installs where
  the release is built, without the toolbox or the desktops' programs (D-92). `MERCBOT_TOOLBOX_STORE` names the store (such as `/nix`) and `MERCBOT_TOOLBOX_DIR` a writable folder where
  programs may run, and each
  start makes the bots' toolbox there from the store's programs on `PATH` (gVisor's `runsc`, Chromium, Python, bash,
  fonts) as links, which every gVisor sandbox can follow because it sees the store read-only at the same path. The
  host must also give Mercbot its own namespaces, have `Xvfb`, `x11vnc` and `openbox` on `PATH`, and
  let programs run in its temporary folder, its data folder (the computers' launchers) and the toolbox's folder (gVisor
  mounts it again). The office apps, voice memos and coding tools are still `npm run tools:install`'s downloads, made
  for an ordinary Linux system: with `nix-ld` and glibc on `PATH`, and their libraries' folders in
  `MERCBOT_TOOLBOX_LIBRARIES` (and Mesa's in `MERCBOT_TOOLBOX_MESA` for the office apps' windows), they start there
  too. Bots' commands check https sites against the root certificates `MERCBOT_TOOLBOX_CERTIFICATES` names in the
  store (nixpkgs' `cacert`). docs/deployment.md lists the packages.
- **Other hosts** are not supported yet. Another host needs its own `scripts/hosting/<name>.sh` with
  the same functions (`host_check`, `host_display_programs`, `host_toolbox_packages`,
  `host_desktop_tools`, `host_unpack_deb`, `host_store_toolbox`; those for Ubuntu are shared in
  `scripts/hosting/lib/ubuntu.sh`), named by `HOSTING_SCRIPT`, and must provide: Linux that lets the
  app create its own user, mount, PID, IPC, UTS and network namespaces; `x11vnc`, `openbox` and
  `Xvfb`; and a way to obtain and unpack Ubuntu packages (on a host without Debian's apt, for
  example by downloading them inside the sandbox).

## Use through Genesis or Vibe64

See [starting Mercbot](docs/colleague-usage/starting-app.md): what it needs, opening it, publishing and what to do
when a start stops.

The Preview opens Mercbot as a person's own copy does, with its key (`tools/preview-identity` and the Stack's
`#### Preview identity` block): signing in as `you@mercbot.localhost` opens `/open` with the key from the copy's data
folder, so it needs no development sign-in settings and reaches nothing a browser without the key could.

The Stack's memory estimates are initial development planning hints for the
Node application and workspace setup, not measured requirements or memory limits.
They exclude the separately provided database server.

## Check changes

```sh
npm run verify
npm run test:database
npm exec --no -- playwright install chromium
npm run test:e2e
```

Test files run in parallel, as many at a time as the machine's test budget allows: `V64_TEST_CONCURRENCY` when the
test runner sets it, otherwise half of the CPUs. The node test suites run through JSKIT's `jskit test`, and the
Playwright and Vitest configs take their workers from `testConcurrency()` of `@jskit-ai/jskit-catalog/test-budget`.

The database and browser tests never write to `TEST_DB_NAME` itself. A run prepares a template beside it
(`<TEST_DB_NAME>_tpl`): migrated and seeded with three test users once, and rebuilt only when a migration or the seed
changes. Each test file and each browser worker then gets its own copy (`CREATE DATABASE … TEMPLATE`), dropped when
the run ends, so files never see each other's rows. The database user needs `CREATEDB`, which Vibe64's development
databases have. Set `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` and `TEST_DB_NAME`, in the environment or `.env`.
A test that connects refuses unless `DB_NAME` is `TEST_DB_NAME` (`tests/support/testDatabase.mjs`), so a file run with
the development `.env` never migrates or writes the development database.

`npm run test:e2e` starts a Test Preview per worker (`tests/e2e/globalSetup.mjs`), each on its own copy of a
database with the fixtures made (once a run, while the app builds), a port the system picks (or `PLAYWRIGHT_PORT`
and the next ones, when set) and its own data folder in a temporary folder outside the source tree, opened with the
key in that folder as its one person, as `mercbot open` opens a copy (`tools/preview-identity`). One that stops during the
run, crashed or killed, says so in the suite's output, with its pid, its exit code or signal and its log's end, and its
log is kept in `test-results/test-preview-<worker>.log` (`tests/support/testPreviewWatch.mjs`). A Test Preview clears every
credential-shaped variable (`*_API_KEY`, `*_CLIENT_ID`, `*_CLIENT_SECRET`, `*_TOKEN` and the like), mail and the hub
address, so no real model, mail or sign-in key reaches it; only a payment provider's test-mode key (`sk_test_…`,
`rk_test_…`) stays, since it can't move money (D-116). Every kind of AI is Mercbot's stand-in model
(`tools/standInModel.mjs`, D-83), served on a local port, so nothing a Test Preview asks of its AI reaches a
provider: each kind names its provider, with no key. A Preview (`npm run develop`) does the same but keeps its AI keys
(D-118): a kind of AI with its key in .env uses its provider, so its bots work for real; a kind without one is the
stand-in. A test-mode payment key lets payments be tried there. Vibe64's managed run
(`vibe64-helper playwright --target test-app`) uses its one Test Preview instead, one spec at a time.

Every suite has coarse time bounds, about five times what the test machines measure when busy, so only something
clearly broken trips them: a hang, a process that stays alive after its tests, minutes where seconds are normal. A test
file still running at its bound is stopped, and a node suite whose files' times summed are past its own bound fails
(`tests/support/unitRun.mjs`, `tests/support/databaseRun.mjs`): the work they did, which doesn't depend on how many
files the machine's test budget runs at once, as the suite's wall time does. Playwright has its `timeout` and
`globalTimeout`. Fix what got slow rather than raise a bound. Every run prints its ten slowest files against the bound.

JSKIT's local auth confirms the email of every account registered by password. Database tests that register accounts
on a server without the single-user gate expect them signed in at once, so they set
`AUTH_LOCAL_EMAIL_CONFIRMATION=false` themselves. In staging and production (`APP_ENV`, D-87) Mercbot leaves
confirmation off unless that setting says otherwise (`resolveRuntimeEnv`): nobody registers on a person's own copy, and JSKIT would
otherwise want a confirmation sender (`auth.local.confirmation-sender`), which Mercbot doesn't have.

### Database integration check

`npm run test:database` runs the database tests, each file on its own copy of
the test template (above). Its account check verifies the selected database,
prepares it twice, and tests registration, profile updates, login after a
server restart, rejected anonymous reads, and separate account profiles through
the real server. An empty `DB_PASSWORD` is allowed. The server smoke test (health, the
anonymous session, app logos, signed-out bot routes) runs there too: a server
reads its database as it starts, since JSKIT's local auth checks whether the
app has an account yet.

Mercbot follows the published JSKIT shell foundation and package-owned source patterns. Add capabilities through
JSKIT public APIs.

## Keep dependencies current

`npm ci` installs the reviewed versions in `package-lock.json`. To move all
root and workspace JSKIT dependencies to the latest coordinated release, run
`npm run jskit:update`, then `npm run jskit:check`. Review `npm outdated` for
other dependencies, update their declarations deliberately, and commit both
the manifests and lockfile after checking the application.

Pinia 4 and its required `@vue/devtools-api` peer are declared together.
Keep them compatible with the coordinated JSKIT shell and authentication
packages; do not bypass peer conflicts with npm overrides or force flags.

Dependency updates do not refresh copied application source. Compare changed
framework patterns with the application's bootstrap, routes, and tests when
upgrading. Check server and client behavior, production builds, and browser
navigation before publishing.

## Licence

Mercbot is free software: you can redistribute it and/or modify it under the terms of the GNU Affero
General Public License, version 3 only (`AGPL-3.0-only`), as published by the Free Software
Foundation. It comes with no warranty. The full text is in [LICENSE](LICENSE).

The AGPL also covers people who use Mercbot over a network: if you run a changed copy as a service,
you must offer its users the source of your version. The licence grants no rights to the Mercbot name
or logo as trademarks; a fork needs a name of its own.
