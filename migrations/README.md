# Application migrations

Mercbot's own Knex migrations. JSKIT package migrations are discovered separately by `npm run db:prepare`.

`20261113120000_baseline.cjs` creates the whole schema at once. Add each later change as a new forward migration
after it, and never edit one that has run. A database migrated before the baseline can't be migrated any further:
recreate it empty and run `npm run db:prepare`.
