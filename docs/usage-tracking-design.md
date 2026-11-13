# Usage tracking: what each home spends, and on what

**Status: built in part (D-73, 2026-11-11), reworked on 2026-11-12 for very large histories, and since then
measuring only: what each piece of work used and what it cost at its AI provider.** A phase-2 feature
(D-18). The design below was checked against the code at `2fc97b5` and is kept as it was proposed, less what never applied to Mercbot itself; what D-73 built, what it
changed, the load test's numbers and what's still to come are in [What's built](#whats-built-d-73) at the
end.

The request: keep a tab of how much each workspace spends and how; don't bog the database
down; never lose anything; give people the details: which bot, when,
doing what. And then: "Each bot must have a price tag attached", "a $XX figure next to each bot... It
can be tiny, but it must be there", and "a clear global view of all of the cron jobs and how much they
have cost over time", with a UI "as good as the rest of the app".

## The short version

- **Every paid call is written down before it starts** and finished when it ends. A server can die
  mid-call and the call still shows up, marked as an estimate.
- **The record of what happened is never edited.** Each finished call becomes one permanent row.
- **Totals are kept per hour** and updated in the same database step as the row, so they can't
  drift or count twice, and screens stay fast.
- **Old detail moves to a compressed file** on the files volume. Totals stay in the database for good.
- **Every bot shows a small $ figure** in the sidebar and bot lists.
- **A Routines screen** lists every routine in the home with its schedule, status and cost over time.
- **People can drill down:** home → bot → reply → each model call, with what it was for.

## What's wrong today

| Problem | Evidence | Effect |
|---|---|---|
| Recording happens after the call and isn't waited for; a failed write only logs a warning | `meter.js` | A failed write or a server stopping loses the record |
| A call in progress when a server dies leaves no trace | `meter.js` writes only after the response | The provider bills us; we never know |
| Streamed replies record nothing | Tested with a fake provider: 0 rows | Bots don't stream today, but `onText` in the agent engine would silently stop all metering |
| Calls outside tracked work record nothing | Tested: 0 rows | Unattributed spend is invisible |
| Pictures aren't metered | `pictureMaker.js` uses plain `fetch` to Gemini | Probably our most expensive call per use, unrecorded |
| Computer time is written only when a computer sleeps | `computerManager.js` teardown | A machine that dies loses all of that stretch |
| Computer time can go to the wrong person | Sleeping from the idle timer has no tracked person, so it falls back to the bot's maker | Wrong in a mixed bot; the home is still right |
| Commands aren't metered | `shell_runs` holds them, `usage_events` doesn't | Up to 30 minutes of server time per command, uncounted |
| Deleting a person or home deletes their spend; deleting a bot forgets which bot | Foreign keys `CASCADE`, `SET NULL`; 22 development rows have lost their bot | Spending can't be traced |
| Rows don't say what the bot was doing | No conversation, reply, routine, goal, job, tool or model | Can't answer "doing what?" |
| Provider bills and our own estimates are mixed | Of bot 10's $13.59, $7.85 is model use and $5.74 is computer time, Mercbot's estimate at $0.002 a minute that no provider bills | Can't be reconciled, or explained to a customer |
| A routine's runs aren't recorded | `bot_routines` has only `last_run_at` | No result or cost per run, and no way to see a routine failing |
| Money is computed with floats, from today's prices, with no record of the price used | `MERCBOT_PRICE_*` settings over the provider's list prices | Can't be audited or re-rated |
| A job's cost limit counts everything by this person with this bot, computer time included | `spent` in `botsService.js` | A goal can stop early, or late while writes lag |

The meter's arithmetic itself is right: a tracked JSON call produced the expected row and cost.

## The design

### One path for every paid call

All model traffic already passes through `createMeteredFetch`, and pictures will too. It becomes:

1. **Before the call:** insert a row in `usage_open`, a tiny table holding only calls in progress,
   with a new id, who and what it's for, and the request's size. If this insert fails, the call
   doesn't go out. If the database is down a reply couldn't be saved anyway.
2. **After the call, before handing back the response:** one SQL statement deletes the open row,
   inserts the finished row into `usage_events`, and adds to the hourly total.

Because the statement starts by deleting the open row, **a repeat does nothing**: if nothing was
deleted, nothing is added. That's what prevents double counting. A provider retry is a new call
with its own row, which is correct, because the provider bills it.

| What happened | Row's `state` | Tokens |
|---|---|---|
| Provider answered with usage | `done` | exact |
| Provider answered with an error | `failed` | none |
| Stream ended normally | `done` | exact, read from the stream's last event |
| Stopped mid-call, or stream cut | `cut` | estimated from sizes, flagged (question 1) |
| Server died (open row older than 30 minutes) | `lost` | estimated from sizes, flagged (question 1) |
| Provider answered without usage | `no_usage` | estimated, flagged, logged (question 1) |

- **SIGTERM (D-19):** running calls finish or are cut by the existing drain, and each ends through
  the same statement. Anything that doesn't make it stays in `usage_open`.
- **Several servers (D-15):** every server sweeps stale open rows every few minutes. Two servers
  doing it at once is harmless, because only one can delete a given row.
- **If the finishing write fails:** it retries for a short while. If that fails too, the open row
  remains and is swept as `lost`. The call is never forgotten, only less exact.
- **No spool files:** a local file would break D-19, and the open row makes one unnecessary.

**Computer time and commands** use the same two steps. An awake computer's open row records when it
was last seen, once a minute, and closes on sleep and on each new hour. A machine that dies loses at
most a minute. Commands close when they end. Computer time belongs to whichever reply or routine used
the computer last, with the row closing and a new one opening when that changes. So a routine that
wakes a computer pays for keeping it awake, including the idle minutes before it sleeps.

### What a finished row holds

`usage_events` is append-only and has no foreign keys, so nothing a person deletes removes it.

- **Who:** `workspace_id`, `user_id`, `bot_id`, `bot_name` (a copy, so a deleted bot keeps its name).
- **Doing what:** `purpose` (`reply`, `routine`, `goal`, `summary`, `script`, `picture`, `vision`,
  `web_page`, `rule_match`, `computer`, `command`, `unattributed`), `tool` when a tool made the call.
- **Where:** `conversation_id`, `turn_id` (one reply, with every step and side call), `message_id`
  (what it answered), `routine_id`, `routine_name` (a copy, as with the bot), `goal_id`, `app_job_id`,
  `bot_request_id`.
- **What it was:** `provider`, `tier`, `model`, `provider_request_id`, tokens (cache hit, cache miss, cache
  write, output, reasoning), `images`, `seconds`, `duration_ms`, `state`, `estimated`.
- **Cost:** `price_id`, `list_pico` (tokens at the dated price), `cost_pico` (what the provider says
  the call cost when it says, as DeepInfra does with `usage.estimated_cost`, otherwise `list_pico`),
  and `billed_by`: `provider` when a provider's
  bill covers it (models, pictures), `mercbot` when it's our own estimate (computer time, commands).

Message content is never stored here. The privacy page already promises usage rows hold none.

**Labelling is one line per place.** `meter.track()` already merges nested contexts, so `meter.label({
purpose: "summary" }, work)` adds what's being done. Tools get wrapped once, where `buildTools` makes
them. Any call with no context is still recorded, as `unattributed`, and a test fails if the suite
produces one.

### Cost

- **Exact integers:** whole picodollars (a millionth of a millionth of a dollar) in `bigint`. Today's
  $0.006 per million tokens is exactly 6,000 per token. Only a total shown to a person is ever rounded.
- **The providers' prices are dated rows,** `usage_prices`: provider, tier, model, what's measured, cost
  per unit, valid from. One server mixes providers and tiers (chats on Together, app making on
  DeepInfra Standard, routines and background work on DeepInfra Flex; decided 2026-11), so each call is
  costed by what actually served it. Each usage row keeps the `price_id` and the amounts. A price change never
  touches the past. This replaces the `MERCBOT_PRICE_*` settings.

### Keeping the database small

- **Hourly totals,** `usage_hourly`: one row per home, hour, bot, person, purpose, routine, provider,
  tier, model and `billed_by`, with tokens split into cached and uncached, kept for good. All totals and limits read this. Hours let each person's own time zone get correct days.
- **Why not a background job:** that's the usual answer for very high write rates, but it needs
  watermarks and locks and shows stale totals. One bot's calls come one at a time, so same-statement
  totals don't contend. If that ever changes, a job can replace it with no change to the tables.
- **Monthly partitions on `usage_events`,** the one piece of real added complexity. Removing a month
  is then instant, with no mass delete and no bloat. It's cheap now with no data and painful to add
  later. Servers create upcoming months themselves, with a default partition so an insert can't fail.
- **Few indexes:** home + time, and conversation + time (for reply views and job limits).
- **Rough size, assuming a million calls a day:** about 400 MB a day, so about 12 GB a month.
  The development database has about 4,200 rows from a week of real use (24–31 October).
- **Archive, then drop:** when a month passes the retention period, it's written as compressed CSV to
  `<files>/usage-archive/YYYY-MM.csv.zst`, the row count and totals are checked against the database,
  and only then is the partition dropped. Files are object storage underneath (D-50).

### Checking it's right

- **Daily, one server claims it:** for each closed day, raw rows must equal the hourly totals. A
  mismatch alerts and rebuilds that day from raw, which is the truth.
- **Monthly:** our `billed_by = provider` cost per provider and key against the
  provider's bill, flagging over 1%. Our own estimates stay out of this. Where a provider reports each
  call's cost, it's compared daily with `list_pico`, so a wrong price (or a promotion) shows up early. How each provider exposes its bill still needs checking when this is built.
- **Separate API keys** for production and development/evals. Evals have their own meter and database,
  so sharing a key would show up as an unexplained gap on the bill.
- **A test fails** if server code calls a known provider's address without the metered fetch.
- **Whoever runs the copy is told when a provider refuses us.** Each `failed` row keeps the provider's error
  type, and refusals for credit or quota raise an alert at once. In early November replies failed
  for days, probably because Together's credit ran out, and nothing told anyone.

### What people see

All of this reads totals, so it stays fast, and it matches the app's existing look and components.
Every figure can be opened to see what's behind it, and estimates are always marked.

**A price tag on every bot.** A small, quiet figure such as `$4.12` beside each bot's name, in the
sidebar (the pinned bots and the lists, and under the avatar when the sidebar is collapsed) and in
bot lists, including `<$0.01` and `$0`.
- **What it adds up:** everything that bot cost in the period (see the question below), AI and
  computer time together. Hovering shows the split, the last 30 days and the all-time total.
- **Loading:** one small request per home (`GET …/usage/bots`) reading `usage_hourly`, refreshed when a
  reply ends, not on every call. It's separate from the bots list, so it can't slow the sidebar down.
- **Bot Details:** the same figure with a chart by day, the split, and that bot's routines and replies.

**A Routines screen,** a new entry beside Files and Apps, one row per routine in the home:

| Column | Example |
|---|---|
| Routine and bot | HN top story headline · Scout |
| Schedule, in words, and next run | Every 10 minutes, 8:00–21:59 · in 4 minutes |
| Status | Running, Paused, or Failing with how many in a row |
| Last run | 10 minutes ago, succeeded |
| Cost per run | $0.036, with a small 30-day trend line |
| This month, and all time | $3.15 · $13.59 |
| At this rate | About $91 a month (84 runs a day at $0.036, AI only) |

- **Sorting and actions:** sorted by cost by default; pause or resume in place, or open its chat.
- **Opening a routine** shows cost over time (per run or per day), AI and computer time apart, and
  each run: when, result, AI cost, computer cost, tokens with how many were cached, and a link to the
  reply. A routine's cost per run going from $0.009 to $0.036, with 94% of it uncached input, would have
  been plain to see.
- **"At this rate"** is the average of the last 10 runs times the number of runs its schedule gives in
  30 days. It appears once a routine has run.
- **Deleted routines** stay in a collapsed section, from the totals and the copied name, so the
  all-time total still adds up.
- **Phone width:** rows become cards with the same facts.

Run history needs one new small table, `routine_runs`: one row per firing, with routine, `turn_id`,
times, result, a short error, and running cost and token totals. The finishing statement adds to it,
so it can't drift. It's kept for good: a routine firing every 10 minutes makes about 52,000 small rows
a year. Consecutive failures for the status, and for question 4, are read from here.

**A Usage page** in the home's settings, for everything else:

1. **The home:** this month, a chart by day, split by bot and by what it was for.
2. **A bot:** its replies, routines and jobs, newest first, each with its cost and time.
3. **A reply:** each call in order: when, what for (for example "Reading a web page" or "Summary"),
   model, cached and uncached tokens and cost, with a link to the message.

Older than the retention period, levels 1 and 2 still work from totals; level 3 says it's archived.

## How it would be built

1. Push the migration file first, then apply it: new tables, prices, partitions; `usage_events`
   replaced. There's no production data, so development rows are dropped.
2. The meter: open/finish, streams, `unattributed`, sweep; the account menu and job limits read the
   new tables. Job limits count that goal's conversation only.
3. Pictures, computer time (with the right person), commands.
4. Labels and `routine_runs` in `packages/bots`.
5. Price tags on every bot.
6. The Routines screen, then the Usage page, with browser tests and a visual check at desktop and
   phone widths.
7. Reconciliation, partitions and the archive.

**Tests:** a server killed mid-call, a failed database write, a repeated finish, a cut stream,
two sweepers at once, and raw equalling totals after all of them. Price tags must load quickly with a
simulated year of totals.

**Left out for now:** file storage per home. Measuring it means walking the volume, and it has no
provider bill per call. It can be added as a nightly row.

## Answers (D-73)

Every question was answered as recommended.

1. **Estimated calls** (server died, stream cut, no figures) are recorded at their estimated cost,
   marked as estimates.
2. **Owners and admins see the whole home; members see only their own use.**
3. **Detail is kept 3 months in the database, archive files for 7 years, totals for good.** Changed on
   2026-11-12 ("Follow best practices. We can't hold billions of rows."): per-call rows 14 days, daily
   totals 13 months and then archive files for 7 years, monthly totals for good (below).
4. **A failing routine** pauses after 5 failures in a row and says so in its chat, built with routines
   (`bot_routines.failures`, D-77).
5. **A bot's price tag shows this month,** with all time one hover away.

## What's built (D-73)

- **One path for every AI call:** `createMeteredFetch` (`packages/account/src/server/meter.js`), which every
  provider's calls already go through, pictures included. Work done for someone runs inside the meter's `track()`.
  Each call is opened with the meter's recorder before it goes out (who, which bot and home it's for, its kind, what
  it's for, its provider and the request's size) and finished with the provider's own figures before its answer is
  handed back; a stream when it ends. A call that fails used nothing; one cut short, or answered without figures, is
  recorded as an estimate from its sizes. A failure to record never fails the call. A call made outside tracked work
  belongs to no one: it goes out unrecorded, with a warning in the server log.
