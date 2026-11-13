# Permissions in a home

Nothing inside a home is private (D-66): every member sees every app and view and changes every
table. Owners and admins only choose the home's settings. Public apps are the only boundary.

## Sources

- Main: `packages/apps/src/server/registerRoutes.js`
- `packages/apps/src/server/apps.js`
- `packages/apps/src/server/views.js`
- `packages/apps/src/server/dataGate.js`
- `src/components/apps/AppDetailsPanel.vue`
- `src/components/apps/ViewActions.vue`
- `tests/server/appsPermissions.integration.js`
- `tests/server/appsMemberRoutes.test.js`
- `tests/server/oldPermissionColumns.integration.js`
- `migrations/20261113120000_baseline.cjs`
- `tests/e2e/apps-member.spec.ts`

## Public contract

- Every member of a home lists, opens and uses every app and view; an app's routes answer 404
  only when the home has no such app. Every bot sees every view (`view_list`, `view_get`, search).
- Every member reads, creates, changes, marks obsolete, restores and imports into every table;
  every change is audited with who made it.
- Anyone in the home may retire a view or bring it back. Only the Builder changes a view an app
  shows, so apps don't break.
- Owners and admins (`workspace.settings.update`) choose the Builder, make an app public, set the
  home's and an app's look, switch scripts off and on, choose the web addresses scripts may call,
  and install templates. On a public app they alone narrow visitor access at once and publish or
  restore a version that lets visitors reach more (D-66, `public.md`); everyone sees the list.
- No answer carries `access`, `writers` or `editors`. The access, share, writers and apps-people
  routes are gone, and there are no `app_members` or `app_table_editors` tables (D-78); the `apps.access` and
  `app_tables.writers` columns stay, named by no table resource and read by no server, until the
  next release drops them.
