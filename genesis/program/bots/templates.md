# Bot templates

Ready-made bots for one job each, in a public gallery curated by the Mercbot team, and the
templates a link opens, when a copy built on Mercbot keeps them (D-43).

## Sources

- Main: `packages/bots/src/server/templates.js`
- `packages/bots/src/server/botsService.js`
- `packages/bots/src/server/registerRoutes.js`
- `packages/bots/src/server/botTemplates.js`
- `packages/bots/src/server/templateResults.js`
- `bot-templates/checks/results.json`
- `scripts/check-templates.mjs`
- `packages/bots/src/server/botAgent.js`
- `packages/bots/src/server/botTools.js`
- `packages/bots/src/server/memoryTools.js`
- `packages/bots/src/server/routineTools.js`
- `migrations/20261113120000_baseline.cjs`
- `src/components/templates/TemplateGallery.vue`
- `src/components/templates/TemplatePage.vue`
- `src/components/templates/TemplateShare.vue`
- `src/components/templates/TemplateContents.vue`
- `src/components/templates/TemplateAvatar.vue`
- `src/components/templates/TemplateTested.vue`
- `src/components/templates/templatesApi.js`
- `src/components/mercbot/MercbotTemplatePreview.vue`
- `src/pages/templates/index.vue`
- `src/pages/templates/[slug]/index.vue`
- `src/pages/t/[slug].vue`
- `tests/server/botTemplates.integration.js`
- `tests/server/templateChecks.test.js`
- `tests/server/templateCheck.integration.js`
- `tests/support/templateCheck.mjs`
- `tools/standInModel.mjs`
- `tests/client/templateBadge.vitest.js`
- `tests/support/unitRun.mjs`
- `tests/e2e/templates.spec.ts`

## Public contract

- **Gallery (public):** `GET /api/templates` lists Mercbot's own templates (summaries: name, look,
  area, description, creator, `team`, featured, `tested`: the day it last passed its end-to-end
  check, or null) with the nine job areas. `team` marks the Mercbot team's own: the pages say
  "Made by the Mercbot team", show its mark and the badge only for those, never from a creator's
  name, which whoever made a template a link opens chooses.
  `GET /api/templates/:slug` gives one in full: instructions, every skill with its steps, routines,
  apps and a paired app template. The slug or the bot's name works; any other code is asked of the
  templates links open (`mercbot.template-links`, optional: `types.js` `TemplateLinks`), with the
  request's own options, and is 404 without them. What they find is `linked`: never the team's,
  never tested, never listed, and a bot added from it came from a `link`. Pages: `/templates`,
  `/templates/<slug>`, and the share page `/t/<code>`, all without signing in.
- **Curated (D-43):** only files in `bot-templates/` are listed, credited to the Mercbot team. Each is
  checked when Mercbot starts (`checkTemplate`): one job, a greeting with `{firstName}`, a setup
  interview skill, routines described, allowed apps, and no `tested` of its own.
- **Tested badge (D-43, D-79):** `npm run check:templates [-- <slug> ...]` adds each template's bot
  as a new person through the routes, plays its setup interview with an AI-played person and an AI
  judge (which gives a reason for each question; a question not asked fails with it), and records
  `{date, commit, behaviour, template, models, passed, reasons, turns, asked}` per slug in
  `bot-templates/checks/results.json` (committed). It needs both text kinds of AI (D-72)
  and refuses with exit 2 and writes nothing without them, or with `NODE_ENV=production` or
  `SIDE_EFFECTS=live`; it runs on its own copy of the test database and a temporary folder for
  files, uploads and computers (`checkCopyEnv`), as a test copy, so sends are simulated (D-69) and
  any send line fails the template. Templates
  whose setup needs GitHub connected (`setupNeeds`) are skipped. The results are read once at start
  (`templateResults.js`): a template is tested only while its newest result passed, for its
  current `templateFingerprint` (sha256 of the key-sorted file) and the current
  `behaviourFingerprint()`: sha256 of every file `BEHAVIOUR_SOURCES` names (Mercbot's rules and
  skills, `@jskit-ai/agent` and `agent-runtime`'s `src` as installed, the setup tools, approvals,
  drafts and sending, the chat kind's provider and model), each by its path in the list and its
  content, worked out once at start, the same on every server of a release (D-79). A result without
  `behaviour` (one recorded under the old generation number) counts for none. Outside production
  `MERCBOT_TEST_TEMPLATE_RESULTS` names another results file, as Test Previews do. `npm test` ends
  with a warning (never a failure) counting the team's templates Not tested yet for the current
  fingerprint (`untestedCount`, `tests/support/unitRun.mjs`), and fails while a path the list names
  is missing.
- **The checks' results (D-79):** `templateChecks()` answers `{ behaviour, total, untested, templates: [{ slug, name,
  tested, needs, check }] }`; `check` (`lastCheck`) is null or the newest result's date, commit, models, passed,
  reasons, and whether it ran on the template and the behaviour as they are now. No route answers it here: whoever
  shows the checks decides who sees them. A team template's page shows, under its badge, the parts a copy built on
  Mercbot adds there (`extensions.js` `templateParts`, each `{ component, visible }`), to someone signed in whose
  `visible` answered yes; Mercbot adds none.
  The public gallery and template routes never carry a check. The gallery,
  a template's page and the preview show `TemplateTested.vue`: "Tested <date>" or "Not tested yet".
  `tests/server/templateChecks.test.js` checks every file statically (schema, skills and tools,
  no personal details, routines paused, asks before sending, a setup interview); the stand-in model
  (`tools/standInModel.mjs`) proves the end-to-end check in the database suite and is every Preview's and
  Test Preview's AI (D-83), so a template's setup interview can be walked through there by hand.
- **Adding:** the share page's button opens Mercbot at `/?template=<code>`, which carries on into the
  home and opens the preview: everything opened out, nothing added before **Add bot**. Owners and
  admins may also install the paired app as a draft. `POST …/bots/from-template {slug}` makes the
  bot with the template's name, look, `instructions` and `skills`, records `origin` (shown as
  **Came from** in Details), skips the generic first conversation and posts the template's greeting
  with the person's real first name (none rather than an account handle). Routines aren't copied:
  the setup interview creates them paused, and they start only on a yes.
- **Where:** the gallery, details, the checks' results and adding are `templateGallery`,
  `templateDetails`, `templateChecks` and `addFromTemplate` in `botTemplates.js`; the bot's own job and
  skills reach the model through `instructionsFor` (`botAgent.js`), and `read_skill`,
  `create_routine` (`paused`) and `update_routine` (`running`) in `memoryTools.js` and `routineTools.js`.
- **A bot's own job:** `instructionsFor` adds the bot's `instructions` (below Mercbot's own rules,
  which win) and lists its own skills; `read_skill` opens them by name.

## Owned data

- `bots.instructions`, `bots.skills`, `bots.origin`.
