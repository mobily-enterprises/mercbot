# Connected apps, bots and pictures for scripts

Lets an app's scripts use the home's connected apps directly, with no AI between, and hand work to a bot or ask for a
picture (D-136), as the person using the app, under the same rules as the bots, only where the home's owners and
admins allowed it, and never in a public app.

## Sources

- Main: `packages/apps/src/server/scriptConnected.js`
- `packages/apps/src/server/scriptAi.js`
- `packages/apps/src/server/appConnectedAccess.js`
- `packages/apps/src/server/appJobs.js`
- `src/components/apps/AppFrame.vue`
- `migrations/20261201120000_apps_connected_access.cjs`
- `migrations/20261202120000_app_connected_confirms.cjs`
- `migrations/20261203120000_app_jobs_ai.cjs`

## Public contract

- Access per app: `apps.connected_access`, plugin ids and `"ai"` (bots and pictures), set only by owners and admins
  (`PUT /api/w/:slug/apps/:app/connected-access` `{ apps }`, 403 `apps_connected_manage_forbidden` checked first, 400
  `apps_connected_unknown` for an id the shared layer doesn't know), shown with the home's connected apps in the Logic
  tab (`GET …/apps/:app/scripts` answers `connected: { allowed, choices, isPublic }`), each change audited. An app with
  any is never public and a public app gets none (409 `apps_connected_public` both ways; `ck_apps_connected_internal` in
  the database).
- `connected.actions()` and `connected.run(app, action, input, account?)` for `action`, `source` and `job` scripts
  (`hostFor`), through the bots' `mercbot.app-connected` (apps' late requirement): as the member in the call, or for a
  job `app_scripts.runs_as_user_id` (set from the call's person when a job is saved or turned on, cleared by
  `scripts.forgetPerson` when the bots see them leave); refused for a visitor, an app not allowed, a job with no person,
  past 5 calls a run and an answer over 1 MB. A button (`"button"`) may change; everything else reads (`"read"`). A
  draft's preview pretends a change (`{ simulated: true }`, listed with its pretended effects).
- A button's change the person's approval rules ask about is kept for them (`app_connected_confirms`) and the button's
  result gets `{ confirmConnected: { id, question } }`; the app frame asks with the shared confirm dialog, and
  `POST …/apps/:app/connected-confirm/:id` makes it once, as them, within 15 minutes (409 `apps_connected_confirm_gone`
  otherwise). Stale ones go with scripts' old runs. Each change made is an activity row (action `connected`) naming the
  app, the action and the person.
- `ai.bots()`, `ai.work({ bot, task, items, into })` and `ai.picture({ prompt, into })` for `action` and `job` scripts
  only, when the app allows `"ai"`: they queue app jobs (`ai_batch`, `ai_picture`, with `app_id`) as the run's person for
  the main bot unless one is named (archived refuses), into a text field or a file or picture field. Limits: 1 `ai.work`
  a run, 100 items of 8,000 characters, a task of 2,000, 3 batches of an app waiting or running (counted in the
  database), 5 `ai.picture` a run. A preview queues nothing. The Logic tab lists the app's newest 20 jobs with done of
  total and why one failed (`app_jobs.error`).
- Script tests answer `connected` by `"app.action"` (and `"actions"`) and `ai` by `"bots" | "work" | "picture"`.

## Proved by

- `tests/server/appsConnected.integration.js`
- `tests/server/appsAi.integration.js`
- `tests/server/appsCanary.integration.js`
- `tests/client/apps.vitest.js`
