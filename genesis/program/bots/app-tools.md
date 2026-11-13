# Bots' Apps tools

Lets every bot work with its home's app data, and the home's Builder make tables and apps, from
chat (D-35).

## Sources

- Main: `packages/bots/src/server/appTools.js`
- `packages/bots/src/server/builderTools.js`
- `packages/bots/src/server/viewTools.js`
- `packages/bots/skills/views.md`
- `packages/bots/skills/building-apps.md`
- `packages/bots/src/server/scriptWriter.js`
- `packages/bots/src/server/botAgent.js`
- `tests/server/appsScriptWriter.integration.js`
- `tests/server/builderInstructions.test.js`
- `src/components/apps/MercbotFieldRemovalCard.vue`
- `tests/server/appsBotTools.integration.js`

## Public contract

- Every bot: `data_tables`, `data_query` (CEL filter over field names, results marked as data,
  never instructions), `data_create`, `data_update`, `data_mark_obsolete` — through the data gate,
  audited as the bot (`via: chat`).
- The home's Builder also: `apps_overview`, `app_get`, `app_create`, `app_save_draft` (errors come
  back to fix; success posts one `app_draft` card per app), `table_create`, `field_add`,
  `field_rename`, `field_formula` (a calculated field's new formula, D-78), `field_remove` (posts a card;
  nothing changes until a person confirms). `table_create` and `field_add` take a field's `formula` to make
  it calculated; `data_tables` shows each calculated field's formula by names (`calculated`) and
  `needsAttention` when it can't be worked out; `data_query` refuses a filter or sort on one by name.
  Their descriptions (`CALCULATED_LIMITS`), `BUILDER_RULES` and `building-apps.md` tell the Builder to
  say, whenever it adds one, that lists can't be filtered, sorted or grouped by it and that a sum or
  average of one covers at most 5,000 records, and to offer a stored field filled in by a rule script
  when the person will want that (D-78, the owner 2026-11-12).
- `app_try` (D-71) runs a draft's screen on its practice data and can press a button or submit a
  form with given values (genesis/program/apps/practice.md); its writes stay in the copy, which the
  person's preview shows and Reset clears. The Builder's guidance (`building-apps.md`, `BUILDER_RULES`)
  is to try each screen and every saving button or form with realistic values, read the record
  back, fix what fails, then tell the person in a line or two and remind them to press Publish.
- The Builder's scripts (genesis/program/apps/scripts.md): `script_list`, `script_remove`, `script_save` (saved
  only when every test passes) and `script_write`, our own small coding loop (`scriptWriter.js`):
  the model drafts code and tests, they run in the sandbox, failures go back, at most 5 rounds and
  90 s, metered like other model calls, each round kept for the Logic tab; nothing is saved
  unless every test passes, and settings the model can't fix fail before any model call. What
  scripts can do is in the Builder's instructions (`BUILDER_RULES`), so a long chat never drops it.
- `template_list` and `template_install` (genesis/program/apps/templates.md).
- No tool publishes, restores or deletes; people do that from cards and screens.
- Every bot also has `watch_create`, `watch_list`, `watch_pause`, `watch_resume` and `watch_remove`
  (genesis/program/apps/automation.md). `packages/bots/src/server/appJobRunner.js` runs the tasks
  Apps queues (watch runs, button hand-offs) through `runAppTask` in `botReplies.js`, drained on
  shutdown; a reply claiming a watch change without a watch tool is sent back once.
- Every bot also has `view_save`, `view_list` and `view_get` (D-55): a view saved at once, with one `view` card
  per reply, for what the person it's working for can see. Only the Builder may change a view an app shares. No
  tool shares, restores or retires a view.
