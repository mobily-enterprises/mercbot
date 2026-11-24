# Runtime readiness and database preparation

This boundary supplies the operational entrypoints needed to prepare and run
the application.

## Sources

- `package.json`
- `scripts/prepare-database.js`
- `knexfile.js`
- Main: `server.js`
- `server/lib/runtimeEnv.js`
- `bin/server.js`
- `bin/develop.js`
- `server/lib/develop.js`
- `scripts/serve.sh`
- `docs/deployment.md`

## Public contract

Database preparation applies every pending application and installed-package
migration using the configured PostgreSQL connection. The application starts on
port 3001 by default, serves the browser application, and exposes a health
response for readiness checks. The built files under `/assets/` carry their
content's hash in their names and are sent as immutable for a year, so a browser
asks for them once; the page itself is sent fresh on every load. A start that
finds no built page (none yet, or a build emptying `dist` at that moment) serves
the API without pages. Missing or invalid database configuration stops startup
or preparation with an error instead of guessing credentials.

The server starts only when `APP_ENV` says where it runs (D-87): `resolveRuntimeEnv` asks JSKIT's
`assertAppEnvironment` first, so a start without it, with `SIDE_EFFECTS` set, or in staging or production without
`NODE_ENV=production` stops, naming the fix. In staging and production the server refuses an `APP_PUBLIC_URL` that
isn't https (D-65), unless it's an http one on
`localhost`, `127.0.0.1` or `[::1]` while it listens at `HOST` `127.0.0.1` or `::1`; without one it starts, and links
point at `http://localhost`. No key stops the start: each turns its feature on, and the server logs one line at start
for each one missing (`packages/account/src/server/keys.js`). In staging and production `AUTH_LOCAL_EMAIL_CONFIRMATION` is
`false` unless set (`resolveRuntimeEnv`): nobody registers, and JSKIT's confirmation links, which Mercbot has no sender for,
would otherwise stop the start. Bots' files are in the files bucket only with all of its settings and
`MERCBOT_FILES_PASSPHRASE` (D-91); with any missing they stay in the files folder, and the start names each one. Once
the server listens it sends what changed in its working copy every 5 seconds, and it sends the rest as it stops.
The server believes `X-Forwarded-For` only from the proxies `TRUSTED_PROXIES` names (`trustedProxies`, JSKIT's
`resolveTrustedProxies`; a proxy on this computer without it), so behind a load balancer each visitor keeps their own
address for the sign-in limits, and a value that would believe anyone stops the start. `npm run develop` (`bin/develop.js`, `server/lib/develop.js`), the Preview, runs with
`APP_ENV=development` whatever `.env` says, empties every credential-shaped setting, and every live payment key whatever its name, but a payment provider's test-mode
key (`sk_test_…`, `rk_test_…`, which can't move money, D-116) and the AI keys (`aiKeysOf`, D-118), so its bots use
their providers; a kind of AI without a key runs on the stand-in model (`tools/previewAi.mjs`, D-83). No other
outside service gets a key from a Preview, and payments can be tried there. It starts only on loopback and its HTTP server is the single-user gate
(`genesis/program/single-user/single-user.md`), unless a copy built on Mercbot that serves many people passes
`gate: false` to `serve`, `startServer` or `develop`. `serve` and `startServer` also take the server's `role` (D-131), and a
start without one, or with one there isn't, stops, naming them: `"web"` serves the pages and the API and runs every
loop that claims the servers' shared work, and `"computers"`, for a copy that runs bots' computers on servers of
their own (D-85), answers only its health, the work other servers pass to its computers and its own rclone's Drive
keys, a 404 for everything else, and runs none of those loops. `bin/server.js` and `develop` start web servers. `npm start` and the Procfile go through
`scripts/serve.sh`, so no start skips the hosting script's checks; `HOSTING_SCRIPT=scripts/hosting/local.sh` is a
person's own computer's, whose refusals name the command that fixes each, and `scripts/hosting/store.sh` a host's whose
programs come from a read-only Nix store, where `serve.sh` first makes the bots' toolbox from the store
(`MERCBOT_TOOLBOX_STORE`, `MERCBOT_TOOLBOX_DIR`, D-86; with `MERCBOT_TOOLBOX_LIBRARIES` and `MERCBOT_TOOLBOX_MESA`
for the downloaded programs, D-89; `files/shell.md`).

`bin/server.js` runs `server.js`'s `serve`, and `bin/develop.js` runs `develop`;
a copy built on Mercbot puts its own two in their place to give its options.
`serve` drains on SIGTERM or SIGINT (D-19). It closes the app: live streams and
screens close so pages reconnect elsewhere, and computers save their browsers
while requests in progress finish (`serveComputers`, before Fastify waits for the
server's connections, since the browsers' own come in through it, D-68). Then every
feature's shutdown runs: the bots hand over at once every routine and watch run, app
task, connect follow-up and person's reply still running (each stops at its next step,
a model call there and then, keeps its steps and ends its lease or marks its run stale,
`runLease.js` `handOverRuns`), and tell every server through a notice (`routines`,
`apps-jobs`, `connect-follow-ups`, `replies`), whose runners claim them straight away;
one that doesn't stop within 5 seconds keeps its lease, which lapses by itself. The rest
of the background work gets up to 20 seconds. It exits after at most 25 seconds. `docs/deployment.md` lists what a
deployment of disposable servers needs.

