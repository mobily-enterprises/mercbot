# Application migrations

Mercbot's own Knex migrations. JSKIT package migrations are discovered separately by `npm run db:prepare`.

`20261113120000_baseline.cjs` creates the whole schema at once. Add each later change as a new forward migration
after it, and never edit one that has run. A database migrated before the baseline can't be migrated any further:
recreate it empty and run `npm run db:prepare`.

Every migration after the baseline only adds (expand): a copy on several servers is updated one server at a time, so
the release before still runs on the same database while a migration runs. Take something away (drop, rename, delete
rows) only in a later release, once no server runs code that reads it, with `exports.contracts` saying why it may;
`tests/server/migrationsExpandOnly.test.js` refuses a migration that takes away without it.
