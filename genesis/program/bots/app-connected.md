# Connected apps and AI work for apps

The bots' side of apps' scripts using connected apps, bots and pictures (D-136): the bots' own connector tools, built
for one person with no chat, and the runner that does the AI work scripts queue.

## Sources

- Main: `packages/bots/src/server/appConnected.js`
- `packages/bots/src/server/appAiWork.js`
- `packages/bots/src/server/BotsFeature.js`
- `packages/bots/src/server/botLoops.js`
- `packages/bots/src/server/scriptWriter.js`

## Public contract

- `mercbot.app-connected` (BotsFeature): `usable(id)`, `choices(call)`, `actions(call, allowed)`, `guide(call,
  allowed)` (the Builder's list of each allowed, connected app's actions with their inputs), `run(call, { app, action,
  input, account }, mode, outcome)` and `runConfirmed(call, app, { actionId, args })`. Calls reach only the named app's
  accounts; every rule of the bots' tools holds (whose accounts, Sedna's confirmed person, hidden sign-in codes,
  switched-off actions, pacing, test copies logging changes). Chat-only actions and those that use a bot's files are not
  for apps (`apps_connected_no_action`). In `"button"` mode a change goes through the person's approval rules
  (`approvals.decide`): made, or kept in `outcome.waiting` with its question; `"read"` refuses any change
  (`apps_connected_write_refused`).
- `runAppAiWork` (the app job runner's `run` for `apps.jobs.isAiWork`): an `ai_batch` is one session in the bot's own
  voice (its name, template and additions), the task once and each item a turn, the last 3 turns kept; item text is
  wrapped as information only; each answer (at most 4,000 characters) goes into its record's field through the gate as
  the job's person as it comes, its steps saved, so a server that takes it over goes on from the first unanswered item;
  the items' texts are dropped once done. An `ai_picture` is checked (prompt, then picture), made with the home's picture
  model and attached to the record's field. Both run inside the meter as the person; what can't go on fails the job with
  why (`apps.jobs.fail`).
- The Builder's script guide names the `connected` and `ai` calls, and each prompt says which connected apps the app may
  use (with each action's inputs) and whether it may use bots and pictures.

## Proved by

- `tests/server/appConnected.test.js`
- `tests/server/appAiWork.test.js`
- `tests/server/appsScriptWriter.integration.js`
