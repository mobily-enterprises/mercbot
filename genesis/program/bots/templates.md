# Bot templates

Ready-made bots for one job each, in a public gallery curated by the Mercbot team, and the
templates a link opens, when a copy built on Mercbot keeps them (D-43).

## Sources

- Main: `packages/bots/src/server/templates.js`
- `packages/bots/src/server/botsService.js`
- `packages/bots/src/server/registerRoutes.js`
- `packages/bots/src/server/botTemplates.js`
- `packages/bots/src/server/botTemplate.js`
- `packages/bots/src/server/records/homeTemplateRepository.js`
- `packages/bots/src/server/templateDrafts.js`
- `packages/bots/src/shared/templateBody.js`
- `migrations/20261120120000_bot_templates_and_additions.cjs`
- `packages/bots/src/server/templateResults.js`
- `bot-templates/checks/results.json`
- `scripts/check-templates.mjs`
- `packages/bots/src/server/botAgent.js`
- `packages/bots/src/server/botTools.js`
- `packages/bots/src/server/skillTools.js`
- `packages/bots/src/server/routineTools.js`
- `migrations/20261113120000_baseline.cjs`
- `src/components/templates/TemplateGallery.vue`
- `src/components/templates/TemplateBrowser.vue`
- `src/components/templates/galleryView.js`
- `src/components/mercbot/MercbotTemplateTag.vue`
- `src/components/mercbot/MercbotChangeTemplateDialog.vue`
- `src/components/templates/TemplatePage.vue`
- `src/components/templates/TemplateShare.vue`
- `src/components/templates/TemplateContents.vue`
- `src/components/templates/TemplateAvatar.vue`
- `src/components/templates/TemplateTested.vue`
- `src/components/templates/templatesApi.js`
- `src/components/mercbot/MercbotTemplateDraft.vue`
- `src/components/mercbot/templateDraft.js`
- `src/components/mercbot/MercbotNewBotDialog.vue`
- `src/components/mercbot/MercbotSettingsTemplates.vue`
- `src/pages/templates/index.vue`
- `src/pages/templates/[slug]/index.vue`
- `src/pages/t/[slug].vue`
- `tools/standInModel.mjs`
- `bot-templates/teams.json`
- `packages/bots/src/server/teams.js`
- `packages/bots/src/server/botTeams.js`
- `packages/bots/src/server/botList.js`
- `packages/bots/src/server/records/newBotRepository.js`
- `src/components/mercbot/MercbotTeamScreen.vue`
- `src/components/mercbot/teamChoice.js`
- `src/components/mercbot/useNewBot.js`
- `src/components/mercbot/MercbotHomeSwitcher.vue`
- `src/components/mercbot/MercbotNewHomeDialog.vue`
- `packages/bots/src/server/botPlans.js`
- `src/components/mercbot/MercbotDescribeBox.vue`
- `src/components/mercbot/MercbotPlanReview.vue`
- `src/components/mercbot/useBotPlan.js`

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
  and refuses with exit 2 and writes nothing without them, or where `APP_ENV` is staging or
  production (D-87); it runs on its own copy of the test database and a temporary folder for
  files, uploads and computers (`checkCopyEnv`), as a test copy with `APP_ENV=test`, so sends are
  logged, not sent (D-69), and any send line fails the template. Templates
  whose setup needs GitHub connected (`setupNeeds`) are skipped. The results are read once at start
  (`templateResults.js`): a template is tested only while its newest result passed, for its
  current `templateFingerprint` (sha256 of the key-sorted file) and the current
  `behaviourFingerprint()`: sha256 of every file `BEHAVIOUR_SOURCES` names (Mercbot's rules and
  skills, `@jskit-ai/agent` and `agent-runtime`'s `src` as installed, the setup tools, approvals,
  drafts and sending, the chat kind's provider and model), each by its path in the list and its
  content, worked out once at start, the same on every server of a release (D-79). A result without
  `behaviour` (one recorded under the old generation number) counts for none. Outside staging and
  production, `MERCBOT_TEST_TEMPLATE_RESULTS` names another results file, as Test Previews do. `npm test` ends
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
  Test Preview's AI (D-83), so a template's setup interview can be walked through there by hand. It
  also says any bot's additions when asked, and changes them through `change_additions` when told
  to (D-98), for the browser suite.
- **Adding:** the share page's button opens Mercbot at `/?template=<code>`, which carries on into the
  home and opens New bot with it chosen: everything opened out, then the name and look (the
  template's own to start) and Create (`POST …/bots` with `{ library }`); a bot a person shared is
  added with **Add bot** there, as they made it. Nothing is added before. Owners and admins may also
  install the paired app as a draft. `POST …/bots/from-template {slug}` makes the
  bot with the template's name and look, pointing at it (`library_template`; for a template a link
  opens, a new home template made from it, `home_template_id`, its tag from its own or its name made
  free with `freeTag`), with no additions, and greets the person in their direct chat with it with the
  template's greeting and the person's real first name (none rather than an account handle).
  Routines aren't copied: the setup interview creates them paused, and they start only on a yes.
- **Where:** the gallery, details, the checks' results and adding are `templateGallery`,
  `templateDetails`, `templateChecks` and `addFromTemplate` in `botTemplates.js`; the bot's own job and
  skills reach the model through `instructionsFor` (`botAgent.js`), and `read_skill`,
  `create_routine` (`paused`) and `update_routine` (`running`) in `skillTools.js` and `routineTools.js`.
- **Template plus additions (D-98):** every bot points at one template, one of Mercbot's library
  (`library_template`: a file's slug, or `general`, the all-round helper defined in `templates.js`,
  which isn't in the gallery and is every bot made without one) or one of its home's
  (`home_template_id`, a `home_templates` row; the key includes the home, so never another home's,
  and a template in use can't be deleted), never both; plus `additions`, its own text. Every
  template has a tag (2–10 lowercase letters or digits, unique across the library; a home's are
  unique in the home and never a library tag), which `templateChipOf` (`botTemplate.js`) gives every
  listed bot as `template: { tag, source, description }` with `hasAdditions` and `additionsLine`;
  the list reads all its bots' home templates in one read (`withSummaries`). `templateOf` reads a
  bot's template in full, read with the call's options, and `instructionsFor` gives the template,
  then the additions, then the template's skills, below Mercbot's own rules (which win; the template
  wins over the additions); `read_skill` opens the template's skills by name. A library template's
  `changes` (dated lines, newest first) and a home template's `home_template_changes` give Details
  the newest change since the bot's `template_since`. Neither the tag nor `changes` is in the
  template's fingerprint, so neither resets Tested.
- **Change template:** `PUT …/bots/:botId/template {library: slug} | {home: id}` points a bot at
  another template (`changeTemplate`): the bot's maker and the home's owners and admins only (403),
  a library slug or one of the home's templates (404 otherwise, a choice is required: 400), the same template changes nothing; it keeps its additions, posts an event "Now a
  <tag> bot" and the template's greeting under the bot's own name, which asks its setup questions.
  `GET …/home-templates` lists the home's templates with how many bots use each (one aggregate read)
  and `canManage`, and `GET …/home-templates/:id` gives one in full with its `updatedAt`, for everyone
  in the home. `{ draft, foldAdditions }` keeps a draft as a new home template and points the bot at
  it in one transaction, emptying its additions only when `foldAdditions` is true.
- **Drafted templates (D-98, amended 20 November):** `POST …/bots/templates/draft` with
  `{ purpose: "new" | "from-bot" | "change", botId?, describe?, draft?, request?, foldAdditions?, templateId? }`
  answers `{ draft, problems }` and keeps nothing (`createTemplateDrafts`, `templateDrafts.js`): one
  `generateOnce` on the chat kind, metered as chat work to the home, the person and the bot, refused
  while the home is paused; an answer that isn't a whole valid template is asked for once more with
  its problems (a second call), then refused 422 `bots_template_draft_failed`. From a bot it needs
  `mayChangeBot` (403) and reads only the bot's template, its additions when folded, and, from the requesting
  person's direct chat with the bot (never a chat with others, whose words would go into a template the whole home
  sees), that chat's newest summary and the bot's routines there; another home's
  bot or template is 404. Every body is checked whole by `templateProblems`
  (`packages/bots/src/shared/templateBody.js`, the draft screen's rules too; 422
  `bots_template_draft_invalid` with `problems`), and only its five parts are kept. `PUT
  …/home-templates/:id { draft, updatedAt }` (owners and admins: `workspace.settings.update`, 403)
  saves an edit, 409 `bots_template_stale` when `updatedAt` isn't the template's, and records a
  `home_template_changes` line naming the parts changed and who changed them; `DELETE
  …/home-templates/:id` removes one no bot uses (409 `bots_template_in_use`). The draft screen
  (`MercbotTemplateDraft.vue`, `templateDraft.js`) serves a suggested new bot's Edit in Add bots (D-109), Change
  template (Make a new template, Start from this bot) and Settings → Templates (`MercbotSettingsTemplates.vue`); the
  stand-in model answers drafting calls with fixed drafts for the browser suite. Purpose `plan-bot` writes a suggested
  bot's template on the name, tag and job the plan gave it, told the others' jobs (at most 7; 400
  `bots_template_draft_bot`, `_team`, `_tag_taken`): the draft keeps that tag and must say "Ask before anything leaves
  this chat." or "Nothing leaves this chat without the person's yes" (`ASKS_FIRST`), else it is asked once more. Every
  draft's system prompt lists how Mercbot's own templates are written.
- **Teams (D-105):** `bot-templates/teams.json` (not a template: `templateFiles()` leaves it out) lists twelve teams,
  each `{ id, for, name, description, templates }`, checked at start (`teams.js` `checkTeams`: `for` home or work
  (D-109), every slug a library template, once per team; ids and names distinct). `GET /api/templates` lists them as `teams`. `GET
  /api/w/:workspaceSlug/teams/:teamId` (`botTeams.js` `teamFor`) answers the team and each bot's slug, name, look, tag,
  line, `appTemplate` and `inHome`: whether a bot of the home follows that template (one read, `followedOf`). `POST
  …/teams/:teamId {templates}` (`addTeam`, through `make`, which `addBots` shares) makes the chosen bots in the
  team's order, in one transaction, under the home's lock, through `botList.makeBots`, the function New bot's
  `createBot` makes its bot with (`records/newBotRepository.js`), in the same statements whatever their number; each
  takes its template's name and look, joins the team and opens no chat of its own: none starts any AI work, and each
  greets with its template's greeting when someone first opens a chat with it. The main bot introduces them in the
  person's welcome chat with a Message for each (`genesis/program/bots/onboarding.md`). Templates already followed
  are `skipped` (an archived bot on one says so, `archivedInHome`); only those is 409
  `bots_team_all_in_home`; an unknown team, an empty choice or another team's template is 400; anyone in the home may
  (JSKIT refuses outsiders: 403 at this pin, 404 from workspaces-core 0.2.58). It answers the home's bot list, with
  `added` (in the team's order), `skipped` and the welcome chat that introduces them (`chatId`). The page shows teams with one component, `MercbotTeamScreen.vue`:
  the cards under For home and life and For work (`teamChoice.js` `teamGroups`: name, line, faces, how many bots),
  with "Want one made to fit?" to Describe, then a team's bots, all ticked, each with its paired app's box for
  someone who may set it up, and an action that counts the ticks ("All sets" back to the list). Add bots' A ready-made set and the welcome
  chat's card (**Show me ready-made teams**, `addBots: "teams"`) open it (`useNewBot.js` `openTeams`,
  `addTeam`), which sets up a ticked bot's paired app afterwards as One bot does, each app once. New home asks only
  the name (D-109).
- **Suggested bots (D-109):** `POST /api/w/:workspaceSlug/bots/plan {describe, plan?, change?}` (`botPlans.js`
  `propose`; 600 characters each, 400 `bots_plan_describe_*`, `bots_plan_change_*`; 402 in a paused home before the
  model) is one `generateOnce` on the chat kind, metered as chat work. Its system prompt (`planSystem`: every library
  bot a line, the teams, the rules; the same for every home) and user message (`planPrompt`: the home's name, whether
  more than one person is in it (`everyoneIn`), its newest 100 bots, past 60 by name and tag, its first 40 templates by tag, the request, and for a change
  `planBefore`, the plan before as the server knows it) are read back by `readPlan`: 1 to 8 bots, at most 4 new, as
  `{library}`, `{home, name}` or `{new: {name, tag, description}}` with why, or one question, and `covered`; a new
  bot named as a library bot becomes it, a bad or taken tag a free one from its name, a bot named twice once; the rest
  is asked for once more, then 422 `bots_plan_failed`. The answer adds each bot's key and look (library bots their own,
  the rest picked fresh) and `inHome`; nothing is kept; the reads are the same for any number of bots
  (`newBots.homeBots`, `homeTemplates.list`, `followedOf`). `POST …/bots/batch {bots}` (`botTeams.js`
  `addBots`; each `{library}`, `{home, name, shape, color}` or `{draft, name, shape, color}`, at most 8 and 4 drafts,
  400 `bots_add_*`) makes them through `make` as a team's are, each draft checked whole (422).
  The page: `MercbotDescribeBox.vue` on Add bots' start, `useBotPlan.js` (the plan, each new bot's `plan-bot` draft
  written at once, ticks, a change keeping drafts, the batch) and `MercbotPlanReview.vue` (the groups, View, Asks first,
  Read it all, Edit on the draft screen, Try again and Remove, Not quite right?, Add N bots). The stand-in
  model plans library bots named by tag or name and one new bot for a request's last word, and a question for under
  three words.
