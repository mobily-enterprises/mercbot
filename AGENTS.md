# App Agent Instructions

Use current project context, JSKIT public APIs, and the official framework
documentation as the source of truth for application work.

Framework references:

- `https://mobily-enterprises.github.io/jskit-ai/guide/`
- `https://mobily-enterprises.github.io/jskit-ai/patterns/`

Before implementation, read the narrow relevant source pattern completely. If
its owner package is installed, prefer that version-matched package-owned copy.
Do not install an unrelated runtime package only to read documentation.

Pages start with useful content and actions. Do not add a page header, welcome
heading, or standalone title unless the user asks for one.

Copied pattern source is ordinary application source. Do not add generator
provenance, receipts, completion ledgers, or tooling-operation history. Keep
changes scoped to the user request and verify runtime behavior directly.

## What Mercbot is

Mercbot is a person's own copy of a set of AI helpers ("bots") that do real work for them. A home's bots are its
members, as its people are, and people talk to them in chats, Public or Private, where each bot has its own computer
and command line (D-112); the person reaches the copy with its key (D-81). `genesis/blueprint.md` and
the Program describe what it does; `help/` is what people read.

## Decisions

Design decisions are numbered and dated in [docs/decisions.md](docs/decisions.md), and code cites them as `D-N`.
Record a new decision there, with its date and reasons, when a change settles a question the code alone doesn't
answer. Numbers never change; a later decision that changes an earlier one says so in both.

## Practical rules

- **Database:** PostgreSQL through JSKIT. This is JSKIT's first real use with
  PostgreSQL, so expect bugs.
- **JSKIT bugs:** patch the installed package in `node_modules` directly and
  keep a copy of every patch in `patches/` so it can be reapplied after
  `node_modules` is rebuilt, including after `npm ci` in deployment. Don't
  connect the jskit-ai repository.
- **Env:** the development database and the six AI settings (`AI_PREMIUM_PROVIDER`
  and `AI_PREMIUM_API_KEY`, and the same for `ECONOMY` and `IMAGES`, D-72) come
  from Development Env. A missing key never stops Mercbot starting: its feature
  is off and says so (`packages/account/src/server/keys.js`). Never print or
  commit their values.
- **Several servers (D-15):** Mercbot is a standard Node application with a
  PostgreSQL database, and it must run as several servers behind a proxy. The
  servers may have extra system software (Xvfb, openbox, x11vnc, Chrome), but
  the server process itself must never assume it is the only one. Shared state
  lives in PostgreSQL, not in process memory or on local disk. Work that must
  happen once, such as a routine run, is claimed through the database. News
  for open pages travels between servers through PostgreSQL notifications.
  Machines are disposable (D-19): nothing a person needs may live only on one
  machine's disk or in its memory, and a server must drain on SIGTERM. Anything
  still single-server must be listed in D-15 or D-19 and fixed.
- **Tests:** JSKIT's test rules apply ([Test files run in parallel](https://mobily-enterprises.github.io/jskit-ai/guide/framework/typed-features#test-files-run-in-parallel),
  [Test databases are prepared once](https://mobily-enterprises.github.io/jskit-ai/guide/framework/typed-features#test-databases-are-prepared-once), the
  [speed pass](https://mobily-enterprises.github.io/jskit-ai/guide/framework/speed-pass)); README's "Check changes" says how Mercbot's suites apply them. While
  working, run only the files a change touches (`npm run test:files -- <files>`, `npx vitest run <file>`,
  `npx playwright test <spec>`); the whole suite (`npm run verify`, the Stack's Verification) runs once, at the end.
  Each database test file and browser worker gets its own copy of a template migrated once
  (`tests/support/testDatabase.mjs`), so no test migrates. Tests never reach a real outside service: AI, mail, sign-in
  providers, Google Drive and Sedna are the stand-ins in `tests/support/` and `tools/standInModel.mjs`, and a server
  or feature a test starts gets `testServerEnv()` (`tests/support/testEnv.mjs`) with the settings the test sets, never
  the test process's whole environment, where `.env` or a session's Development Env may hold real keys. A stand-in
  only answers; the rule under test is Mercbot's, so assert what Mercbot did. The stand-ins and the seeded data are
  deterministic: check the exact value, text or count, never a bound or one word of it. A test's title is the one
  behaviour it proves; a decision with several rules gets a test for each. A wait the product owns (a poll, a reconnect
  pause, a lease, today's date) is an option the test sets short or a clock it moves (`createNotices({ reconnectMs })`,
  `createFilesVolume({ now })`), never waited out in real time.
- **Architecture:** the design is in [docs/architecture.md](docs/architecture.md)
  (D-6). Don't assume a design beyond it; ask when a change needs one.
- **Migrations:** `migrations/` starts from one baseline that creates the whole
  schema. Add each later change as a new forward migration; never edit one that
  has run. A migration after the baseline only adds, unless it says why it may
  take away (`exports.contracts`), as version 0's `20261122120000_chats_core.cjs`
  does (D-112: nothing in any database was kept). A database made before the baseline can't be migrated: recreate it
  (`npm run db:prepare` on an empty database).
