# Test speed plan

Where the whole suite's time goes, what was fixed, and what is left, measured on the test hosts (27 Nov 2026). Times
are wall times unless marked summed (the files' or tests' own times added up, which doesn't depend on how many run at
once). The person's workspace has 5 CPUs: `jskit test` runs 5 test files at a time there (`V64_TEST_CONCURRENCY`, else
half the CPUs) and the browser suite half that many workers (`browserTestWorkers()`), so 2.

## Measured

| Section | Baseline: main 47ab07e's tests, JSKIT 0.2.110, budget 10 | JSKIT 0.2.113 and the fixes below, budget 5 |
| --- | --- | --- |
| `npm ci` | 14 s | 19 s |
| genesis check, `jskit check` | 3 s, 5 s | 2 s, 7 s |
| lint | 31 s | 32 s |
| node tests (`npm test`) | 19 s; 96 s summed; 660 tests, 19 skipped | 19 s; 67 s summed; 660 tests, 19 skipped |
| database tests | 144 s; 905 s summed; 649 tests, 1 failed, 10 skipped | 177 s; 677 s summed; 649 tests, 10 skipped |
| migration history | (none) | 6 s |
| client tests | 11 s; 450 tests, 2 failed | 21 s; 450 tests |
| browser tests | 163 s; 661 s summed; 5 workers; 169 tests, 3 failed, 1 skipped | 381 s; 688 s summed; 2 workers; 169 tests, 1 failed, 1 skipped |
| whole | about 6.5 min | 11 min |

Both on one test machine (20 threads); the second (a541f82's whole) ran while the host's load was 21-38 on 20 threads, so its files took
longer than on a quiet host. Its one failure was a fourth place of the Invite defect below, fixed in 720e7f7.

720e7f7's whole, the landed tree, on another test machine (8 threads, budget 4) passed every part in 864 s: node tests 35 s (660
tests, 19 skipped), database tests 293 s (649 tests, 10 skipped), client tests 24 s (450), browser tests 461 s (169
tests, 1 skipped).

Every failure was already on main, where `npm run verify` never ran the database or browser suites:
`oldPermissionColumns.integration.js` (b8a3337's new `app_tables.access` matched the check for the old columns),
`recordFileField.vitest.js` (fa71f68 read `window` while the field set up) and the Invite specs (JSKIT's SelectField
names its loading bar after the field, so `getByLabel` found two elements). Each is fixed in its own commit.

The 29 skipped tests (`driveMount`, `fileMoves`, `commandOutput`) need the toolbox (`npm run tools:install`); only a
machine with it runs them.

## Where the time goes

- Browser tests set the whole's wall time: 688 s summed on 2 workers is at least 344 s. Setup is 13 s (template 0.8 s,
  build 5.8 s, fixtures 8.4 s, two Test Previews 4.2 s). The slowest specs, summed: `shell` 68 s, `pinned-chats` 45 s,
  `apps` 36 s, `views` 33 s, `chats-people` 30 s, `startup` 27 s, `final-sweep` 25 s, `knowledge` 24 s.
- Database tests: 677 s summed on 5 at once is at least 135 s. Each file has its own process, imports and copy of the
  template (median 0.4 s), about 2 s in all; that is the price of files that can't see each other's rows, and stays.
  The slowest files: `templateCheck` 27 s (seven whole setup interviews on the stand-in model: real work),
  `resilience` 18 s, `notices` 16 s, `viewsRealUse` 13 s, `singleUser` 12 s (restarts a real server: the behaviour
  under test), `discuss` 12 s, `joinInChats` 12 s, `botRequests` 11 s.

## Fixes

| Cause | Saves (summed) | State |
| --- | --- | --- |
| `filesBucket.test.js` waited out a real 1.1 s pull six times; its servers now share a clock the test moves (`createFilesVolume({ now })`) | 6.6 s | fixed |
| `notices` and `viewsRealUse` waited out the 2 s reconnect pause five times, plus pauses sized to it. The tests now move notices' own clock (`tests/support/moduleClock.mjs` holds the timers one module sets and fires them in order), so notices take no timing options; notices' five tests take 0.8 s in all, where the file took 17 s in 720e7f7's whole | about 16 s | fixed |
| A test's own servers and features started from the test process's whole environment, so a provider key set there reached them; they start from `testServerEnv()` (`tests/support/testEnv.mjs`), and `testEnv.test.js` proves no key there reaches one and no test spreads the whole environment | (a safety fix, not speed) | fixed |