- **What a call cost** (`cost.js`): what its provider reports (DeepInfra's `estimated_cost`), or else its tokens at the
  provider's list prices (each provider's `prices` under `packages/account/src/server/providers/`), in whole
  nanodollars (a billionth of a dollar).
- **Mercbot's own recorder** (`usage.js`) adds each finished piece of work to its day's and its month's totals
  (`usage_daily`, `usage_monthly`, by home, bot, person and kind) and keeps an AI call's or a computer day's own row
  (`usage_events`), in one transaction. It never holds, pauses or refuses work. A copy built on Mercbot may record
  work its own way through the optional `mercbot.usage-recorder` capability (`UsageRecorder` in `types.js`): it
  answers the meter's calls and the spending routes, names the columns it adds to the daily totals so they're
  archived too, and may refuse work before it starts (`refuseWork`, a 402 whose message says why).
- **A computer's day** (UTC) is counted once, however often it wakes: opened as it wakes and counted once it has
  started (a computer that can't start counts nothing), and counted again when a new day finds it awake
  (`computer_days`; `packages/computer/src/server/computerDays.js`). **Computation** is a command's running time,
  counted in seconds when it ends (`packages/files/src/server/shell.js`). Both are use, with no cost of their own.
- **Screens:** each bot's figure in the sidebar (this month, all time on hover), Settings → Spending (this month, then
  a report of any day, week, month or range of days by day, kind, bot and person, in UTC, with **Download CSV**, whose
  last column is "Spent (USD)"), and the account menu's Spending row. Owners and admins see the whole home; a member
  sees their own use.
