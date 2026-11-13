# Running app screens

Draws an app's screens from its stored definition and runs only the queries and buttons that
definition contains, so an app can't do anything it wasn't saved to do (D-35).

## Sources

- Main: `packages/apps/src/server/runtime.js`
- `src/components/apps/AppFrame.vue`
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
- `tests/server/appsRuntime.integration.js`
- `packages/apps/src/shared/namedFormulas.js`
- `tests/client/apps.vitest.js`
- `tests/e2e/apps.spec.ts`

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
- Ask Builder opens the Builder's chat with a first line naming the app, screen and part. A shared
  Builder opens the app's own conversation (made the first time); when the Builder isn't shared,
  an owner or admin is asked once whether to make it so ("a conversation for each app"); after a
  no, or for others, the person's own chat opens.
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
