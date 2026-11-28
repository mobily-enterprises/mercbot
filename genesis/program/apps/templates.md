# Templates

Ready-made apps a home installs and adapts (D-35, stage 3).

## Sources

- Main: `packages/apps/src/server/templates.js`
- `packages/apps/src/server/templateFollow.js`
- `packages/apps/src/server/templateCopies.js`
- `migrations/20261207120000_apps_forked.cjs`
- `packages/apps/templates/appointments.json`
- `packages/apps/templates/assets.json`
- `packages/apps/templates/bookings.json`
- `packages/apps/templates/budget.json`
- `packages/apps/templates/canary.json`
- `packages/apps/templates/car_log.json`
- `packages/apps/templates/chores.json`
- `packages/apps/templates/contact_form.json`
- `packages/apps/templates/contacts.json`
- `packages/apps/templates/content_calendar.json`
- `packages/apps/templates/contracts.json`
- `packages/apps/templates/crm.json`
- `packages/apps/templates/event_signups.json`
- `packages/apps/templates/expenses.json`
- `packages/apps/templates/family_calendar.json`
- `packages/apps/templates/family_health.json`
- `packages/apps/templates/feedback.json`
- `packages/apps/templates/gift_ideas.json`
- `packages/apps/templates/habits.json`
- `packages/apps/templates/helpdesk.json`
- `packages/apps/templates/hiring.json`
- `packages/apps/templates/home_maintenance.json`
- `packages/apps/templates/household_bills.json`
- `packages/apps/templates/incidents.json`
- `packages/apps/templates/invoices.json`
- `packages/apps/templates/job_applications.json`
- `packages/apps/templates/journal.json`
- `packages/apps/templates/leave.json`
- `packages/apps/templates/meal_planner.json`
- `packages/apps/templates/meetings.json`
- `packages/apps/templates/memberships.json`
- `packages/apps/templates/okrs.json`
- `packages/apps/templates/onboarding.json`
- `packages/apps/templates/orders.json`
- `packages/apps/templates/packing_list.json`
- `packages/apps/templates/pet_care.json`
- `packages/apps/templates/plants.json`
- `packages/apps/templates/pocket_money.json`
- `packages/apps/templates/policies.json`
- `packages/apps/templates/projects.json`
- `packages/apps/templates/purchase_requests.json`
- `packages/apps/templates/quotes.json`
- `packages/apps/templates/reading_list.json`
- `packages/apps/templates/recipes.json`
- `packages/apps/templates/room_bookings.json`
- `packages/apps/templates/school.json`
- `packages/apps/templates/shifts.json`
- `packages/apps/templates/shopping_list.json`
- `packages/apps/templates/staff.json`
- `packages/apps/templates/stock.json`
- `packages/apps/templates/study.json`
- `packages/apps/templates/subscriptions.json`
- `packages/apps/templates/supplier_orders.json`
- `packages/apps/templates/takings.json`
- `packages/apps/templates/timesheets.json`
- `packages/apps/templates/todos.json`
- `packages/apps/templates/training.json`
- `packages/apps/templates/trips.json`
- `packages/apps/templates/visitor_log.json`
- `packages/apps/templates/watchlist.json`
- `packages/apps/templates/wish_list.json`
- `packages/apps/templates/work_orders.json`
- `packages/apps/templates/workouts.json`
- `packages/apps/catalog/list_items.json`
- `src/components/apps/templateFilter.js`
- `src/components/apps/AppsTemplates.vue`

## Public contract

- 63 templates (D-141, D-143), each passing the app check against its own tables and the shared tables it `uses` (D-130),
  which installing makes with `ensureTable`; a table of its own with a shared table's key adds its fields to that
  table (Meal planner's `meal` on `list_items`). Each has `glyph` (its picture, `APP_ICON_NAMES`) and `audiences`
  (`corporate`, `business`, `family`, `personal`), optionally `needs` (what an owner or admin must switch on: its
  words in the install notice and the Builder's answer) and `scripts`. Contacts, To-dos and CRM are built on the
  shared tables; Shopping list, Packing list, Wish list and Meal planner on `list_items` (data.md), each filtering on
  its `kind`. Contacts and To-dos are every home's starter apps (data.md).
- `templateSummaries` answers each template's `icon` (its glyph), `audiences`, `abilities` (lines, board, calendar,
  timeline, public, sends, from its definition) and `needs`; the Templates tab filters by kind of use and searches
  (`templateFilter.js`), both kept in the address; the Builder's `template_list` filters by `audience` and `search`
  and answers `{ key, name, description, audiences, needs }`.
- A template's `scripts` are saved into the new app's draft before its definition, as the person installing it, their
  tests run (D-139), errors under `scripts.<key>`; on update too. Roll-up fields are added once every table exists.
  Invoices, quotes, orders, supplier orders and work orders bring a rule keeping each line's amount (quantity ×
  price) and a `total` roll-up summing it; expenses, trips, car log, pet care and habits bring roll-ups over stored
  fields. A roll-up adding up another roll-up is added after it (D-143).
