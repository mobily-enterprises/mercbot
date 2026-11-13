# Views

Live figures from a home's tables, between a page and an app: a one-screen, read-only app definition
any bot saves at once, which apps can share or copy (D-55, `docs/views-design.md`).

## Sources

- Main: `packages/apps/src/server/views.js`
- `packages/apps/src/shared/check.js`
- `packages/apps/src/shared/definitions.js`
- `migrations/20261113120000_baseline.cjs`
- `src/components/apps/AppViewBody.vue`
- `src/components/apps/AppViewPart.vue`
- `src/components/apps/ViewSurface.vue`
- `src/components/apps/ViewActions.vue`
- `src/components/apps/MercbotViewCard.vue`
- `src/components/apps/MercbotViewViewer.vue`
- `src/components/apps/askInChat.js`
- `src/components/apps/useLiveData.js`
- `tests/server/views.test.js`
- `tests/server/views.integration.js`
- `tests/server/viewsRealUse.integration.js`
- `tests/support/viewsFixture.mjs`
- `tests/e2e/views.spec.ts`

## Public contract

- A view is an `apps` row with `kind = 'view'`, one screen `main` and no draft. `save` checks it with
  `checkView` (only text, chip, spacer, row, grid, tabs, input, table without clicks, field, totals and
  chart; no scripts), makes the next live version, runs every query once and says which apps hold a
  copy. Field renames, removals, versions and pins work as for an app.
- Who sees it: everyone in the home and every bot, from the moment it's saved, whichever chat made it (D-66).
- People's routes, under `/api/w/:workspaceSlug/apps/:slug`: `POST restore`, `POST retire` (anyone in the home;
  D-62: the row, versions and key stay, and it leaves lists, search, pins and the save check), and for
  retired ones `GET /apps/retired` and `POST /apps/retired/:slug/bring-back` (anyone in the home; a name another
  app or view now has becomes the next free "Name (2)"). While an
  app shares a view, only the Builder changes it, it can't be retired and its params can't change.
  `POST action` always refuses; a draft, Publish, Make public, scripts and app rooms refuse a view.
- In an app's screen, `{ type: "view", view, params }` shows the view's current version (stored by id, shown
  by key), read through `GET /apps/:slug/part`: the view's screen, tables and style only. With `copy: true`, saving turns it into `{ type: "view", screen, params }` and a read-only screen
  `view-<key>` with `copiedFrom { view, version }`. `GET /apps/:slug` lists `copyUpdates` when an original has
  a newer version; `POST copies/:screen/update` puts it in the draft. View parts stay out of table rows,
  forms and public screens, at most 6 a screen. A view part runs its own screen runtime (`AppViewBody.vue`), whose
  reads stop with the app screen's and when it goes; in a draft, a copy reads the practice data (D-71).
- Live: both write paths of the data gate call `publishIn(transaction, "apps-data", home, { tables })`, delivered
  on commit and dropped on rollback, identical ones once. `GET /api/w/:workspaceSlug/apps-events` relays it as
  server-sent `data` events, ends with its page (even one gone before the stream started) and closes on shutdown. `useLiveData` keeps one stream per page, re-reads the
  queries on changed tables and their link targets after a second, only while seen, and everything on
  window focus and after a reconnect.
