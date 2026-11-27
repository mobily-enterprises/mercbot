---
name: genesis-test-pass
description: Make a project's test suite prove what the software does, quickly, through an explicitly requested test pass over the whole app, a named section, or the agent's own changes, covering correctness (each behavior has a test that fails without it, nothing weakened, meaningful assertions at the cheapest level), isolation (each file owns its data, ports and files, and no test reaches a development or production database or a real outside service, proved with outbound network refused), speed (preparation once per run, files in parallel within the machine's test budget, no fixed sleeps), the run itself (one parallel run per part, scripts that fail on any failed part and name it) and the guidance that says exactly how the suite runs, each fix proved red first and each speed change measured before and after. Use when asked for a test pass, or to check, fix, isolate or speed up a project's tests.
---

# Genesis test pass

Make the test suite something every person and agent who works on the project
can trust: each behavior proved by a test that fails without it, each file able
to run beside any other, the whole suite as fast as its work allows, every run
naming every failure, and the project's guidance saying exactly how the suite
runs, so the next agent writes and runs tests the same way. A test pass is
explicit: never run it merely because implementation finished.

Run Genesis operations as the "Run Genesis commands" section of
`.agents/skills/genesis-project/SKILL.md` says, resolving the invocation once,
before the first one.

Follow the configured Collaboration approach for user-facing updates, including
its technical depth and response length. Report concrete progress,
findings, or blockers; do not announce that you are following guidance.

## Load the effective project instructions once

A test pass request may arrive as a complete Genesis-generated prompt or as a
direct request such as `Test pass` or `Test pass the Orders section`.

If the current task already contains `GENESIS CONTEXT` whose task is
`test-pass`, continue with it directly. Do not generate another prompt.

Otherwise, before resolving scope, run the Genesis `prompt --task test-pass`
operation once using the invocation rule above. For a bare `Test pass`
request, pass no request argument. When the user names a section, commits or
your own changes, pass that exact request as one safely quoted argument. Treat
the printed prompt as the instructions for this same turn; do not dispatch it
to another agent and do not generate it again. This step composes the selected
Stack's test pass guidance and any project customization with the portable
contract below.

When the user asks for a deep run of this pass, pass its Deep request,
`Test pass the whole app deeply.`, exactly;
Genesis then adds the run's `DEEP RUN` section.

## Resolve the scope

Inspect `git status --short` and the staged and unstaged diffs before editing.
A dirty worktree is allowed. Preserve the existing index and unrelated work; do
not stage, stash, commit, or discard changes as a prerequisite.

When the prompt has a `PASS RUN` section, the request is one of the pass's own
runs (the whole app, the changes since its last completed run judged against
the whole app, or a deep run) or a run over the changes since a base commit the
request names, and its scope is the one that section states, whatever the
defaults below say. A deep run's prompt also has a `DEEP RUN`
section; follow it with "Deep run" below.

- **The whole app (default).** The whole test suite and each of its parts
  (unit, database or integration, component, browser and any other), every
  test file and test helper, the fixtures and their preparation, the commands,
  scripts and configuration that run them, the continuous integration jobs
  that run them, and every piece of guidance that tells people and agents how
  to write and run tests.
- **A section.** A named area (a module, a subsystem, a test folder or one
  part of the suite): its tests, the behavior they prove, and the harness,
  scripts and guidance they use, touched or not.
- **The changes.** Your own changes for the current task, or explicit commits,
  established and resolved as for Deslop: the tests they add or change, the
  behavior they change and the tests that should prove it, and the harness,
  scripts and guidance they touch.

If the scope is ambiguous, ask which section or changes.

The review judges the work against what the software should do; this pass
judges the suite that proves it, as a product of its own. Where they meet, a
behavior with no test or a test weakened or skipped, this pass fixes what it
finds within its scope as any pass does.

## Read first

Read the engineering approach's "Your own test loop" and its rules on tests,
and these sections of the sanity checks guide
(`.agents/skills/genesis-project/references/sanity-checks.md`): "How to use
this guide", "Never do these", "Refactors keep behavior", "Failing tests are
bugs", "Tests: time", "Tests: your own loop", "Tests: each owns what it uses",
"Tests: nothing hangs or lingers", "Tests that prove behavior" and "Data:
loading a dataset". They describe what good looks like; this pass checks the
whole scope against them and fixes what they find.

The selected Stack's test pass guidance names, for its technology, the command,
file or check that proves each item below: its test runner and how it sizes the
machine's test budget, its test databases and their snapshot, its browser test
harness, its full migration history check and its mechanical checks. Follow it
item by item; an item it names a check for is proved by that check passing,
not by reading.

## Map the suite

Before changing anything, write down for the scope:

- each part of the suite: the command that runs it, its runner, how many files
  it runs at a time and where that number comes from, and what it prepares
  (databases, fixtures, builds, servers) and how;
- each test file, its part, and what behavior it proves;
- what runs the parts together (the project's whole-run script or verification
  command) and each continuous integration job, with the environment each one
  gives the tests;
- every piece of guidance about tests: the project's agent instructions (such
  as `AGENTS.md` and `CLAUDE.md`), the Stack's verification section, the
  contributing, development and testing docs, agent skill customizations,
  package scripts, the test configurations and the comments in them.

