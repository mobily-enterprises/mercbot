# A person's own copy, opened with its key

Mercbot is a person's own copy, on their own computer (D-81): one person, no sign-in, registration, invitations or
members' changes, opened with a secret key as Jupyter does, and reached only from that computer. There is no setting
for it: every start is behind the single-user gate, unless a copy built on Mercbot that serves many people starts its
server with `gate: false` (`server.js`) and leaves this package out.

## Sources

- Main: `packages/single-user/src/server/SingleUserFeature.js`
- `packages/single-user/src/server/gate.js`
- `packages/single-user/src/server/key.js`
- `packages/single-user/src/server/previewIdentity.js`
- `packages/single-user/package.json`
- `packages/account/src/server/thisCopy.js`
- `tools/preview-identity`
- `vite.config.mjs`
- `scripts/mercbot`

## Public contract

Mercbot refuses to start unless `HOST` is `127.0.0.1` or `::1`. Its first start makes the key
(`<MERCBOT_DATA_DIR>/mercbot.key`, 64 hex characters, mode 600) and the one person, `you@mercbot.localhost`, who
runs the copy (`mercbot.copy-runners`, which this package provides); a key file others may read, or one holding no key,
stops the start. Its HTTP server checks every
request and websocket upgrade before Fastify or any other listener sees it: a Host other than `localhost`,
`127.0.0.1` or `[::1]` on the server's port gets 421; the health check, other servers' and the bots' own keyed routes,
pages' sealed frames (`/api/pages/<signed token>/…`, credentialless) and Connect apps' OAuth callback pass; `/open?key=<key>` signs the person in, sets the HttpOnly, SameSite=Strict
`mercbot_key` cookie and moves to `/` from its own page; a change or websocket whose Origin isn't
`http://<Host>` gets 403; anything else without the key's cookie gets 401 and a page saying "Open Mercbot with
`mercbot open`"; sign-in, registration, sign-out, passwords, security settings, invitations and members' changes get
404. The person is signed in with JSKIT's own sessions, again whenever the key's cookie comes without one. Their
password is derived from the key, so a restart with a new key changes it and ends every session of the old one. The
browser has no Sign out, Add another account or Settings → Home; a copy built on Mercbot adds them (`extensions.js`).

`scripts/mercbot` is the person's command: `start` and `stop` (a systemd user service running `scripts/serve.sh`),
`status`, `open` (a mode-600 page that takes the browser to `/open` with the key, so it's on no command line),
`new-key` (a new key, and a restart if running), `backup` (the database, the data folder and the settings in one
mode-600 archive), `restore` (with the backup's release when it's still kept, keeping this computer's database
settings and what was there beside) and `upgrade` (a release archive prepared beside the running one, a backup, the
migration, the switch; a failed migration puts the database back and the release before runs on). Its settings are
`NAME=value` lines that are read, never run.

Vibe64's Preview opens the copy the same way (`tools/preview-identity`, the Stack's Preview identity): signing in as
`you@mercbot.localhost` opens `/open` with the key from the copy's data folder (the one the command is given, the
Test Preview's `.data-test`, else `MERCBOT_DATA_DIR`, else `.data`) and hands the browser the cookies it set; anyone
else is refused (`mercbot_one_person`); signing out expires the key's cookie. In development (`bin/develop.js`) Vite
serves the pages and hands `/open`, the API and Socket.IO to the server behind it, passing a request from its own page
on as from the server's own address, so the gate checks it as it does in production.
