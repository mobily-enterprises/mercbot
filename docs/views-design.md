# Views: live data pages between pages and apps

**Status: approved on 2026-11-06 (D-55).** A phase-2 feature (D-18). Checked against the code at `4e792ae`.

## What a view is

A view is a one-screen, read-only app definition that any bot can save at once. It's always live,
because it holds questions about the home's tables and never a copy of the answers.

- **Parts:** text, chip, spacer, row, grid, tabs, input, table (no `onRowClick` or `rowActions`),
  field, totals and chart. No forms, buttons, dialogs, steps, navigation or scripts.
- **The bot writes** `params`, `state`, `data`, `content` and an optional `style`. They're stored
  as an app with one screen, `main`, so every existing app feature can read them.

```json
{
  "data": {
    "byStage": { "from": "deals", "where": "=status != \"Won\"", "groupBy": "stage", "sum": "value", "grandTotal": true },
    "biggest": { "from": "deals", "where": "=status != \"Won\"", "sort": "-value", "limit": 10 }
  },
  "content": [
    { "type": "chart", "label": "Open deals by stage", "kind": "pie", "rows": "=data.byStage", "measure": "total" },
    { "type": "table", "rows": "=data.biggest", "columns": [
      { "label": "Deal", "value": "=row.name" }, { "label": "Value", "value": "=row.value" }
    ] }
  ]
}
```

**Two small additions to queries, which apps get too.** Screens can't do "the ten biggest" or "add
the total" today, and both are in the acceptance checks:
- `limit` on a list (1–100). Lists always return up to 100 now, and the save check silently ignores
  unknown query settings.
- `grandTotal` on a totals query: totals and chart parts also show one Total line. It's worked out
  on the server, because groups stop at 100.

## Storage: an `apps` row with `kind = 'view'`

A migration adds `apps.kind` (`app` or `view`), `made_by_user_id` and `made_by_bot_id`.

**Free, with no change:** `app_versions`, restore, versions, ids and names (`toIds`/`toNames`),
`fieldUses`/`removeField` and its impact dialog, `tablesUsed`, `canUse`/`usable`, `app_members`, pins,
`runtime.query`, the query route and the frame at `/w/<home>/apps/<slug>`.

**What needs `kind`, twelve places, most of them one line:**
- **Server, eight:** `list` returns `kind`; `apps_overview` leaves views out; `saveDraft`, `publish`,
  `setPublic`, saving a script and app rooms (`botSettings.js`) refuse a view; `runtime.action`
  refuses every call.
- **Client, four:** the `AppsHome` grid (View badge and filter, no draft actions), `AppFrame` (no draft
  banner or Point and ask; Ask Builder becomes Ask <bot>), `AppDetailsPanel` (no Public or Scripts),
  and the card and viewer below.

Separate `app_views` tables would mean copying versions, restore, access, pins, the removal rewrite
and the routes. The filter stays small, so the column wins.

Each save is the next live version, through `addVersion`, with no draft. The key is the slug: set when
the view is made and never changed. The title (`name`) can change.

## Data access and permissions

*Replaced by D-66 (2026-11-07): every view is the home's from the moment it's saved, there is no
sharing and no "Only me", and anyone in the home may retire a view or bring it back. The share route
is gone. Only the Builder may still change a view an app shows. The rest of this section is the
original design.*

- Queries run through the data gate on the existing route, `POST …/apps/:slug/query`. Members can
  already read every table, so a view never shows more than the Data tab.
- **Who sees it:** `access = members` with only the maker, until shared, then `home`. Owners and
  admins always can. A view made in a shared room, a group, or a job with no person starts home-wide.
  Everyone else gets 404 from every route, as with apps.
- **Sharing needs a new route.** `PUT …/apps/:slug/access` is owners and admins only, so a member
  couldn't share their own view. `PUT …/apps/:slug/share {home}` works on views only: anyone who can
  see a view may share it; only its maker, an owner or an admin may make it private again.
- **In use:** a view used by an app can't be made private or retired (D-62). The refusal names the apps.
- No public views: `setPublic` refuses them, and public screens can't hold a view part.

## AI tools and guidance

For every bot, in `appTools.js`:
- `view_save { view?, title, summary, icon?, definition }` makes or updates a view. Errors come back
  with their place and a suggestion. On success it runs every query once (as `screensThatFail` does
  for the Builder), saves the version and posts one `view` card per reply.
- `view_list` lists what the person can see. `view_get { view }` returns a definition by names.
- No tool shares, restores or deletes. `view_save` is added to `APP_ACTIONS`, so the reply check
  covers it. Chat history gets a line naming the view and its key, so edits reuse it.

`checkView` sits next to `checkApp` and reuses `checkScreen` with the read-only parts, so each refusal
names its place. It also refuses script queries.

A new `packages/bots/skills/views.md` covers when to use a page, a view or an app, the parts, one
example, and "update the view you have". The standing rules get one line pointing to it.
`building-apps.md` and `BUILDER_RULES` teach the `view` part. **If the figures aren't in tables,**
the bot says the Builder can make one; only the Builder makes tables.

## What people see

- **Chat card:** title, summary and a live preview of the top of the view, cut off with a fade. It
  loads only when scrolled into view. Clicking opens the viewer.