Run the mechanical checks the Stack guidance names (a check command's test
rules, a linter's) first and record each finding: each is an item on this
pass's list, and every one passes at its end.

## Measure the run

Take these numbers from one whole run of each part of the suite, its files in
parallel at the machine's real test budget: its per-file times are the
baseline table. Record for each part its wall time, each file's time, the
slowest files and tests, each preparation phase and its time, and the counts of
tests passed, failed and skipped. From that run, rank the time by file and by
parametrized test (a test's variants summed), and say where each top item's
time goes; list the tests repeated per variant (width, locale, theme, role,
provider) with the minutes in their repeated parts; and take each test's time
before its first check. Compare the wall time with the sum of the
files' times divided by the budget: a wall time near the plain sum means the
files ran one after another, so find why (a forced concurrency of one, files
that collide on a shared resource, files marked to run alone without a
reason). After a batch of fixes, run the part again for the times after, and
compare per file and in total. A single-file run is for one change's red and
green, never the way to take a baseline or a before-and-after table, and never
one of serial runs queued one after another. Run where the project's tests
run: the host's test machine, when the host offers one, not a shared
development host; a time taken while other work loads the machine is reported
as such and never used as a baseline.

The pass's own measurement, one run of each part before the work and one
after, is part of the pass the person asked for, and needs no other OK. It is
the only time the pass runs a whole part; during the work it runs focused
checks. A final whole-suite run needs the person's OK, asked once at the end as
`PASS REPORT` says; when the person allows it, its per-part times are the times
after, and the parts do not run again.

## Each test proves a behavior

- **A test fails without its behavior.** For each behavior in the scope, name
  the test that fails when it breaks. Where you doubt one, break the behavior
  (revert the line, return the wrong value, drop the check), several at once
  in one run, see which tests fail, then restore it. A behavior no test catches
  gets one, seen to fail first.
- **Nothing weakened.** No test is skipped, focused, retried, given a raised
  time limit, or loosened to pass (an assertion widened, an exact value
  replaced by "anything", a check removed, an error swallowed). Each one found
  is restored, and the defect it hid is fixed, red first. A skip that must stay
  states its reason and the run that covers the skipped behavior.
- **Meaningful assertions.** A test asserts what a person or caller gets: the
  value, the state, the refusal and its message. A test that asserts only that
  something ran, returned something truthy or did not throw, a snapshot nobody
  reads, or internal calls in place of results, is rewritten to assert the
  result.
- **No tests of mocks.** A test whose double answers what the test then asserts
  proves only the double. Drive the real code, and keep doubles to the edges
  (outside services, the clock), each answering like the real collaborator,
  refusals included.
- **The cheapest level that proves it.** Rules and calculations in a unit
  test; data, access and refusals in a server or integration test; a
  component's content and states in a component test; a browser test only for
  what needs a real browser (a flow across screens, navigation, layout at the
  standard widths, focus, the real sign-in). A check made at a costlier level
  than it needs moves down, seen to fail once there, and the report names where
  it went; a new browser check is an assertion in the test that already
  reaches the screen.
- **No duplicates.** Two tests that prove the same behavior the same way
  become one, the one at the cheapest level. Never drop a behavior that only
  one of them proves.
- **Not mostly setup.** A test that is mostly its own setup around one check
  moves the check to where that setup is already paid, or to a cheaper level,
  and is seen to fail once there.
- **What a person finds.** A browser test finds elements as a person does, by
  role and accessible name, label or the product's own words, never by
  structure, generated classes or text a framework or library supplies and may
  change in its next release.

## Each file owns what it uses

- Each file creates the data it asserts, and takes ports the system picks,
  temporary directories and caches of its own, and a database or schema of its
  own whose name no other file, run or person uses, so it runs beside any other
  file and identical runs agree. Where a file's isolation is in doubt, run it
  twice, beside another, reversed and shuffled; never as routine whole runs.
- Names come from the run, never from the tests: no fixed database name, port
  or path written into a test, script or configuration, and never the
  application's own database name reused as the test database's, in continuous
  integration too.
- A test reads the database the run gave it, never one it finds through the
  host's environment or the developer's configuration.
- No test reaches a development or production database or configuration, or a
  real outside service (sign-in providers, email and messages, payments, AI
  providers, cloud and hosting services). They are stubbed at the seam the
  project already uses. Test processes and the servers they start get a
  test-only environment, never the whole environment of the shell that started
  them, which may hold a development environment's real keys.
- Prove it by running, not by reading code: one run of each part with outbound
  network refused, beyond the test machine's own services such as its test
  database. Where the Stack's test command refuses those connections itself,
  every run is that proof; otherwise the run sets up the refusal (a sandbox or
  rule with no route out). A test that then fails because it reached out is a
  finding: stub what it reached.
- A file that truly holds a resource of the whole machine runs alone and says
  why, in the form the Stack's test runner reads.

## Each run takes the time its work needs

- **Prepare once per run.** Build databases, fixtures, builds and servers once
  per run, from a stored schema and seed checked by a digest of their sources,
  and restore or reuse them from there, kept where reinstalling the
  dependencies does not delete them. Something every file only reads (a built
  app, a generated project, a seeded snapshot) is prepared once and shared
  read-only, while a file that writes into it makes its own copy.
- **The full migration history is one separate check.** No test file replays
  the migration history; the history runs once from empty, as its own check,
  and its seed rows match on every replay: a row stamped from the clock or a
  random value at migration time breaks that check, and a migration that has
  run is never edited to fix it.
- **Servers and builds once.** A server starts once per file or per run, never
  per test, and a build runs once per run and is reused while its inputs are
  unchanged: a build step that writes a generated file among the build's own
  inputs makes every run rebuild, so the generated file goes elsewhere. Browser
  tests run on the built app, never on a development server.
- **Variants repeat only what varies.** A test that covers several widths,
  locales, themes, roles or providers runs its behavior once and repeats only
  the checks that depend on the variant, and a parametrized test's variants
  share the setup they don't change. Prove it with the minutes in repeated
  parts, from the run before and the run after.
- **The cost before the first check is paid once.** App start, page load,
  sign-in and fixture builds that are most of a test's time are paid once per
  file or worker. Prove it with each test's time before its first check, before
  and after.
- **No real installs, clones or builds per test.** Tests use fixtures prepared
  once per run. Prove it: no test file or helper runs a package install, a
  clone or a build (search them for the commands), and the run's preparation
  names each fixture once.
- **Split the file that bounds the run.** A file's tests run in turn, so the
  slowest file sets the run's floor: one that holds a large share of the wall
  time is split at its real seams. Prove it with that file's share and the
  run's wall time, before and after.
- **One pool across packages.** In a repository of several packages, every
  package's test files share one parallel pool, never package after package.
  Prove it: the run's wall time is near the sum of all its files' times divided
  by the budget, not the sum of the packages' runs.
- **Nothing runs twice.** The project's scripts and continuous integration run
  no suite, build or check twice in one run, a preliminary check repeats
  nothing the run after it covers, and a check that passed on the exact tree is
  never run again. Prove it: read the scripts and jobs, and see each suite,
  build and check start once in one whole run's output.
- **Run files in parallel within the machine's test budget.** The test runner
  sizes the concurrency from the machine's budget; no script or configuration
  hard-codes a worker count or a concurrency. Isolate what files would share
  rather than running them one at a time, and stay within the budget: an
  overloaded machine makes every test slower and some of them flaky.
- **Wait for events, not time.** Each fixed sleep becomes a wait for the
  condition it stood for, with a time limit that only catches a hang. The
  software's own delays (retry backoff, debounce, polling) run on a fake clock
  where the test runner allows it. A wait that often ends at its cap waits for
  the wrong thing. A window that proves something does not happen is the one
  fixed wait that stays, and it says so where it waits.
- **Load what a test needs with its file**, not inside its timed body, so its
  time limit covers only its own work.
- **Counts at two sizes.** Each list, batch and write path has a test at a few
  rows and at a realistic number that compares their query or call counts; a
  count that grows with the rows is a product defect, fixed as the data pass
  says, never a test made slower or smaller.
- **Output a person can read.** A passing run prints what a person reads (the
  counts, the slowest files, the failures), not every request's log line.

Never raise a time limit, add retries, or shrink realistic data or coverage to
get faster: a raised limit hides the slowness, a retry hides a race, smaller
data hides work done per row, and a dropped test or assertion stops proving
behavior. A test that changes its input to skip a wait stops proving the
skipped path; advance a fake clock instead. A limit far above the measured need
is a finding too, since it lets the next slowdown pass unseen.

## Every run reports every failure

- **One parallel run per part.** Each part's command runs all its files in one
  parallel run and reports each file's time; never a loop that runs its files
  one after another.
- **A failed part fails the run.** The project's whole-run script (or
  verification command) runs every part, exits non-zero when any part fails and
  names the part. Its usual leaks: a pipeline whose status is its last
  command's (output piped into a log without failing on the pipe), `|| true`
  or a status captured and never returned, a part started in the background
  and never waited for, and a script that reports its parts' output but not
  their exit codes. Prove it: make one part fail on purpose, see the whole run
  exit non-zero naming that part, then restore it.
- **Each part fails on any failed test.** A failed, cancelled or timed-out test,
  a file that fails to load and a file the run's pattern leaves out all fail
  the part; the files the run lists match the test files on disk.

## The guidance says how the suite runs

- **One account of the suite.** The project's agent instructions, the Stack's
  verification section, the package scripts, the test configurations and
  continuous integration name the same commands and parts, in the same order,
  and match how the suite really runs: in parallel within the budget, on the
  built app, with its databases restored from the snapshot and the migration
  history as its own check. Fix whichever disagrees.
- **No rotten instructions.** Remove commands, paths and versions that no
  longer exist, and every instruction that leads an agent wrong: checking with
  a development server, running the whole suite after each change, timing
  single files in turn, retrying, skipping or loosening a failing test, fixed
  sleeps, shared database names or ports, a hard-coded worker count, replaying
  migrations per test, a browser test where a cheaper test proves it, and
  pointing tests at a development or production target.
- **Short and the project's own.** The project's guidance says what is
  specific to this project, briefly; what the platform's or the Stack's
  guidance already says is linked, not copied, so the copies never drift from
  their source.
- **Current tooling.** The test tooling the Stack names is at its current
  release, updated the project's normal way, with what the update breaks fixed,
  the Stack's list of known breakages first.
- **Agent skills.** The committed copies of agent skills match the Genesis that
  serves the project: `genesis check` passes, and `genesis skills sync`
  refreshes them, never a hand edit. Where agents start without `genesis` on
  `PATH`, the project's agent hooks load the `genesis-compiler` the project
  installs: the project declares it at the version it pins and installs it,
  or its sessions start without Genesis's guidance.

## Fix and prove

1. Red first for behavior: a test that should fail and does not, or a
   behavior with no test, gets its test seen to fail, then the fix.
2. A harness, speed or isolation change keeps the same tests and assertions
   passing, with its part's time before and after, in absolute numbers ("163 s
   to 41 s"), never only as a ratio.
3. Fix the cause where it belongs: the shared test harness, the runner's
   configuration, the script that runs the parts, the guidance, so the next test
   is right too, not one call site.
4. Keep it where a check can guard it: the Stack's mechanical check, a count
   asserted in a test, the whole-run script's failing part seen once.

## Boundaries

- **Never weaken anything to pass or to get faster.** Do not skip, focus,
  retry, shard away or delete a test, raise a time limit, drop or widen an
  assertion, shrink realistic data, or loosen a check or a protection. When the
  suite someone wants needs a trade (less coverage, a slower check moved out of
  the main run), explain the trade and let the person decide.
- The pass changes the tests, their harness, scripts, configuration and
  guidance, never what the software does. A product defect a test exposes is a
  separate fix with its own test, seen to fail first, and the report names it
  as a fix.
- Tests and measurements use databases and copies the run creates and drops;
  never a development or production database or its configuration, a
  production deployment, or a real outside service.
- Share the machine fairly: stay within its test budget, never fill a shared
  machine with repeated whole runs, and wait for long runs without polling.
- **Fix at the owner.** When the test runner, the framework, a library or the
  host causes a finding, report the exact change it needs under "Outside this
  scope" instead of working around it in the project.
- **Report what it can't fix.** A product decision is a question for the
  person, with a recommended answer; a slow outside service, a host limit or a
  defect in shared guidance goes under "Outside this scope" with its evidence,
  what it needs and who must act.
- The selected Stack's test pass guidance names its runner, budget, databases,
  browser harness and checks; follow it.
- You may edit tests, the test harness, fixtures, test configuration, scripts,
  continuous integration and the project's own guidance in scope; every
  existing behavior assertion stays. Do not edit `.genesis/`, Git metadata,
  dependency directories, generated build output, retained migration history,
  or external resources, and change agent skill copies only through
  `genesis skills sync`.

Leave the pass as ordinary uncommitted work for review and a later normal
commit. Never amend or rewrite selected commits. Summarize the resolved scope,
the suite's map, each part's run before and after (wall time, the slowest
files, the test counts, and whether it ran in parallel), each finding with its
fix and the test seen to fail first, the run with outbound network refused and
what it found, the failing part the whole-run script was seen to name, every
guidance change with its reason, files changed, checks actually run, and
what lies outside this scope, with what it needs and who must act. End the
report with one line: how many test runs the pass made, their total time and
its longest single run.

When the prompt ends with a `PASS RECORD` step, take it once the pass has
finished: the Genesis `passes done test-pass` operation records it in `genesis/passes-added.json`,
an uncommitted change that lands in the pass's own commit. Genesis adds that
step only to the pass's own runs, whose requests it writes itself, so a test
pass of a section, commits or your own changes is never recorded as the pass;
neither is a pass that stopped early, was abandoned or still has failing
checks. Take it only after the whole-suite run, asked for once at the end,
passed with the person's OK, or after the person explicitly accepted finishing
without it, as `PASS REPORT` says; until the end, run focused checks only.
Work as the engineering approach's "Your own test loop" says: fix in groups,
run the narrow files that cover each group once, then lint and the tests
covering the pass's changes in one run, and leave the full run to the pass's
end.

## Deep run

When the prompt has a `DEEP RUN` section, follow it: it says how the checklist,
evidence, chunks, commits and report work for every pass.

A deep run starts by running the whole suite once, as the project's final run
runs it (its commands, environment and test budget, every part even after one
fails), keeping each file's and each test's time and the run's full output in a
file; this run is the pass's measurement before. Then read that run to find
what is wrong: the slowest files and parametrized tests and where their time
goes, tests repeated per variant, each test's time before its first check,
files or packages run one after another, failures, skips with no covering run,
and guard or warning lines. Fix from that run's evidence, never from guesses or
partial runs, and prove each fix against its numbers.

This pass adds to the checklist:

- every test file, read in full: what it proves, its level, its time, what it
  owns and what it shares, and every test in it weakened, skipped, retried,
  loosened, duplicated or mostly setup;
- every part of the suite: its command, preparation, concurrency and time, and
  the whole-run script with one part failed on purpose;
- every piece of guidance about tests, every Stack mechanical check's
  findings, and the run with outbound network refused;
- the cross-subsystem item: the same behavior tested in several places or not
  at all, the same setup or fixture built in several places, and helpers that
  repeat what the harness already does.
