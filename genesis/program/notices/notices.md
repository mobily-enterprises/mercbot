# Notices between servers

Carries small "something changed" notices between Mercbot servers, so a page
open on one server hears about work done on another (D-15).

## Sources

- Main: `packages/notices/src/server/NoticesFeature.js`
- `packages/notices/src/server/notices.js`
- `packages/notices/src/server/publishIn.js`
- `packages/notices/src/server/types.js`
- `packages/notices/package.json`

## Public contract

The `mercbot.notices` capability gives `publish(topic, key, event)` and
`subscribe(topic, key, listener)`, which returns an unsubscribe function. A
notice goes out with PostgreSQL `pg_notify` on the `mercbot_notices` channel;
each server keeps one connection listening on it and hands each notice to its
own listeners for that topic and key. Notices only say what changed, such as a
bot starting a routine run (`bots`, keyed by person), a computer changing state
(`computer`, keyed by bot) or a home's tables changing (`apps-data`, keyed by
home); listeners read the state itself from the database.
`publishIn(transaction, topic, key, event)` sends one as part of a transaction,
so it goes out only if that commits.

## Keeping the connection listening

The listening connection is kept alive at the TCP level. Because keep-alive
alone can take minutes to notice a network path that dropped without closing,
each server also sends itself a private heartbeat notice every 30 seconds
(`heartbeatMs`); one not heard back within 10 seconds (`heartbeatTimeoutMs`)
means the connection went quiet, and it is ended. A heartbeat that can't be
sent says nothing about the connection and changes nothing.

There is one listen loop at a time: whatever ends the connection (an unheard
heartbeat, an error, its end, or all of them together) starts a single
reconnect, two seconds later. `close()` stops every timer and ends the
connection, and nothing connects again after it, even if an end arrives later.

Notices published while no connection listened are lost, so after any
reconnect (not the first connect) the capability tells whoever asked through
`onMissed(listener)`, which returns an unsubscribe function. The bots' event
stream (`GET /api/w/:workspaceSlug/bot-events`) then ends every page's open
stream; each page connects again and, as on any reconnect, reads its chats and
bots again to catch up.
