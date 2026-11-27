# Permissions in a home

Every member sees every app and view (D-66) and changes every table, unless an owner or admin made the table private
(D-138, data.md). Owners and admins otherwise only choose the home's settings. Public apps are the boundary to the
outside.

## Sources

- Main: `packages/apps/src/server/registerRoutes.js`
- `packages/apps/src/server/apps.js`
- `packages/apps/src/server/views.js`
- `packages/apps/src/server/dataGate.js`
- `src/components/apps/AppDetailsPanel.vue`
- `src/components/apps/ViewActions.vue`
- `migrations/20261113120000_baseline.cjs`

## Public contract

- Every member of a home lists, opens and uses every app and view; an app's routes answer 404
  only when the home has no such app. Every bot sees every view (`view_list`, `view_get`, search).
- Every member reads, creates, changes, marks obsolete, restores and imports into every table that isn't private
  (D-138: owners, admins and chosen people only; data.md); every change is audited with who made it.
- Anyone in the home may retire a view or bring it back. Only the Builder changes a view an app
  shows, so apps don't break.
- Owners and admins (`workspace.settings.update`) choose the Builder, make an app public, set the
  home's and an app's look, switch scripts off and on, choose the web addresses scripts may call,
  and install templates; and (since 2026-11-27) the home's time zone for apps, what an app sends by itself (D-137,
  sending.md) and who can see and change each table (D-138). On a public app they alone narrow visitor access at once and publish or
  restore a version that lets visitors reach more (D-66, `public.md`); everyone sees the list.
- No answer carries `access`, `writers` or `editors`. The access, share, writers and apps-people
  routes are gone, and there are no `app_members` or `app_table_editors` tables (D-78); the `apps.access` and
  `app_tables.writers` columns stay, named by no table resource and read by no server, until the
  next release drops them.

## Proved by

- `tests/server/appsPermissions.integration.js`
- `tests/server/appsMemberRoutes.test.js`
- `tests/server/oldPermissionColumns.integration.js`
- `tests/server/appsPrivateTables.integration.js`