- **The upgrade (D-98)** ran once: it pointed an unchanged gallery bot at its library template, a bot with no
  instructions at `general`, and a bot with its own at a home template made from them. The chats migration (D-112,
  `migrations/20261122120000_chats_core.cjs`) then dropped its copy `bots_before_templates` and the old columns
  (`label`, `instructions`, `skills`, `origin`).

## Owned data

- `bots.library_template`, `bots.home_template_id`, `bots.additions`, `bots.template_since`;
  `home_templates` and `home_template_changes`.

## Proved by

- `tests/server/botTemplates.integration.js`
- `tests/server/templateChecks.test.js`
- `tests/server/templateCheck.integration.js`
- `tests/server/templateDraftPrompts.test.js`
- `tests/server/teams.test.js`
- `tests/server/teams.integration.js`
- `tests/server/botPlans.test.js`
- `tests/server/botPlans.integration.js`
- `tests/client/templateBadge.vitest.js`
- `tests/client/templateDraft.vitest.js`
- `tests/client/teams.vitest.js`
- `tests/client/botPlan.vitest.js`
- `tests/e2e/templates.spec.ts`
- `tests/e2e/template-drafts.spec.ts`
- `tests/e2e/new-home.spec.ts`
- `tests/e2e/team-add.spec.ts`
- `tests/e2e/add-bots-describe.spec.ts`
- `tests/server/templateDrafts.integration.js`