- Study (D-143) shares `books` with Reading list (its own `contents_status`, `contents_note`, `file`), adds
  `book_parts` and its own `study_courses`, `study_units`, `study_lessons` and `study_questions`, brings ten scripts
  (reading a book in parts, a part's heading, planning, building the plan with lessons kept by title, writing lessons,
  their quizzes, and buttons) and its own `style`, and needs AI. Its Learn form offers only books whose contents are
  written (a link's `choices`, D-144), a book is put away with its parts by a job, and its course page counts lessons as
  they're written with a rough time left (`time_left`, a formula function).
- **The bot it comes with (D-144):** a template may name one of the bot library's templates (`"bot": "learner"`), which
  names it back (`appTemplate`); installing asks the bots for the home's bot on it, made once (`mercbot.app-connected`
  `appBot`), and the app remembers it (`apps.bot_id`, `migrations/20261207140000_apps_bot.cjs`). Study comes with
  Learner. Each person's answers and progress are theirs (`study_progress`, `study_answers`, personal tables, D-145); its
  button scripts never say whose, and its jobs put away everyone's progress in a lesson written again or put away.
- An installed app remembers its template and version (`apps.template_key`, `template_version`:
  `templateVersionOf`, a hash of its screens and tables, and of its scripts when it has some). `templateStatus` lists the home's apps made from templates
  as up to date, "an update is ready" or "can't tell" (made before apps remembered: matched by name);
  `updateFromTemplate` makes or completes its tables and saves the template's screens as the app's draft, answering
  the screens it had (D-130). The Builder's `template_check` and `template_update` call them.
- A template makes one app in a home, more only as copies asked for (D-141): installing one the home has an app from
  (`apps.template_key`, not retired; `apps.templateApps`) is refused, 409 `apps_template_installed` naming that app's
  slug, unless `again` (the route's body, the Builder's `template_install`), which names the copy "<template> copy N"
  and, with `fresh`, gives it the template's own tables under its own names (`templateCopies.js` `ownCopy`, its number
  kept in `apps.template_copy` for following; `canStartFresh` and `canShare` say which a template allows, refused 409
  `apps_template_fresh_unavailable` and `apps_template_share_unavailable`; summaries carry `fresh`, `share` and
  `things`, its own tables in words);
  the Templates route gives each template `inHome`, its first app's slug, which the tab shows as **In your home** with
  Open and Install another copy (after a warning that the copy shares its tables).
- Apps follow their template unless forked (D-141, `templateFollow.js`): `follow(options)`, run by the apps list
  (`GET /api/w/:slug/apps`) after the starter apps, reads the home's apps made from a template and not forked
  (`apps.forked_at` null) and, for each whose `template_version` isn't its template's now, claims the update under the
  row's lock (moving the recorded version on) and runs `updateFromTemplate` then `publish` as Mercbot; a draft that
  fails its check puts the version back and forks the app. `apps.fork` marks an app forked in the transaction of a
  change not from its template: `saveDraft` and `scripts.save` (unless `{ fromTemplate: true }`, which installs and
  updates pass), `scripts.remove`, `restore`. `withTemplateState` adds `templateUpdate` (a fork whose template's version
  moved on) to the apps list and an app's read; the Apps home shows Forked or Update available, the app's details its
  state and Ask the Builder to merge it.
- Installing (`POST /api/w/:slug/apps-templates/:key/install`, owners and admins, or the
  Builder's `template_install`) reuses tables with the same key, adding only missing fields, or
  creates them; creates the app with the template as a draft; optionally adds sample records
  through the gate (audited `via template`), skipping and counting ones that don't fit. A sample
  link names another of the sample's records, made earlier, by its table and values
  (`{ "sample": "contacts", "name": "Ana Ruiz" }`, so the CRM's sample contacts are in its Pipeline
  and own its deals), and a row whose linked record was skipped is skipped too. Nothing is removed
  or renamed.

## Proved by

- `tests/server/appsTemplates.test.js`
- `tests/server/appsTemplates.integration.js`
- `tests/server/appsStarter.integration.js`
- `tests/client/templateFilter.vitest.js`
- `tests/server/appsBotTools.integration.js`
- `tests/server/appsStudy.integration.js`
- `tests/server/teams.integration.js`
