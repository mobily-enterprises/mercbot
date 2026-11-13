# Public screens and visitor access

An app's screens may be public, for people without a Mercbot account, within the app's visitor access (D-35, owner
2026-10-29; D-66, D-67). Mercbot keeps the grammar, the save check, which app is public and the fence around a home's
records; it serves no visitors itself: a copy built on Mercbot that does adds their routes, sign-in and spam checks on
the `mercbot.apps` capability, and its part of an app's Overview through `appParts` (extensions.js).

## Sources

- Main: `packages/apps/src/server/visitorAccess.js`
- `packages/apps/src/shared/visitorAccess.js`
- `tests/server/appsVisitorAccess.integration.js`
- `migrations/20261113120000_baseline.cjs`
- `tests/server/appsVisitorAccessChanges.integration.js`
- `packages/apps/src/server/runtime.js`
- `packages/apps/src/server/apps.js`
- `packages/apps/src/server/appVisitorAccess.js`
- `packages/apps/src/shared/check.js`
- `src/components/apps/AppDetailsPanel.vue`
- `src/components/mercbot/extensions.js`

## Public contract

- Which app is public: `apps.setPublic(actor, app, on, options)`, an owner's or admin's choice whose caller checks
  that, needs the published version to have `public.home` (409 `apps_public_screen_missing`), stamps `publicAt`
  and audits it; turning it off stops it at once. `apps.findPublic(slug, options)` answers the home's app at that
  address while it is public, else null. Neither has a route here.
- Visitor access (D-66), `public.tables.<table>`: `can` list | get | create | update | delete;
  `rows` all | own | a formula over the table and `visitor`; `owner` (an email field); `read`
  (fields visitors receive, filter, sort, group or sum by); `write` (fields their requests write,
  presets included, never the owner). Anything unlisted is refused; update and delete need rows
  own, and own needs `signIn: "required"`. The save check refuses unknown settings and public
  screens that use anything unlisted, hand tasks to bots or mark records obsolete. It refuses the
  earlier rules (`read`, `owner`, `create`, `update`, no `can`), naming the settings to list.
- Versions on the earlier rules are compiled in memory into lists of what their public screens use
  (`listedAccess`: `can` from the rules, `rows` from the read rule, `read` what the screens show, filter,
  sort, group or sum by plus the owner and title, `write` the forms' fields and presets, a linked table
  for its title alone with `rows: all`), and restoring one stores it listed (`listedStored`).
- An app's visitor access for its Overview: `apps.visitorAccess(app, options)` lists it by table, with `attention`,
  the public screens' data scripts, while the newest version a person made live is still one of kind `upgrade`;
  `apps.narrowVisitorAccess(actor, app, { <table>: { can, read, write } }, options)`, an owner's or admin's choice
  whose caller checks that, intersects it with the live list (rows and owner stay; a table left out is unlisted) in
  a new live version, kind `narrowing`, whose draft loses the same. Neither has a route here. On a public app,
  publishing or restoring a version that reaches more (a new table, operation, read or write field, owner, or rows
  other than from `all`) needs an owner or admin: 403 `apps_visitor_access_widening`, naming what it would add.
- The fence (`server/visitorAccess.js`): the visitor's ctx carries `access`, compiled from the live
  version by whoever makes a visitor's context; the data gate checks every call against it (rows ANDed into the SQL
  filter, records projected to readable fields, links reaching only the linked table's rows: a
  label only for a readable title, a group's name or a link a visitor writes likewise, writes held
  to `write` and giving back readable fields, changes to the visitor's own records, restore, count,
  history, import and activity refused) and refuses a visitor's ctx without it. Data scripts on
  public screens run with it; rules on saving run as the home. A visitor's new record gets their
  email as owner; edits keep it. A table listed for link labels alone is `can: []` with its rows
  and title; the earlier rules' links get `rows: all`, as they had. A calculated field in `read` (D-78)
  counts only while every field its formula now uses is in `read` too (`visitorReads`): the fence,
  describe's tables and the Overview go by it, since a formula can change after publishing and a
  narrowing isn't checked.
- The visitors' own tables (sessions, codes, sign-ins, allow lists, form counts) aren't Mercbot's: a copy
  that serves visitors keeps its own.