- **Viewer:** the live view, Share (Only me / Everyone in the home, saying owners and admins can always
  see it), Versions with Restore, Ask <bot>, Open full page, and Delete (question 6).
- **Finding it:** the bot's Library (pinnable), the Apps area, and search. Search doesn't look at built
  apps today, so it gains the views the person can see.

## Views inside mini-apps

**The app decides, for each embed.** Both forms use one part:

- **Shared:** `{ "type": "view", "view": "deals-by-stage", "params": { "customer": "=params.id" } }`. It
  always shows the view's current live version, so a change reaches every app that shares it at once.
  It's stored by id and shown by key, as `mapBots` does, so nothing breaks when a title changes.
- **Copy:** the same part with `"copy": true`. On save, the view's current version becomes an ordinary
  read-only screen of the app (`view-<key>`), marked `copiedFrom: { view, version }`, and the part
  points at it (`"screen": "view-<key>"`). A copy goes through Draft and Publish with the rest of the
  app, and field renames and removals treat it like any other screen. The view's own CSS isn't copied.
- **Updating a copy:** when the original has a newer version, the app asks: "Deals by stage has changed
  since this app copied it. Update?" Update puts the new version in the app's draft, for the person
  to preview and publish. "Not now" hides the question until the next version. `view_save` also tells
  the bot which apps hold a copy. If the original is deleted or made private, the copy simply stays.

**For both:**
- **The save check refuses** unknown views, views not shared with the home, unknown or missing params,
  views inside views, more than 6 on a screen, and a view part in a table row or on a public screen.
  Errors suggest the closest key. Param formulas go through the same id conversion and field removal
  as other formulas. A copy's screen stays read-only and can't be the app's home, a navigation item
  or a `go` target.
- **Drawing:** a small wrapper around `AppNode` gives the part its own screen runtime, against the view's
  routes when shared and the app's when a copy, so the server's query code doesn't change. A shared view
  that's gone or no longer shared shows a plain placeholder, never an error page.
- **Style:** the host's theme applies. A shared view gets its own `data-app-style` area, so its CSS
  can't leak out; the host's CSS does reach in, which keeps the look consistent.

**For shared embeds only:** the view can't change its params, on save or restore, because a missing param
would quietly empty it and a dropped one could widen it. It can't be made private or deleted while
shared. Only the Builder may change it (question 1). Copies block none of these.

## Live updates

- **On commit only.** `notices.publish` runs on its own connection, so it would announce a write
  before it commits and even if it rolls back. A new `publishWithin(transaction, …)` runs `pg_notify`
  inside the write's transaction, which PostgreSQL delivers on commit and drops on rollback.
- **One place.** Both gate write paths (`create` and `change`) add it beside their audit row. Every
  data write goes through them: the Data tab, bots, app buttons, public forms, scripts, imports and
  templates. The notice is `apps-data`, keyed by home, carrying `{tables}`. Repeats in one transaction
  collapse into one, so an import sends a single notice.
- **A new route.** `GET /api/w/:workspaceSlug/apps-events` relays it, closed on shutdown as `bot-events`
  is. `bot-events` can't carry it: it's per person and only opens inside the chat shell, not the app
  frame. Each page shares one stream, opened only while a view is visible.
- **In the browser:** queries run when shown and on window focus. A notice re-runs the queries on
  changed tables and their link targets, debounced by about a second, only while visible. Reconnecting
  re-runs them too.
- **Several servers:** nothing is kept in memory, and each server hears the notice over PostgreSQL.

## First version

**In:** everything above. **Out:** public views and links, scripts, forms, buttons and any writes,
connected-app data without a table, view-in-view, export, sealed HTML, scheduled snapshots, and live
updates for an app's own screens (only its view parts are live).

**Pages** stay for written content, and there's no conversion. D-40 stays a separate track. Later, a
page could show a view through a fenced `view` block, which Markdown already allows for.

## Changes to existing behaviour

Pages don't change. These do:
- Every data write now also sends a notice. Nobody sees it unless a view is open.
- `GET /apps` includes views, with their `kind`.
- The Data tab's "used by" and the field-removal dialog can list views.
- Queries gain `limit` and `grandTotal`; the save check gains the `view` part.
- Search can return views.

## Decisions (2026-11-06)

1. **Private until shared.** A bot may change a view only if the person it's working for can see it, and
   only the Builder may change a view that an app shares.
2. **The app decides** between shared and copy, as above.
3. **Pages stay as they are for now.** D-40 is decided separately.
4. **The name stays "views".**
5. **Views share the sidebar's 8 pins.**
6. **People may retire a view (D-62, in place of deleting):** in the viewer, for its maker, an owner or an admin,
   refused while an app shares it. Nothing is deleted; old chat cards then say the view was retired, and **Bring back**
   in the Apps area restores it, renamed "Name (2)" if its name has been taken.

## As built

- The Builder's views start home-wide (D-60), so it can use them in an app without waiting for someone to share them.
- Search gets views through `botLibrary.js`, and the Apps area has an All / Apps / Views filter.
- A full-page view uses `AppFrame` with `ViewActions` in place of the app's tools and details.
- A view with parameters shown on its own, outside an app, has empty parameters, so its queries come back empty.
- A copy takes the app's look: the view's own CSS isn't copied.
- An app's own screens aren't live; only its view parts are.

