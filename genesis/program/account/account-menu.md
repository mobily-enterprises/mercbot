# Account menu services

Records what every AI call, computer's day and command uses for its home, person and bot, with what each AI call cost
at its provider, reports the spending, answers who runs this copy, and keeps the Vault (D-16, D-17, D-56, D-73,
D-76, docs/architecture.md §3.8).

## Sources

- Main: `packages/account/src/server/AccountFeature.js`
- `packages/account/src/server/meter.js`
- `packages/account/src/server/usage.js`
- `packages/account/src/server/cost.js`
- `packages/account/src/server/jobs.js`
- `packages/account/src/server/spending.js`
- `packages/account/src/server/reports.js`
- `packages/account/src/server/retention.js`
- `packages/account/src/server/tableResources.js`
- `packages/computer/src/server/computerDays.js`
- `packages/account/src/server/accountService.js`
- `packages/account/src/server/registerRoutes.js`
- `packages/account/src/server/vaultEntry.js`
- `packages/account/src/server/vaultPhoto.js`
- `packages/account/src/shared/vault.js`
- `packages/account/src/server/accountError.js`
- `packages/account/src/server/types.js`
- `packages/account/src/server/providers/index.js`
- `packages/account/src/server/providers/together.js`
- `packages/account/src/server/providers/deepinfra.js`
- `packages/account/src/server/providers/gemini.js`
- `packages/bots/src/server/model.js`
- `packages/account/src/server/vaultCrypto.js`
- `packages/account/src/server/publicAddress.js`
- `packages/account/package.json`
- `migrations/20261113120000_baseline.cjs`
- `tests/server/vault.test.js`
- `tests/server/vault.integration.js`
- `tests/client/vaultImport.vitest.js`
- `tests/e2e/vault.spec.ts`
- `tests/server/aiKinds.test.js`
- `tests/server/testPreviewAi.integration.js`
- `tools/previewAi.mjs`
- `packages/account/src/server/keys.js`
- `tests/server/keys.test.js`
- `tests/server/meter.test.js`
- `tests/server/computerDays.test.js`
- `tests/client/spending.vitest.js`
- `src/components/mercbot/spendingView.js`
- `src/components/mercbot/usePriceTags.js`
- `src/components/mercbot/MercbotSpendingReport.vue`
- `src/components/mercbot/MercbotSpendingChart.vue`
- `src/components/mercbot/useShellDialogs.js`
- `src/components/mercbot/accountApi.js`
- `src/components/mercbot/MercbotAccountMenu.vue`
- `src/components/mercbot/MercbotAboutDialog.vue`
- `src/components/help/HelpCentre.vue`
- `src/components/help/helpGroups.js`
- `tests/client/helpGroups.vitest.js`
- `src/components/account/settings/AccountSettingsUsageSection.vue`
- `src/components/mercbot/MercbotSettingsDialog.vue`
- `src/components/mercbot/settingsSections.js`
- `src/components/mercbot/extensions.js`
- `tests/client/settingsSections.vitest.js`
- `tests/e2e/settings-sections.spec.ts`
- `src/components/mercbot/MercbotSettingsGeneral.vue`
- `src/components/mercbot/MercbotSettingsPermissions.vue`
- `src/components/mercbot/MercbotSettingsComputer.vue`
- `src/components/mercbot/MercbotSettingsVault.vue`
- `src/components/mercbot/MercbotVaultImport.vue`
- `src/components/mercbot/vaultImport.js`
- `src/components/mercbot/MercbotVaultPhoto.vue`
- `src/components/mercbot/vaultPhoto.js`
- `src/components/mercbot/MercbotSettingsUsage.vue`
- `src/components/mercbot/MercbotSettingsAbout.vue`
- `src/components/mercbot/MercbotSettingsSelect.vue`
- `src/components/mercbot/MercbotSwitch.vue`

## Public contract

What Mercbot's own outside requests may reach: `@local/account/public-address` gives `isPrivateAddress`,
`publicLookup`, a DNS lookup for node's requests that refuses a name leading to a private address, so the
address actually connected to is the one checked, and `publicFetch`, a fetch through both that never follows a
redirect itself. A refusal's error has the code `PRIVATE_ADDRESS`. Scripts' web calls (apps), pages' copied files,
the general connector's requests to apps (integrations, through `publicFetch`) and the storage and read-back of a
website set up by someone who doesn't run the copy (websites) use them.

