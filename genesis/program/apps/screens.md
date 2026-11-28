# Running app screens

Draws an app's screens from its stored definition and runs only the queries and buttons that
definition contains, so an app can't do anything it wasn't saved to do (D-35).

## Sources

- Main: `packages/apps/src/server/runtime.js`
- `src/components/apps/AppFrame.vue`
- `src/components/apps/appExit.js`
- `src/components/apps/useAppExit.js`
- `src/components/apps/AppNode.vue`
- `src/components/apps/screenKeys.js`
- `src/components/apps/useSnackbar.js`
- `src/components/apps/AppChart.vue`
- `src/components/apps/AppForm.vue`
- `src/components/apps/appRuntime.js`
- `src/components/apps/appsApi.js`
- `src/components/apps/yaml.js`
- `src/components/apps/MercbotAppDraftCard.vue`
- `src/pages/w/[workspaceSlug]/apps/index.vue`
- `src/pages/w/[workspaceSlug]/apps/[slug]/index.vue`
- `src/pages/w/[workspaceSlug]/apps/[slug]/[...path].vue`
- `src/pages/w/[workspaceSlug]/apps/data/[table].vue`
- `packages/apps/src/shared/namedFormulas.js`
- `src/components/apps/askInChat.js`
- `packages/apps/src/shared/lines.js`
- `packages/apps/src/shared/boards.js`
- `src/components/apps/AppBoard.vue`
- `src/components/apps/AppBoardCard.vue`
- `src/components/apps/AppCalendar.vue`
- `src/components/apps/AppTimeline.vue`
- `src/components/apps/useBoardCards.js`

## Public contract

- `POST …/apps/:slug/query {screen, query, state, params, version}` runs one declared query of
  that screen: a list (filter, sort, pages of 100), one record, or totals. Page values are limited
  to the declared ones and their types. A query touching a removed field fails closed
  (`needsAttention`, no records).
- `POST …/apps/:slug/action {screen, path, row, values, …}` runs the steps stored at `path`
  (`do` or `onRowClick`): neighbouring create/update/markObsolete steps in one transaction through
  the data gate, a form writing only the fields it shows; go/notify/dialog steps come back as
  effects. `version: "draft"` works on the draft's practice copy (D-71, practice.md): writes land there, the
  result's `practice` lists them (`changes`) with what was only reported (`wouldSend`, `simulated`), and nothing is
  audited or sent. An app without a draft still only reports what a button would do (`dryRun`).
- Parts include `chart` (bar, line or pie of a totals query, Chart.js loaded only with a chart)
  and create forms (`form.table`). Steps include `askBot` (see automation.md). Totals grouped by a
  link are named by the linked record's title, the groups' records read in one query.
- The frame at `/w/<home>/apps/<app>/<screen>/<id>` shows the app's own navigation (rail, tabs,
  bottom bar on phones), the catalog's parts with skeleton loading, values by field type, a draft
  banner ("Practice data: …") with Reset and Publish, Ask Builder, Point and ask, and the details panel. Parts that point at a
  removed field are skipped and the panel says so. A screen's reads still on their way stop, with those of the views
  on it (`appRuntime.js` `stop()` and `signal`, an aborted fetch), when another screen opens and before Reset or
  Publish, which clear the practice copy they read. Each new screen runtime starts the screen's parts again (after
  Reset, a view copy reads the new practice copy), and Publish that fails reads the draft again.
