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

In production the server refuses an `APP_PUBLIC_URL` that isn't https (D-65), unless it's an http one on
`localhost`, `127.0.0.1` or `[::1]` while it listens at `HOST` `127.0.0.1` or `::1`; without one it starts, and links
point at `http://localhost`. No key stops the start: each turns its feature on, and the server logs one line at start
for each one missing (`packages/account/src/server/keys.js`). In production `AUTH_LOCAL_EMAIL_CONFIRMATION` is `false`
unless set (`resolveRuntimeEnv`): nobody registers, and JSKIT's confirmation links, which Mercbot has no sender for,
would otherwise stop the start. `scripts/serve.sh` leaves the files volume off, saying so, when `MERCBOT_FILES_DIR` is set
without `MERCBOT_FILES_PASSPHRASE`. `npm run develop` (`bin/develop.js`, `server/lib/develop.js`), the Preview, empties
every credential-shaped setting and runs on the stand-in model (`tools/previewAi.mjs`, D-83), so a Preview reaches no
outside service. It starts only on loopback and its HTTP server is the single-user gate
(`genesis/program/single-user/single-user.md`), unless a copy built on Mercbot that serves many people passes
`gate: false` to `serve`, `startServer` or `develop`. `npm start` and the Procfile go through
`scripts/serve.sh`, so no start skips the hosting script's checks; `HOSTING_SCRIPT=scripts/hosting/local.sh` is a
person's own computer's, whose refusals name the command that fixes each.

`bin/server.js` runs `server.js`'s `serve`, and `bin/develop.js` runs `develop`;
a copy built on Mercbot puts its own two in their place to give its options.
`serve` drains on SIGTERM or SIGINT (D-19). It closes the app: live streams and
screens close so pages reconnect elsewhere, and computers save their browsers
while requests in progress finish (`serveComputers`, before Fastify waits for the
server's connections, since the browsers' own come in through it, D-68). Then every
feature's shutdown runs: bots finish routine runs and background work (up to 20
seconds). It exits after at most 25 seconds. `docs/deployment.md` lists what a
deployment of disposable servers needs.