- **Retention** (`retention.js`): per-call rows live in daily partitions, made ahead and dropped whole after 14
  days. Daily totals live in monthly partitions; after 13 months each month is written to
  `<files>/usage-archive/daily/YYYY-MM/homes-<from>-<to>.csv.gz`, one file per 100,000 homes, read back and checked
  against the database, and its partition dropped by the server holding its claim in `usage_jobs`. Archives go
  after seven years.

### At 400,000 people: the load test

A load test built the tables for 400,000 people on a disposable database of a test host and timed the work that
matters. Its assumptions: 400,000 people, each with a home and two bots; 30% of
homes active on a day, each making 20 AI calls (12 premium, 8 economy), running commands on one bot, and one in ten
waking a computer. That is 2.4 million AI calls and 612,000 daily totals rows a day. It writes 92 days of history.

At 400,000 homes (run on 2026-11-12 on the desktop test host, busy with other suites; its PostgreSQL runs with
`fsync` and `synchronous_commit` off, so writes are faster than a real server's), with 92 days of history:

| After three months | Rows | Size with indexes |
|---|---|---|
| Per-call rows (`usage_events`, 47 daily partitions) | 38.4 million | 7.3 GB |
| Daily totals (`usage_daily`, 4 months) | 56.3 million | 15.2 GB |
| Monthly totals (`usage_monthly`) | 8.7 million | 2.6 GB |

- **Reads** at p50: a bot's figure 2 ms, a month's report 4 ms (a member's 4 ms), the account menu 2 ms.
- **Upkeep:** dropping a day of per-call rows 33 ms; archiving a month of 12.2 million daily rows to 5 files (37 MB)
  101 s.
- **Projected:** daily totals for 13 months, 242 million rows and about 64 GB; per-call rows for 15 days, 36 million
  rows and 6.7 GB; monthly totals, 26 million rows (8 GB) a year.

JSKIT adds up rows by `id in (…)` once their key has found them, so a table it adds up needs an index on its id. Without
one, a goal's spending, read from per-call rows, scanned all 38 million of them: 12.4 s, and 6.1 ms once they index
their id (built in 20 s). It is an append-only bigint, beside the two indexes per-call rows already have.

A first run, at 60,000 homes, found JSKIT locking and changing each row by its id alone, which scanned the whole totals
table on every write (seconds each at this size); every usage table now indexes its id (D-73).

The spending reports (D-76) were timed on the 400,000-home history (the desktop test host, 2026-11-12), after its
oldest month had been archived, so with 72 days of daily totals. For 50 random homes at p50 (p95): a report of this
month so far 5 ms (8 ms), the last whole month, from the monthly totals, 4 ms (5 ms), all 72 days 6 ms (8 ms), a
member's month 2 ms, the month's CSV 2 ms (4 ms) and all 72 days' CSV 6 ms (9 ms). A busy home, 25 bots used by 10
people for every kind of use every day (90,000 daily totals rows): this month so far 98 ms, the last whole month
198 ms, all 72 days 574 ms, a member's month 19 ms, the month's CSV (13,751 lines) 1.2 s and all 72 days' (90,001
lines, 5.4 MB) 12.7 s, streamed from its first line. The CSV reads each totals row once, a page at a time by cursor:
grouping it a numbered page at a time, as first written, grouped the whole range again for every page and took 234 s
for 115,000 lines.

**Changed from the design:** no `usage_open` table: an AI call is recorded once it ends, and a call whose server dies
mid-call isn't recorded. No hourly totals: daily and monthly totals, by home first, are what every screen reads, and
days are UTC's. No `unattributed` rows: a call outside any person's work goes out unrecorded, with a warning. No
dated price rows: a call's cost is what its provider reports, or its tokens at the provider's list prices in the code.

**Still to come:** the Routines screen and per-routine costs (labels and `routine_runs`), drilling down from a bot to
a reply and its calls (within the 14 days its calls are kept), the daily reconciliation against the providers' own
figures, removing a deleted person's link from their usage, and file storage per home (docs/next.md).