Left, by estimate from reading the code (not measured), largest first. Each keeps every assertion; the ones marked
judgement need the person or the Master pass to agree:

| Cause | Saves (summed, estimate) |
| --- | --- |
| Per-test setup in the bots database files (a new connection pool and five features started for each test of `resilience`, `joinInChats`, `discuss`, `botRequests`): share them per file (judgement: no test may rely on fresh feature caches) | 25-35 s |
| Screenshots nothing compares, in `apps`, `knowledge`, `instructions`, `views` and `startup`: take them only when `SHOTS_DIR` is set (judgement: someone may look at them) | about 10 s |
| A reply the chat asked for waits 600 ms before it shows (`useChatWork.js:104`), about 14 times in `shell`, `knowledge` and `instructions` (judgement: a product change) | about 8 s |
| `knowledge` waits out its 2 s poll (`useBotKnowledge.js:10`) three times: `page.clock` with `skipPause`, as onboarding already does | about 6 s |
| `startup` repeats its whole flow at four widths: one flow, its geometry checked at each width (judgement) | 4-6 s |
| `shell`'s stand-in replies poll six calls with the default backoff: one call, polled every 100 ms | 2-4 s |
| `views` adds a contact through a second page twice: the records API instead (judgement) | 3-4 s |
| `final-sweep` opens the whole shell where only one test needs it (judgement) | 3-4 s |
| `instructions` loads its page twice on a desktop | about 2 s |
| `templateChecks.test.js` runs six child processes one after another: at once | 1.5-2 s |
| `botRequests` waits 200 ms for each retry, resume and next turn: 20 ms | 1-1.5 s |
| `templateCheck` polls a busy reply every 1 s | 0-3 s |

## Onto JSKIT's own test harness (not started)

Mercbot's node suites and browser suite run on harnesses of their own (`tests/support/testRun.mjs`, `testFile.mjs`,
`testDatabase.mjs`, `tests/e2e/globalSetup.mjs`, `start-test-app.mjs`), written before JSKIT had them. JSKIT now
ships each (its speed pass guide). Moving onto them is one change across the suites, after updating JSKIT to its
newest release, and a copy built on Mercbot that runs Mercbot's suites moves with it:

1. Database tests: `jskit test --databases` gives each file its own database restored from a snapshot rebuilt when
   the migrations' digest changes, in place of the template and copies Mercbot makes itself.
2. Names: database test files become `<name>.integration.test.js`, so `npm test` runs every node file and
   `npm test -- <file>` runs one, as JSKIT's run rules expect; `test:files` goes.
3. Time bounds: JSKIT's (10 minutes a file, 45 a run, `test-time-bounds.json`) in place of `testFile.mjs`'s and
   `testRun.mjs`'s own.
