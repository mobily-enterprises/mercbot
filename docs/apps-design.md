# Apps: mini-apps built by bots (D-35)

The design for **Apps**, agreed in conversation on 2026-10-25 and 2026-10-27, a phase-2 feature (D-18).

**Naming:** "apps" already means the outside services in *Connect apps* and
[apps.md](apps.md) (D-33). The clash is accepted: this area is still called **Apps**, and the
things in it are apps with **screens**. In docs and code, say "Apps area" or "built apps" when you
need to tell them apart from connected apps.

## What it is

People get real mini-apps on their own data, made entirely by bots:
- internal apps, such as a CRM, stock, leave requests or a hiring pipeline
- public apps, such as a contact form, a feedback form or a status board

Every app works on **one shared database**. Every change to it is audited. Nothing is ever
deleted, only marked obsolete.

## People and bots

- **The Builder** is a role given to one ordinary bot at a time ("Make this the Builder" in its
  Details panel). Only the Builder changes structure: tables, fields, apps, screens and scripts.
  Moving the role leaves everything in place.
- **Every other bot** reads and writes records in any table. Any bot can set up **watches** for
  itself in plain words, like routines: new records, changes, or conditions such as "status
  became Won". Watches show in its Details panel and run in the background like routine runs.
- **Bots may add** tables and fields freely. **Removing** a field or table always needs a person's
  approval, through the existing approval cards.
- **People never edit code or app definitions.** They ask the Builder. Code can be read, never
  edited.

## The Apps area (UX)

- **Sidebar:** an **Apps** entry above the bots, plus the person's **pinned apps** as small tiles.
- **Apps home** has four tabs:
  - **Apps:** a grid of tiles, each with an icon, colour, name, an Internal or Public badge and the
    time of its last change
  - **Data:** every table
  - **Activity:** the audit trail
  - **Templates:** the ready-made library
  
  **New app** opens a chat with the Builder.