Metering (D-56, D-73): work done for someone runs inside `track({ userId, botId, workspaceId })` from
`@local/account/meter`. Bots routes, routine runs and computer work forwarded to another server run inside it. Every AI
request (bot replies, rules, status lines, compaction, scripts, Stagehand, pictures and the Vault's photos) goes through
`aiFetch(env, work)` (`@local/account/model`), whose `createMeteredFetch(env, provider, { kind, purpose })` records it
as the kind of AI its work runs on: the meter's recorder opens the call before it goes out (with its size, the longest
reply it asks for and the pictures it asks for: Gemini's image output, `candidateCount` of them), and the call doesn't
go out when opening it fails; then the meter reads the provider's own figures (cache-hit, cache-miss and output tokens
in DeepSeek's, the OpenAI-style or the Anthropic form, Gemini's `usageMetadata` and its pictures, or a stream's last
usage) and finishes the call before handing back its answer, a streamed reply when its stream ends. A failed call used
nothing; a cut or figureless call is recorded as an estimate from its size. A call made outside tracked work belongs to
no one: it goes out unrecorded, with a warning. A computer's day (UTC) is opened as it wakes and counted once it has
started (computerManager's `withDay`, `meter.startComputerDay`), so one that can't start counts nothing, and is counted
when a new day finds it awake (`computerDays.js`, `meter.computerDay`, which puts it to sleep when that's refused).
Commands' computation is opened ten minutes at a time (`meter.startComputation`, `COMPUTATION_BLOCK_SECONDS`);
`shell.js` renews it while a command runs, stops the command when a renewal is refused, and records the seconds it ran.

Mercbot's own recorder (`usage.js`, `createUsageRecorder`) counts each finished piece of work for its home, person and
bot (a bot's home, maker and name are read once every ten minutes) and never refuses or stops any: opening always
answers, a command's renewal always says yes, and `pausedMessage` is null for every home. An AI call's cost
(`cost_nano`, whole nanodollars in bigint) is what its provider reported (DeepInfra's `estimated_cost`), else its tokens
at the provider's list prices (`providerCostNano` in `cost.js`: Gemini's picture model's for pictures, its reading
model's, `readingPrices`, for the rest); a computer's day and a command's seconds are counted as use with no cost. Each
finished piece of work adds to `usage_daily` (by home, day, bot, person and kind, kept 13 months) and `usage_monthly`
(by month, kept for good), and an AI call and a computer's day keep their own row in `usage_events` (kept 14 days in
daily partitions), in one transaction, again if a first use of a row raced another server's. `computer_days` keeps the
day each computer was last counted, so a day is counted once however often it wakes. The measures are calls (days, for
a computer; none for commands), estimated calls, cache-hit, cache-miss and output tokens, images, seconds and
`cost_nano`. `spentSince({ workspaceId, userId, botId, since })`, a goal's spending in dollars, adds up the calls' own
rows while they're kept and the daily totals after that. The account keeps these four tables with what work used and
its cost, and the archive's claims in a table of their own, `usage_jobs`.

A copy built on Mercbot may record work its own way (`mercbot.usage-recorder`, an optional capability, `UsageRecorder`
in `types.js`). The meter then calls its `open`, `finish`, `release`, `startComputerDay`, `countComputerDay`,
`computerDay`, `startComputation`, `renewComputation` and `finishComputation` in place of Mercbot's own, and the meter's
`spentSince` and `pausedMessage` are its. Its `open`, `startComputerDay` and `startComputation` may refuse work before
it starts by throwing `refuseWork(message, { code, notice })` (`@local/account/meter`: a 402 carrying `params.notice`,
what a bot says in place of the work), and its `renewComputation` by answering false. Its `spending` (`summary`,
`priceTags`, `report`, `exportCsv`) answers the spending routes in the same shapes, which it may add to, and its
`archivedColumns` are the whole-number columns it adds to `usage_daily`, archived after Mercbot's own and summed in the
archive's check. `createSpending` and `createReports` take `spend`, the totals' measure that is what was spent
(`costNano` unless a copy names another). Without such a copy, the account uses its own recorder, `spending.js` and
`reports.js`.

Work refused before it starts: `refusalOf(error)` (`@local/account/meter`) finds a 402 in an error or its causes and
answers its message and notice. Mercbot itself never refuses, but its code says why when a copy's recorder does. While
`meter.pausedMessage(homeId)` answers a message, new replies, routines, Apps tasks, goal rounds, group replies, template
drafts, teaching and computer wakes don't start (402 `work_paused` for a bots route); running steps finish, and nothing
is deleted. A bot says the notice to each message a person sends, and once for background work (routines, Apps tasks
and watches: `pausedNotice` in `backgroundRuns.js`), whether the home is paused before the turn or a step's work is
refused part-way (botReplies' `pausedTurn`); a group gets the paused line, a lesson the notice and a template draft
nothing drafted. A refused computer's day keeps it asleep with the message, a refused command answers `unavailable` with
it, a command whose renewal is refused stops ("It was stopped because its home's work is paused."), and a refused Vault
photo sends nothing. The page counts every 402 (`refusedWork` in `accountApi.js`, into `workRefusals`), so a shell part
a copy adds can read again at once.

Spending (`spending.js`, `reports.js`), read from the totals, never by adding up calls; days and months are UTC's.
Owners and admins see the whole home, a member their own use (`readerOf`: managing is `workspace.settings.update`).
What's spent is the totals' `cost_nano`, what the work cost at its AI providers. `GET /api/w/:home/usage` answers
`{ scope, month, monthNano, note, attention, action }`: this month's spending the reader sees, and what a copy built on
Mercbot adds under it in the account menu (a line, whether it needs the reader's attention, and the label of an item
that opens Settings → Spending; null, false and null in Mercbot's own). `GET …/spending?from=&to=` is a report of 1 to
366 days, `{ scope, from, to, daysKept, totalNano, byDay, byKind, byBot, byPerson }`, each row with `spentNano`, by day,
kind, bot and, for owners and admins, person: from `usage_daily` within its 13 months, and a whole older month from
`usage_monthly`, without days; any other range older than 13 months is 400 `report_range_too_old`.
`GET …/spending/export?from=&to=` is the same as a CSV, one line per day, or per month for an older month, bot, person
and kind, with the columns Bot, Person, Kind, Uses, Pictures, Seconds and Spent (USD), streamed a page of totals at a
time, formula-like names prefixed with an apostrophe. `GET …/spending/bots` is each bot's price tag,
`{ bots: [{ botId, monthNano, allNano }] }`: this month and all time.

Retention (`retention.js`), every server each hour: `mercbot_charge_partitions()` (the migration's) makes the
partitions ahead and drops per-call days older than 14 whole. Each month of daily totals older than 13 months is
claimed in `usage_jobs` (`claimJob` in `jobs.js`: one server at a time, and a claim left by a server that died is taken
by another after an hour), written to `<MERCBOT_FILES_DIR>/usage-archive/daily/YYYY-MM/homes-<from>-<to>.csv.gz` (one
file per 100,000 homes by id, with a copy's `archivedColumns` after Mercbot's own), read back and checked against the
database (its rows, and the sums of `cost_nano` and the added columns), and its partition dropped by the server holding
the claim with its row locked; archives older than seven years are deleted. A configured files volume that isn't
mounted is never written to. Every server also sweeps once as it starts serving.

Providers (D-16): Mercbot runs on the deployment's own provider keys. It has three kinds of AI (D-72), `AI_KINDS` in `providers/index.js`: the premium AI,
the slower, cheaper AI and images. Each has two settings, `AI_<KIND>_PROVIDER`, the type, which picks the provider's layer,
and `AI_<KIND>_API_KEY`, and accepts one type for now: `together` (Together AI, DeepSeek's Flash model), `deepinfra` (the
same model at DeepInfra) and `gemini` (Google's Gemini image model). A provider's layer is one module in `providers/`:
its API address, model, list prices, billing page, and what its API needs (DeepInfra's thinking and Flex tier and its
balance, Gemini's pictures). Every kind is optional: `startServer` refuses to start only while a kind names a type it
doesn't accept (`checkAiSettings`), with one sentence per setting to fix; a provider setting's value is said back only
when it looks like a type, so a key put there by mistake never reaches the log. `aiReady(env, kind)` says whether a kind
has an accepted type and a key, and `aiSettingsNeeded(env, kind)` names the settings it still needs; `aiFetch` for a
kind that isn't ready fails at once, naming them, and sends nothing. Without the premium or the economy AI, bots are
off: `botsAiOff(env)` is the sentence a bot says in place of new work ("Bots can't work on this copy of Mercbot yet:
its AI isn't set up. Whoever runs it sets …, then starts it again."), and `botsMeter` in
`packages/bots/src/server/model.js` gives it to the bots feature as every home's pause, through the meter's
`pausedMessage` (D-73): bots start nothing new and say why, and a new bot's welcome uses its standard words. Tests built on
`createServer` skip the check.

Every key a copy can be given (D-72, amended 2026-11-12): `KEYS` in `packages/account/src/server/keys.js` lists each
one, what it's for, the settings that give it and what's off without it, from the AI kinds to the public address,
the Vault key, email, the apps to connect, visitors' sign-ins, the human check, the files volume and another Mercbot to
link to. Mercbot starts without any of them. `startServer` logs one line for each setting a feature that's off still
needs (`missingKeyLines`: "<SETTING> isn't set, so this is off: <name>. <what's off>"); a kind on the stand-in model is
on without its key. `keysOf(env)` gives each key's settings, whether each is set (never a value) and `set`, `partly`
or `missing`, for a screen that lists them. Both take a list of entries in `KEYS`'s shape as well, `KEYS` by default,
for a copy built on Mercbot that lists and checks its own keys the same way.

A test copy's stand-in model (D-83): with `MERCBOT_TEST_AI_URL` set, outside production and the live copy
(`standInAddress`), `aiKind` gives every kind its provider's layer with the stand-in's address (`<url>/<kind>`) in
place of the provider's, no balance or billing page, the name "Stand-in model, in place of <provider>" and
`standIn: true`; no key is needed (startup's check skips it) and none of the provider's is sent. `aiFetch` then sends
only under that address and refuses any other before it goes out, and Gemini's layer is called with the layer's
`baseURL`, so pictures and photos go there too. A screen that lists the kinds can say from `standIn` that the key
isn't needed. Every
Preview (`bin/develop.js`) and Test Preview (`start-test-app.mjs`) empties every credential-shaped setting and serves
Mercbot's stand-in model (`tools/standInModel.mjs`, through `tools/previewAi.mjs`, in tools/ so a composition keeps it)
on a local port and sets it, with each kind's type and no key, so nothing it asks of its AI reaches a provider;
production and the live copy ignore the setting and behave as before.

What each kind of work runs on (D-59, D-72) is one table, `WORK` in `providers/index.js`: people's chats and group
chats (a Builder's too), requests between bots, app buttons' tasks and the bots' browser steps on the premium AI; the
Builder's replies (`build`) on the slower, cheaper AI; background work (routines, watch runs, finished background
commands, goal rounds and summaries) on its Flex tier; pictures on images. The kind of work is carried by
`meter.track({ work })` and read with `currentWork()`. `modelSettings(env, work)` gives a text model client that work's
provider address, model, key and `aiFetch`; `createChatModel(env)` in `packages/bots/src/server/model.js` makes the
bots' one chat model, which the bots feature makes once and passes down (D-54), with a model per work, in the OpenAI
style. Pictures go through the images kind's layer (`makePicture` in `pictureMaker.js`).

Mercbot keeps no feedback or contact messages: a copy built on Mercbot adds its own.

Who runs this copy: the account's `runsThisCopy(userId, options)` (part of `mercbot.account`) is the one answer, which
a home's website asks before anyone chooses a folder on this computer (D-84). It asks `mercbot.copy-runners`, an
optional capability answering `runsThisCopy`: in Mercbot, the single-user package's, its one person (D-81); a copy
built on Mercbot that leaves that package out may name its own. Without it, nobody runs the copy, so nobody there can
choose a folder.

The AI providers' failures: `keepingErrors` in `meter.js` wraps each kind's fetch and, inside tracked work, hands every
request that throws (unless its caller stopped it; one that ran out of its own time counts) or gets an error status to
the meter's `recordError`, without waiting on it: the kind, provider, status and the provider's words up to 300
characters, `withoutSecrets` (the key, any word holding 8 of its characters in a row and any long token taken out). The
account feature's `recordError` is the `record` of `mercbot.provider-failures` when a feature provides it (an optional
capability, `AiFailures` in `types.js`), and otherwise `logAiFailure`: one line in the server log, such as "The images
AI's provider gemini failed with 500: Internal error". Mercbot keeps no table of them.

The first account-menu line is **Spending**, with this month's figure; its hover panel adds the month, whose figure it
is ("Everyone in this home" or "Your bots' work for you") or, in its place, the summary's `note` (shown as needing
attention when `attention` says so), an item named by the summary's `action` when there is one, and See spending; both
items open Settings → Spending (D-73). Above the composer the shell shows the parts a copy built on
Mercbot adds there (`extensions.js` `shellParts` whose `place` is `notice`): each gets `pulse`, the open conversation's
message count, and may emit `open-settings` with a section's `value` to open it. Mercbot adds none. The shell opens a
Settings section for `?settings=<section>` (a link in an email, or back from another site), takes `settings` out of the
address and leaves the rest for the section to read (`useShellDialogs.js`). Each bot in the sidebar shows its price tag
(`usePriceTags.js`), read again when a bot finishes working, when the home changes and when the page is shown again.
Settings → Permissions holds the auto-review switch and the Always ask and Allow without asking rule lists.

The account menu also has Help and support and Settings. Help and support opens a Help centre
tab on `/help`, the shortcuts sheet and About. A person's own copy has no other account and no signing out (D-81). A
copy built on Mercbot adds its own there (`extensions.js`): menu items (`accountMenu`, each `{ title, icon, place, run
}`, before Help and support for `place` `menu`, at the end of Help and support for `support` and at the menu's foot,
after Settings and a divider, for `foot`, such as Add another account and Sign out; choosing one closes the menu and
calls `run`), dialogs beside the shell's (`shellParts` with no `place`, each `{ component }`, given the open bot and
the shell's `notify` and `failure`, and holding the shell's shortcuts while its own dialog is open through the chat's
`holdKeys`, `shellChat.js`), tools beside a help page's Copy for AI and Plain text (`helpPageTools`), help pages
(`help/extensions.json`, which `helpGroups.js` adds to Mercbot's group of the same name or as a group after
Mercbot's, refusing a page listed twice) and what About says about updates (`aboutUpdates`, null for `updatesLine`).
About shows the version and build date from the build, and copies version, build time, channel and system.

Settings is a 900×655 window over the app, with a section
list on the left (General, Computer, Vault, Spending, About) and grouped
cards on the right. Every control applies at once. Ctrl+, and the menu's Settings
open General; the palette's section commands and See spending open their section.
×, Escape or a click outside closes it. The sections:
- **General:** the account (name, email with copy, Account details to the JSKIT
  account page, and the actions a copy built on Mercbot adds, `extensions.js`
  `generalActions`, each `{ title, confirm, run }`, such as Sign out, calling `run` once the person confirms when it
  has a `confirm`);
  Theme (saved to the account); Accent,
  Language (searchable, own name plus English name), Spell check (the message box)
  and Microphone (the browser's inputs); Timezone (searchable, with the time now);
  and the approval rules. Language, timezone, spell check and microphone are kept on the
  device. Replies send the language and time zone, and bots reply in that language.
- **Computer:** Update (always up to date) and Reset, which asks first and then calls
  `POST /api/computers/reset`. Each of the person's bots' computers sleeps on its
  owner server and has its browser profile deleted.
- **Vault (D-17):** tabs with counts, search, New item (login, card, contact info,
  Import from a CSV file), and dialogs that save only when valid. `GET/POST/DELETE
  /api/vault` keep items in `vault_items`. What makes an item complete is one set of
  rules, `packages/account/src/shared/vault.js` (`vaultProblem`), which the forms, the
  CSV import's preview and the server all check. Contact info is plain. A login's password
  and notes, and a card's number, code and billing address, are sealed with
  AES-256-GCM under `MERCBOT_VAULT_KEY` (32 bytes, base64); only the website and
  username, or the card's brand, last four digits and expiry, stay plain. Card
  numbers must pass the Luhn check and expiry is MM/YY. Without the key, logins and
  cards are refused with 503. Secrets are never sent back.
  - **Import from a CSV file** (`MercbotVaultImport.vue`, `vaultImport.js`): the file
    (at most 10 MB and 5,000 rows) is parsed in the browser with csv-parse; its column names
    are matched to the chosen kind's fields by the names password managers, browsers
    and address books use (`guessKind`, `matchColumns`), and the person can change
    each. The preview shows the count, the first five items with secrets masked, and
    the rows that can't be saved with their reason. `POST /api/vault/import` takes
    `{ kind, items: [{ row, data }] }`, 1 to 100 items (`VAULT_IMPORT_LIMIT`), runs
    each through `vaultEntry` and saves them in one `createMany`, all or none; a
    refusal names the file's row (`Row 3: …`, `params.row`). The client sends 100 at a
    time and stops at a refused batch, reporting how many were added; Import again sends
    only the rows not added yet.
  - **Contact info from a photo** (`MercbotVaultPhoto.vue`, `vaultPhoto.js` on both
    sides): Scan with camera (getUserMedia, on only while its view shows, which it does
    at once, so Cancel works while the browser asks) or Upload a
    photo makes a JPEG of at most 1600 px and posts it to `POST /api/w/:home/vault/read-photo`
    (multipart field `photo`, at most 8 MB, an image by its bytes). The server sends
    it once to the images kind of AI (D-72: `AI_IMAGES_PROVIDER=gemini`, `AI_IMAGES_API_KEY`;
    its layer's `readPicture`, model `gemini-flash-latest`, through `aiFetch(env, "photos")`
    inside the meter's `track` for the person and the home in the address, so a failure goes to the meter's
    `recordError` and the read is recorded for that home with what it cost, like any AI call, D-73; work a
    copy's recorder refuses (402) sends nothing and the person is told why)
    with a JSON schema of the contact fields but the label,
    keeps nothing, and answers `{ fields }` to fill the form, which says to check them.
    No key, or a key whose project has no billing (Gemini's 429 with `limit: 0`), is 503
    `account_vault_photo_unavailable`; Gemini's other 429s are 503
    `account_vault_photo_busy`, its other failures 502 `account_vault_photo_failed`
    (logged in one line, without the photo), and nothing read is 422. Cards are never
    read from a photo: a card's number never goes into an AI's prompt
    (docs/architecture.md §3.1 rule 2), so the card form's two photo buttons stay
    disabled and say why.
- **Spending (D-73, D-76):** this month (`AccountSettingsUsageSection.vue`, which the account page's Spending shows
  too), a report of a Day, a Week, a Month or a Custom range of up to a year with a chart by day and the totals by kind,
  bot and, for owners and admins, person, with Download CSV (`MercbotSpendingReport.vue`, `MercbotSpendingChart.vue`,
  `spendingView.js`), and How spending is counted: the AI providers' cost of the copy's own keys' work, as each reports
  it or at its list prices, with a bot's computer days and commands counted as use with no cost.
- **About:** the version, which updates itself.
- Sections a copy built on Mercbot adds (`extensions.js` `settingsSections`, each `{ value, title, icon, component,
  after, visible }`): one whose `value` is one of Mercbot's own sections takes that section's place (Mercbot's own
  shows while it's hidden), and the others are listed right after the section `after` names, else after About.
  Settings asks each one's `visible` once, the first time it opens, again after a failed answer, and shows those for
  everyone or whose answer was yes (`listedSections`). Mercbot adds none.

DeepInfra (D-58) serves the same model in the OpenAI style; its layer adds `reasoning_effort: high` to each call, because
it doesn't think unless asked. A Flex call that's refused or waits 2 minutes goes again at Standard.