4. Browser tests: `browserTestConfig()` (JSKIT's browser test server) builds the production frontend once and gives
   each worker its own server, port and seeded database, in place of `globalSetup.mjs` starting Test Previews.
5. The build: reused while its sources' digest is unchanged, where every browser run builds again (5.8 s).

Each keeps every test and assertion, and each is measured before and after with one whole run of the part it changes.

## Test quality (27 Nov audit)

The 30 newest test files and the 20 slowest were read for what each test proves (counts are of those 50 files; a test
can be in more than one class), and mutations were run to check the doubtful ones: a test that passes with the
behaviour it names broken proves nothing about it.

| Class | Tests | Examples |
| --- | --- | --- |
| One long story test for a whole decision or feature | 18 | `appsWatches.integration.js:44` (titled "each change once", also the limits, paging and `whyNotRun`), `singleUser.integration.js:97` (about 60 assertions for about 12 behaviours) |
| Title promises more than is checked | 16 | `appsWhoActed` (a name changed, still passes), `appsAi` (taking 8 entries for 20, still passes), `views.spec.ts:113` (clears the stored skip before the reload it claims to test), `templateCheck.integration.js:145` |
| A loose bound, a regex for one word, or an optional check where the value is known | 18 | `appsSending.integration.js:127` (`>= 9` for 12), `appsLists.integration.js:52` (`> 0` for 25), `appRequests.test.js:117` (±1 s on whole seconds) |
| Asserts a stand-in's own rule or the test's own setup | 3 | `appsConnected.integration.js:157`, `:192`, `appsLinkChoices.integration.js:99` |
| "Never X" with nothing showing X could happen | 3 | `appConnected.test.js:221`, `appsRollups.integration.js:115`, `pinned-chats.spec.ts:258`, `singleUser.integration.js:274` |
| Not at the cheapest level | 8 | `apps.spec.ts:300` (a server refusal through a browser), `startup.spec.ts:309` (cache headers), `botRequests.integration.js:147` |
| Implementation details | about 21 | `apps.spec.ts:319` (`v-btn--active` for pressed), `shell.spec.ts:86` (exact request sequence), `notices.integration.js:243` (counts private timers by stack path) |
| Duplicates | about 12 | `startup.spec.ts:99` (same flow at four widths), `templateCheck.integration.js:137` repeats `templateChecks.test.js:322` |
| Timing-dependent | about 10 | three tests compare against today's UTC date from the real clock; `resilience.integration.js:159` overlaps two requests by a 200 ms sleep |
| State shared across tests | 11 | `apps.spec.ts` and `views.spec.ts` run serially and chain on each other's data; `apps.spec.ts:236` changes the home's look and never restores it |

Mutations that survived (the named test still passed with the behaviour broken), and the test that now fails with
each, run against it on the test hosts (27 Nov):

| Mutation | Test that now fails with it |
| --- | --- |
| `runtime.js`: a screen's search ignores its filter | `appsLists`: exactly the 25 open Acme rows |
| `formulas.js`: an unknown zone falls back to another zone than UTC | `appsDates.test`: today in three zones on a fixed clock |
| `scriptPeople.js`: the presser's name is another | `appsWhoActed`: "Kim (member)" |
| `scriptAi.js`: the Logic tab takes 8 jobs, not 20 | `appsAi`: the newest 20 by id |
| `appSending.js`: every send went to one address | `appsSending`: the exact activity |
| `appMessages.js`: a broken mailbox is offered | `appMessages.test`: the connected Gmail and Outlook mailboxes |
| `appMessages.js`: every member counted a manager | `appMessages.test`: owners and admins, beside every member |
| `appStyle.js`: a view's CSS dropped | `viewsRealUse`: the exact CSS |
| `templateResults.js`: a copy's own results ignored | `templateCheck`: the badge's date |
| `server.js`: the gate on a server started without it | `singleUser`: the ungated server answers without the key |
| `standInDesktops.js`: another manager | `standInDesktops.test`: the stand-in answers asleep |
| `visitorAccess.js`: a visitor gets every field | already failed `appsVisitorAccess` |
| `AppFrame.vue`: a skipped copy update not stored | `views.spec`: nothing asked after a reload, asked again once storage is cleared |
| `AppTheme.vue`: the look's colour not applied | `apps.spec`: the app's primary colour is the look's |
| `MercbotKnowledgeSection.css`: the summary drawn in the surface's colour | `knowledge.spec`: the summary's contrast at least 4.5:1 |
| `appRuntime.js`: a chart's counts off by one | already failed `tests/client/apps.vitest.js` (the cheaper level) |

What led there: one long story test per decision, written with the decision, whose title names every rule the
decision has; and stand-ins written to behave like the service, which then held the rule the test meant to check.
AGENTS.md's Tests bullet now says to assert what Mercbot did, exactly, one behaviour a test, and to set a product's
own waits short. Fixing each test above is the Master pass's review: each wrong test is replaced by a right one,
seen to fail first.