- **Inside an app**, the app has its own frame:
  - its name, icon and theme
  - its own navigation: a side rail of 3–7 screens, tabs for small apps, and a bottom bar on phones
  - real addresses such as `/apps/crm/contacts/12`, and a home screen
  - screens that take values (for example a contact's id), and app-wide values such as the
    signed-in person

  Mercbot itself shows only the shell's Up arrow, back to Apps (D-64). A public app shows only its own frame, at
  an address like `https://example.com/a/<home>/<app>`.
- **App details panel** has these tabs:
  - **Overview:** purpose, Internal or Public, the public address and QR code, the Builder bot
  - **Screens:** previews, with **View source** (read-only)
  - **Data:** the tables the app uses
  - **Logic:** scripts, watches and routines, each with a plain-language summary, read-only code,
    tests, runs and errors, and **Ask Builder to fix**
  - **Versions:** each change in plain words, with **Restore**
  - **Activity:** data changes made through this app
  - a **health** line, for example "1 part hidden because a field was removed"
- **Changing an app:**
  - **Ask Builder** on every screen, with that screen attached
  - **Point and ask:** click a part, then describe the change
  - The Builder's changes go into a **draft**. Its chat card offers **Preview** and **Publish**.
  - **Every app goes through Draft → Publish.**
  - **Draft preview works on practice data** (D-71, replacing the read-only preview): a copy of the newest 1,000
    records of each table the draft uses, where Save and Edit work as live; nothing reaches the live records, the
    Activity trail or anyone outside. The banner offers **Reset** and **Publish**; publishing, or 7 days unused,
    clears the copy. The Builder tries each draft on the same copy with `app_try` before telling the person.
- **Data tab:**
  - each table shows its record count and which apps use it
  - an editable spreadsheet view, with filters and search
  - **Mark obsolete** instead of delete, and a "Show obsolete" switch
  - CSV and Excel import and export
  - a **History** drawer on every record
- **Activity:** every change, with who made it (a person, a named bot, a script, or a public
  visitor via a named form), where (app, screen or script) and what (each field's old → new
  value). It can be filtered by table, app, who or date. Every record and every app shows the
  same feed, filtered.
- **Public apps:**
  - **Publish publicly** shows the address, a preview of exactly what visitors see, and spam
    protection
  - visitors get **only** forms that add records, and read-only displays the app chooses
  - public submissions **never trigger bots directly**. Bots watch the table and treat what was
    submitted as untrusted text.

## Data

- **Storage:** AnyAPI storage from `json-rest-api`, on Mercbot's PostgreSQL. There is one
  database per account for now (AnyAPI tenant = account), moving to workspaces later.
- **Access:** every app can reach every table for now. A **simple** permission model comes later.
  There will never be per-field security: private data goes in private tables.
- **Never delete:** records, fields and tables are only marked obsolete, and their data is kept.
- **Full change history:** every change is recorded.
- **Field types:** text, number, money (stored in cents), date, yes/no, choice, email, phone,
  link to another table, and file or picture (in the bot files system).

## Resilience: apps adapt to data, with no migrations

- **Apps refer to tables and fields by permanent id, never by name.** Names are labels, so
  **renaming** a field relabels it everywhere at once.
- **Adding** tables or fields never affects apps.
- **Changing a field's type** means a new field plus the old one removed, by the path below.
- **Removing a field always asks first,** whoever starts it. An impact dialog lists every app,
  screen and script that uses it, and warns when a list filter uses it ("this list will show
  **all** deals"). On confirmation, **one save**:
  - marks the field obsolete, keeping its data
  - removes every reference in every app (columns, form fields, formula parts, and the filter
    conditions on that field)
  - gives each affected app a new, restorable version
  - writes one Activity entry

  These automatic edits skip Draft → Publish, because the dialog was the review. **Scripts are
  never edited automatically.** They're marked "needs attention" for the Builder.
- **Screens are forgiving when they run:**
  - missing fields are left out
  - formulas touching them show "—"
  - links to obsolete records show "(obsolete)"
  - missing values get typed defaults
  - an unexpected **filter on a missing field fails closed**: the list shows nothing, with a note
- **Checking is strict when building:** the save check refuses broken definitions, so the
  Builder must fix them.

## How apps are made

- **Apps and screens are JSON**, checked against a strict schema, with a read-only YAML view.
  Screens are built from a **whitelisted catalog of parts** that wrap Vuetify: layout (rows,
  grids, tabs, dialogs, steppers), data parts (tables, lists, record views, forms, totals, later
  charts) and basics (text, chips, buttons, inputs). Screens hold no JavaScript (logic lives in
  scripts); since 2026-10-30 each app may carry **its own CSS**, written by the Builder (below).
- **Formulas use CEL** (`@marcbachmann/cel-js`, which has a type checker), and start with `=`.
  They're pure: they always finish and have no side effects. They're used for calculated values,
  show-if, filters and labels.
  - A query's `where` is translated to SQL on AnyAPI's slots through the row-policy hook.
  - Parts that don't mention fields, such as `state.search`, are worked out before the query runs.
- **Queries are declared by the screen.** The browser only asks for "query X of screen Y"; it
  never sends a query of its own.
- **Actions are fixed steps:** go, create, update, mark obsolete, notify, ask a bot, run a script.
  Neighbouring data steps run in one transaction, and the server checks every step.
- **Reuse (built 2026-11-12, D-78):** calculated fields on tables and named formulas with
  parameters, with **no recursion**: the save check refuses cycles and names the chain.
  - A **calculated field** is a table's field with a formula over the same record's other fields
    (`=price * quantity`), stored by ids. It is never stored: the data gate works it out on every
    read, and a form while the person types, so it never goes stale. It uses only the record's
    fields and the built-ins (a table is every app's), none that loops over a list or matches a
    pattern, as it runs for every record shown. Filters, sorts and groups run in SQL, so they can't
    use one yet; a sum or average of one is worked out from the records (up to 5,000).
  - A **named formula** is an app's own (`"formulas": { "with_vat": { "params": ["amount"],
    "formula": "=amount * 1.2" } }`), callable like a script function from any of the app's
    formulas except filters. It sees only its parameters, and one use sets off at most 1,000.
- **Each app's own CSS (2026-10-30, replacing "never CSS"):** the Builder has complete
  freedom to make an app look totally different. The definition's `style` is ordinary CSS, fenced
  to the app's area (`[data-app-style]`, painted only inside itself), loading nothing from outside
  (images as data URLs, fonts from fonts.gstatic.com), with its own animation and font names; any
  part takes `class` names (`.x-<name>`). It goes through Draft → Publish like everything else.
- **Themes are fixed choices** (the starting point the app's CSS builds on):
  - account (later workspace): brand colour, light/dark, font, corner style, density, logo
  - app and screen: overrides of those, plus width
  - each part: tone, emphasis and size
  
  Colour choices that would make text hard to read are refused.

## Scripts: real programming, fenced in

For logic that formulas can't express, and that shouldn't go to a bot each time:
- **Written only by bots,** with tests. There's no editor; people read the summary, the code, the
  tests and the runs.
- **Engine:** `quickjs-emscripten`, the asyncify build, so data calls can wait on the database.
- **Rules (each one tested 2026-10-27):**
  1. a stack limit of 256 KB or less (larger limits crashed Node on deep recursion)
  2. one worker thread per run, with a **watchdog** that kills it. QuickJS's own time limit
     misses runaway memory use and loops while it waits on the database.
  3. the only way out is our data functions (read, create, update, mark obsolete), with JSON in
     and out
  4. a budget of data calls per run, and fair-use limits per account
- Called by an action step, a watch or a routine. A failing script shows a friendly message in
  place, and its Logic entry turns red.
- The DeepSeek coding loop for writing scripts comes later.

## Templates

A template bundles tables and fields, screens, watches and roles, and optional sample data. It
can be installed in one click, or through the Builder, who adapts it. Updates only ever add, so
customised screens are kept. A name clash reuses the existing table, or the Builder renames it.
The Builder writes templates, and we review them with automatic screenshots. Templates are data,
so they're safe to share.

## Releases (agreed 2026-10-25)

1. **First:** tables and fields, the editable spreadsheet view with history, the Builder role and
   its tools, data tools for every bot, and apps with screens (tabs, tables, forms, record views,
   formulas). The later UX decisions above (Apps area, Draft → Publish, Activity) belong here.
2. **Second:** public forms, bot hand-offs, watches, charts.
3. **Later:** scripts, templates, themes in full, permissions, workspaces.

## `json-rest-api`

Every fix requested on 2026-10-27 has shipped: 2.1.0 (servers kept in sync with `schema_version`,
`reloadSchema`, `loadResource`, `onSchemaChanged`; slot counts; cheap per-tenant instances; the
`email` type) and 2.2.0 (`aggregate()` under row policies, `retireKnexFields()`, `migrateField()`).
Apps uses 2.2.0.

## As built (first release, 2026-10-28)

- Ownership is the **home** (JSKIT workspace, D-36): every Apps table is keyed by
  `workspace_id`, AnyAPI's tenant is `ws:<home>`, the Builder role and pins are per home (pins per
  person), and the audit records which person or bot acted.
- Addresses: the Apps area is `/w/<home>/apps` (tabs Apps, Data, Activity), a table is
  `/w/<home>/apps/data/<table>`, an app is `/w/<home>/apps/<app>/<screen>/<record>`;
  `?version=draft` previews the draft. API routes are under `/api/w/<home>/apps`,
  `/api/w/<home>/app-data` and `/api/w/<home>/app-activity`.
- The Builder asks to remove a field with a card in chat; nothing changes until a person confirms
  there (the same dialog as the Data tab's Fields). Bot tools never publish, restore or delete.
- CSV and Excel (`csv-parse`/`csv-stringify`, `read-excel-file`/`write-excel-file`, chosen
  2026-10-28): export writes a table's live records; import only adds records, matching
  headings to field labels or keys, and writes all rows or none.
- Not in this release: restoring a removed
  field (AnyAPI has no un-retire), public apps, watches, bot hand-offs, charts, scripts,
  templates, themes, permissions.

## As built (second release, 2026-10-29)

- **Charts:** a `chart` part (bar, line, pie) of a totals query, drawn with Chart.js
  (`vue-chartjs`), loaded only on screens with a chart; colours from a fixed, colour-blind-checked
  order.
- **Bot hand-offs:** an `askBot` button step queues a task for a bot (stored by bot id) once the
  button's other steps succeed; the bot works on it in its chat with the person who pressed.
- **Watches:** any bot creates them with tools; every change is checked once across servers by
  reading the audit trail up to the PostgreSQL transaction horizon; one task per burst; a watch's
  own run never fires it; a runaway watch pauses itself. Tasks (`app_jobs`) run at most once,
  like routines.
- **Public apps** (extended on 2026-10-29 from "public forms"): public screens can
  list, show, total, chart and edit records within each app's **visitor rules** per table (read
  all / a formula / own; create; update own; replaced on 2026-11-07 by visitor access, D-66). **Each app decides whether visitors sign in**, by
  an emailed code; visitor identities are separate from Mercbot accounts and belong to the home
  (one email, one visitor across the home's public apps). Spam: hidden trap, submission and code
  limits, and Cloudflare Turnstile asked once a day per visitor session. Address
  `/a/<home>/<app>`; only a home owner or admin makes an app public.
- Still later (done in the third stage, below): QR codes for public addresses, scripts, templates,
  themes in full, permissions for people inside a home.

## As built (third stage, 2026-10-29)

- **Permissions (kept simple on purpose):** an app is for everyone in the home or chosen people;
  a table is changed by everyone or chosen people (others read). Owners and admins always can;
  bots, scripts and visitors aren't limited by it. *Replaced by D-66 (2026-11-07): nothing inside a
  home is private; every member sees every app and view and changes every table.*
- **Themes:** a home's look for its apps (colour, light/dark/system, font, corners, spacing,
  logo) and each app's colour and spacing, from fixed choices, contrast-checked, drawn through
  Vuetify themes; apps only, never Mercbot's own look.
- **Templates:** six ready-made apps installed as drafts, reusing existing tables.
- **Scripts:** five kinds: buttons, data for screens, rules on
  saving (wherever a change comes from), functions in formulas (server and browser), and jobs on
  a timetable or a watch, plus outside web calls to addresses owners allow, with secret headers
  scripts never see. QuickJS in pooled worker threads with time, memory, stack and call limits
  and a watchdog; saved only with passing tests; people read them in each app's Logic tab and
  the Apps home's Scripts tab. The Builder writes them with **our own small coding loop**
  (`script_write`, DeepSeek, at most 5 rounds and 90 s), not an outside framework, and its
  instructions say what scripts can do so a long chat never drops it.
- **Public apps:** each app chooses how visitors sign in: an emailed code, an emailed link,
  Google, Microsoft or GitHub (verified emails only; the same keys as Mercbot's own sign-in). A
  QR code of the public address with a download.
- **No built-in domain:** one public address setting (`APP_PUBLIC_URL`), the email sender from
  `MAIL_FROM` or the address's host, no default hub, and an optional www → bare redirect.
- Still later: script buttons on public screens; permissions beyond this simple model.

## Evidence

A throwaway prototype (session 2026-10-25_13-40-43, never merged; reached at
`/auth/pages-prototype`) proved the following against PostgreSQL:
- formulas become SQL on AnyAPI
- grouped totals work
- the renderer draws a list, details and an edit form with show-if, required and save, plus
  tabs and totals
- the save check reports precise errors

Throwaway tests on 2026-10-27 proved the script rules above.

## Still open

- Shared core tables (people, companies, products) in the first release?
- Who may publish templates: curated only, or a community later?
- Filtering, sorting and grouping by calculated fields (D-78 refuses them for now).
- The simple permission model, and workspaces.
