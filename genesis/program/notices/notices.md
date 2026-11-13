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
own listeners for that topic and key, reconnecting after two seconds if the
connection drops. Notices only say what changed, such as a bot starting a
routine run (`bots`, keyed by person), a computer changing state (`computer`,
keyed by bot) or a home's tables changing (`apps-data`, keyed by home); listeners
read the state itself from the database. `publishIn(transaction, topic, key, event)`
sends one as part of a transaction, so it goes out only if that commits.