- Leaving (D-106, D-123): moving between the app's own places (its navigation, a button's `go`, live to draft)
  replaces the open history entry, so the app keeps one entry and the trail steps before it. The shell's button first
  in the frame's bar (Mercbot's, outside the app's area) is the close of the whole apps area (`useShellPageClose`,
  `useAppExit.js`), as Apps' is: an X named for where it goes (Back to <room or bot>, Back to Files, Back to Mercbot).
  One click, or Ctrl+[, goes through JSKIT's `finish()` to the nearest trail step outside the apps area (`openerOf`),
  with its query, else the home's chat; Back from there goes at most to Apps. The name as text in the bar, and
  skipping Apps' entry too, wait for JSKIT's `leave()` (D-106, Later).
- Ask Builder opens the app's chat with the Builder with a first line naming the app, screen and part
  (`askInChat.js`, `POST /api/w/:slug/apps/:slug/chat`, `apps.appChat`): one per app, made the first time anyone asks
  (two asks at once make one), Public (D15), named after the app, with the Builder and the person who asked; anyone in
  the home opens it after that. A home without a Builder is refused (409 `apps_builder_missing`), a view has none (409
  `apps_view_refused`), and an app of another home is 404. When an owner or admin chooses another Builder
  (`apps.setBuilder`, O26), the new one joins every app's chat, archived ones too (`records.chats.changeAppBuilder`),
  where the old one stays a member until someone removes it; each chat gets the line "<New> is the Builder now.", and
  their people hear of it. An app without a chat yet gets none.
- Named formulas (D-78): the definition's `formulas` (`{ name: { params, formula } }`, at most 30,
  8 parameters each) are added to the app's script functions (`withNamedFormulas`) wherever its
  formulas run: screens on the server and in the browser, a draft tried with `app_try`, public
  screens (sent with the page). A named formula sees only its parameters, the built-ins, the
  script functions and the other named formulas; the save check refuses unknown names and wrong
  numbers of values by name, a formula that calls itself through others (naming the chain), and
  any call in a filter. At run time, one use sets off at most 1,000 named formulas (`MAX_CALLS`). The details panel's Logic tab lists them.
- A form shows a calculated field read-only, worked out from what is typed (`calculate`), and never
  sends it; on the server a form writes only the stored fields it shows, and `form.<field>` of a
  calculated field follows the form's values. The save check refuses calculated fields in a
  query's `where`, `sort` and `groupBy`, and in `create.values`, `preset` and `update.set`; a
  visitor reads one only with the fields it is worked out from, and never writes it.
- Queries also take `limit` (a list's 1 to 100 rows) and `grandTotal` (a totals query's one figure across
  every group, shown as a Total line by totals and chart parts). The `view` part shows one of the home's
  views (views.md).

- **Link pickers (D-140):** `POST …/apps/:slug/link-choices` (`runtime.linkChoices`) answers a form's link field's
  records through the gate, the first 100 or those whose title has the search (404 `apps_link_field_not_found` for a
  field the form doesn't show or isn't a link); a visitor's reach only what visitor access lists. A public create preset
  may be exactly one of the screen's own params (`pageParamOf`).
- **Lists (D-140):** a list query takes the person's `page`, `sort` (a stored field, "-" for descending; an unknown one
  keeps the screen's) and `search` (stored text fields, ANDed with the query's where); a table part sorts by a column
  showing one stored field, pages past its rows ("101–200 of 250") and shows a search box when it sets `search`.
- **Line items (D-140, `shared/lines.js` `expandLines`):** a `lines` part stands for a list query of the shown record's
  child records, a table with Edit and Remove, an add form presetting the link and an edit dialog; the server and the
  browser run the screen expanded, so paths agree; `checkLines` validates it (never on a public screen).
- **Boards, calendars and timelines (D-140, `shared/boards.js`):** over a list query of a table's records; moving a
  card (`runtime.move`, `POST …/apps/:slug/move`) changes its record through the gate as an edit, a board's to a
  column's choice, a calendar's or a timeline's by whole days; `move: false` keeps cards still; a view only shows them.
- **Buttons (D-140):** `if { when, then, else }`, `set` (a declared screen value from a formula, applied by the browser,
  visitors too), `confirm` (the browser asks first) and "=row" as a row action's record. A create form's file and
  picture fields go onto the record once its button made it (`created`; a visitor's only for that record, 3 files of
  10 MB), and a picture field takes a photo on a phone. A plain reference to a picture field shows the picture, small,
  to members (`showsPictures`); a visitor sees its name.
- A create form's `onSubmit` sends (D-137) are sending.md's.

- A form names a field its own way (`{ field, label }`: plain words, 1 to 60 characters, checked; shown by
  `AppForm.vue`), as an app does a shared table's general field; a `lines` part takes `preset`, given to every new
  line besides its link (D-141).

## Proved by

- `tests/server/appsRuntime.integration.js`
- `tests/client/apps.vitest.js`
- `tests/client/appExit.vitest.js`
- `tests/e2e/apps.spec.ts`
- `tests/e2e/app-exit.spec.ts`
- `tests/server/appsLinkChoices.integration.js`
- `tests/server/appsLists.integration.js`
- `tests/server/appsLines.test.js`
- `tests/server/appsLines.integration.js`
- `tests/server/appsBoards.test.js`
- `tests/server/appsBoards.integration.js`
- `tests/server/appsForms.integration.js`
- `tests/client/appForm.vitest.js`
