# The agent loop (D-48)

How Mercbot's bots work through a job: what the loop does, every decision behind it and why, how
it was measured, and how good it is. Written 2026-10-31; keep it current when the loop changes.

The brief: *"we are writing something that is meant to create software"*, and the bar: *"our agentic
loop must be NOTHING short of Claude's own"*. Bots do coding and app-building jobs, so a bot that stops
half way or claims work it didn't do is a gap.

Related: `docs/decisions.md` (D-45, D-47, D-48, D-49), `docs/agent-loop-dsh.md` (the
study of DeepSeek Harness, about 165 design choices), Program `genesis/program/bots/conversations.md`
and `genesis/program/files/shell.md`.

---

## 1. Status in one page

| | |
|---|---|
| **Results** (Together, everything in) | shared coding 45/45, hard coding 15/15, Mercbot app building 15/15 (including the Builder in a group), recall after a ~600k-token chat 5/5, quick chat 10/10 in 1–2 s |
| **Against the bar** | Claude Code running the same DeepSeek model: 15/15 shared, 5/5 hard. We match it on every task we have. DeepSeek's own harness: 44/45 shared; we pass it. |
| **Before this work** | shared 40/45, failure-prone cases 64/70, the Builder failed every group request |
| **Speed** | quick chat 0–1 s; coding tasks 2–25 s; Mercbot's own overhead per reply 0.05–0.2 s, the rest is the model |
| **Cost** | about half a US cent per coding task on Together; 65–95% of input tokens come from the cache |
| **Open** | a mid-turn summary (deferred until a long build shows the need) |

Everything below is on `main` and covered by unit and integration tests.

---

## 2. How a reply runs

Every reply (a person's own chat, a room, a group, a request from another bot, a routine, an app
task) goes through **one loop**: `runLoop` in JSKIT's `@jskit-ai/agent` package (saved runs, goals,
summaries, planning and default tools in `@jskit-ai/agent-runtime`), on the
AI SDK's `generateText` (call the model, run the tools it asks for, feed the results back, repeat
until it answers without a tool call). Mercbot's own choices sit around it in `botAgent.js` and
`botReplies.js`. Until D-52 the loop ran on Mastra; the move kept every request byte for byte.

```
person's message
  └─ respond()  (botReplies.js)
       ├─ history: summary + messages since (summarise first if past 550k)   §5
       ├─ state note: time, accounts, routines, open to-do list, job notes   §6
       ├─ tools for this turn (+ repeat reminder, + mid-reply messages)      §7
       ├─ runLoop()  (botAgent.js)
       │    ├─ every step reasons (adaptive)                                 §3
       │    ├─ old tool results give way past 700k inside the turn           §5
       │    ├─ each finished step is saved (agent_runs.steps)                §8
       │    └─ out of steps or time → account of where it got to             §8
       ├─ checks after the reply (each can send it back once):               §9
       │    raw markup · stopped short · claimed files · unsupported claims
       ├─ cleaning: no markup, no internal paths                             §9
       └─ unfinished? → a goal, carried on in rounds by itself               §8
```

### Where the code is

| What | File |
|---|---|
| The loop, instructions, reasoning switch, in-turn trimming, cleaning, claims checker | `packages/bots/src/server/botAgent.js` |
| A reply end to end: history, tools, checks, saved steps, resumer, mid-reply messages | `packages/bots/src/server/botReplies.js`, `botHistory.js`, `botTurns.js`, `replyChecks.js` |
| Goals and goal rounds, the cost limit; saved steps and the resumer; summaries between turns (sizes for 1M); to-do list and job notes; mid-reply messages and the repeat reminder | `@jskit-ai/agent-runtime/server` (`goals.js`, `runs.js`, `summaryStore.js`, `planning.js`), `@jskit-ai/agent/server` (`summaries.js`, `turn.js`) |
| Mercbot's tools: `send_files`, `read_file` in parts, `read_command_output` | `packages/bots/src/server/fileTools.js`, `commandTools.js` |
| The Builder's screen check after saving a draft | `packages/bots/src/server/builderTools.js` |
| The chat model and reasoning settings | `packages/bots/src/server/model.js` |
| Providers and their list prices, usage metering and what each call cost | `packages/account/src/server/providers/`, `meter.js`, `usage.js`, `cost.js` |
| The bots' command line, whole outputs as files | `packages/files/src/server/shell.js`, `fileStore.js` |
| Evaluation runners and cases | `scripts/agent-evals-ours.mjs`, `scripts/agent-evals-dsh.mjs`, `tests/agent-evals/` |

---

## 3. The model and how it's called

- **Model:** DeepSeek V4.1 Flash, 1,048,576-token window, through the premium AI, **Together AI**,
  for chats and the slower, cheaper AI, **DeepInfra**, for the Builder and background work (D-45,
  D-59, D-72; `WORK` in `packages/account/src/server/providers/index.js`). DeepSeek's own API
  (D-48) is no longer one of Mercbot's providers (D-72); the evaluation runner's `deepseek-*`
  variants still call it, with `EVAL_DEEPSEEK_API_KEY`.
- **Format:** both providers are called in the OpenAI style (`@ai-sdk/deepseek`). DeepSeek's own API
  was called in the **Anthropic format** (`@ai-sdk/anthropic`), exactly as Claude Code calls it:
  signed reasoning sent back on every step, adaptive thinking at high effort, a 32,000-token output
  cap.
- **Reasoning:** on for **every step of every loop**, adaptive, so the model spends a lot on a hard
  bug and almost nothing on "hi" (`THINKING_ON`). One-shot side calls (rule matching, summaries,
  activity lines, the claims checker) don't reason (`THINKING_OFF`); the script writer does, because
  it builds.
- **Retries:** the AI SDK retries a failed call 6 times, waiting 2, 4, 8… seconds (about two
  minutes in all), longer than DeepSeek Harness's five quick tries.
- **Output cap:** 32,000 tokens for loop steps (Anthropic needs one; its default is 4,096).

## 4. What the bot is told

- **No narration.** The instructions used to say "keep the person informed" and asked for status
  lines; DeepSeek then announced a step and **ended its turn**. That instruction is gone: "Mercbot
  shows the person what you're doing while you work, so don't announce your steps: call the tools
  straight away and keep going until the job is done." The reviewed status lines
  (calendar, routines) stay, as tool fields.
- **To-do list** for any job of more than three steps; **job notes** in long jobs.
- **Files:** send existing files with `send_files`, never claim an attachment, never write paths;
  name files by content; scratch in `/tmp`; read image-only PDF pages with OCR.

## 5. Context: using the 1M window without forgetting

| Where | What happens | Numbers |
|---|---|---|
| Between turns | the conversation is summarised in the background, recall first, keeping the newest part word for word | summarise past **450k** tokens, keep **125k** (up to 200 turns), summary up to 8,000 tokens |
| Before a reply | if summarising fell behind, the reply **summarises first** instead of cutting | past **550k** |
| Last resort | if summarising fails, the oldest messages give way, **and the bot is told** | past 600k |
| Inside one turn | the oldest tool results become a one-line note ("run the tool again if you need it"), never the newest 20; once left out they stay out, so the cache keeps hitting | past **700k**, down to **500k** |
| Each tool result | command output shows its first and last 8,000 characters; the **whole output is a file**, `/runs/<run>.log`; `read_file` reads in parts of about 30k tokens | whole outputs up to 16 MB, kept 7 days |
| The prompt's start | instructions, then summary, then history; the state note last (D-57: anywhere earlier, its time reprices all that follows it on each turn's first call) | second turn's first call: 51,328 of 51,395 tokens cached |

## 6. Keeping things in mind

- **To-do list** (`update_todos`): one card in the chat, updated in place, folded to "Done: n of
  n" when finished; the open list is in the state note at every turn. Bots chose to keep one in 10
  of 14 hard runs.
- **Job notes** (`keep_notes`): the bot's private notes for the job (`bot_conversations.job_notes`),
  in the state note at every turn, never shown in the chat.
- **Goals** (`create_goal`, `get_goal`, `update_goal`): a multi-step job keeps going in rounds until
  it's complete, blocked (not before round 3), at 24 rounds, or at its cost limit.

## 7. Talking to it while it works

What the person writes during a reply reaches the bot **with its next tool result**, so it changes
course at once, and that reply then counts as the answer. The **3rd, 5th
and 8th identical tool call** in a row gets a reminder in its result.

## 8. Long jobs and staying alive

- **Steps saved as they happen:** each finished step is written to `agent_runs.steps`. If the
  server stops, a page retry or the **resumer** on any server carries the reply on from its last
  step (as Claude Code resumes from its transcript), unless the person has written since.
- **Never "ask me to carry on":** a reply that runs out of steps (40–60) or time (15 minutes) says
  where it got to and opens a goal for the request; the rounds carry it on in the background.
- **Limits, said plainly in the chat:** 24 rounds, and a **cost limit per job**,
  `AGENT_JOB_COST_USD` (default 5 dollars, 0 for none).

## 9. Truthful replies

Each check below can send a reply back **once**, carrying on from its own steps (the second pass
sees the first one's work, so nothing is redone).

| Check | Catches | Since |
|---|---|---|
| **Raw markup** | a tool call written as text, DeepSeek's tokens (`<｜begin▁of▁sentence｜>`), budget and safety tags | D-48 |
| **Stopped short** | a reply under 600 characters that ends by announcing its next step; any bot with tools, groups too (with a goal active, its round carries on instead; the engine's own account of a reply that stopped early is left alone) | D-47, widened D-48 |
| **Claimed files** | "attached below" with no card | D-48 |
| **Unsupported claims** | a reply that reports actions is compared with what its tools actually did, in one short call; "emailed it to Sam" with no email is sent back | D-48 |
| Pictures, calendar, Drive, mail, GitHub, apps, hand-over | specific claims by words | before D-48 |

And always: **no raw markup** and **no internal `/files/…` paths** in what people see.

**The Builder checks its own work:** a draft is saved only if it passes `checkApp`; then every
screen's queries run on the draft as the preview runs them, and failures come back to fix. Scripts
are saved only when their tests pass.

---

## 10. Decisions, and why

| # | Decision | Why | How, when |
|---|---|---|---|
| 1 | Build our own loop (first on Mastra, on the AI SDK since D-52), studying DeepSeek Harness rather than depending on it | DSH is a preview with ~80 packages; its designs are MIT and documented in `docs/agent-loop-dsh.md` | decided, 2026-10-30 |
| 2 | Measure first: fixed tasks judged by outcome, baseline before changes | so every change is proven by numbers | decided, 2026-10-30 |
| 3 | Claude Code's own loop is the bar | "NOTHING short of Claude's own" | decided, 2026-10-31 |
| 4 | Drop narration instructions | measured cause of "announce and stop" (60/60 without, 53/60 with) | 2026-10-30 |
| 5 | Reasoning on every step, adaptive | reasoning on; adaptive keeps chat at 0–1 s | decided, 2026-10-31 |
| 6 | DeepSeek's own API in Claude Code's format, as an option | 70/70 and cached; Together stays the default | 2026-10-31 |
| 7 | Together stays the provider | the end goal; with the loop changes it scores 70/70 there too | decided, 2026-10-31 |
| 8 | Size everything for 1M | "keep in mind that we have ONE MILLION context" | decided, 2026-10-30 |
| 9 | Never forget unseen | summarise first; say so if anything is cut | 2026-10-31 |
| 10 | Trim old tool results inside a turn rather than summarise mid-turn | same "leave out, re-read when needed" idea as Claude Code; the gist stays in the bot's words, notes and to-do list. A mid-turn summary waits for a real need | recommendation, 2026-10-31 |
| 11 | Whole command outputs as files (`/runs/<run>.log`) | as Claude Code keeps large outputs: the bot can grep and tail them; on the shared volume for every server | decided, 2026-10-31 |
| 12 | Save steps as they happen; resume on any server | Claude Code survives being killed; Mercbot servers are disposable (D-19) | 2026-10-31 |
| 13 | Messages mid-reply reach the bot at its next step | "conversations WHILE it's doing things" | decided, 2026-10-31 |
| 14 | To-do list as a live card; job notes private | "TODO list it is!"; notes complete the plan's item | decided, 2026-10-31 |
| 15 | No subagents yet | with 1M tokens the main reason (a small window) mostly goes; they bring cost and card risks | recommendation, 2026-10-31 |
| 16 | A cost limit per job, as a setting | "have a cost limit but have it as a parameter" | decided, 2026-10-31 |
| 17 | Truthful replies, fully built | "fully build" | decided, 2026-10-31 |
| 18 | A long job carries on by itself | the person is never asked to say "carry on" | plan, 2026-10-31 |
| 19 | One loop for groups too | groups gained the deadline, the account and trimming | plan, 2026-10-31 |

What didn't work, or wasn't needed:
- **Not sending reasoning back** on Together: helped (64 to 68 of 70) but wasn't the answer; the
  narration and stop-short fixes were.
- **Together's Anthropic endpoint:** 70/70, but no prompt cache and unsigned reasoning.
- **Removing every tool's acknowledgement field:** it broke reviewed status lines,
  so only the instruction changed.
- **Our own retry code:** removed; the libraries already retry nine times.

---

## 11. How it was measured

### Runners

- `scripts/agent-evals-ours.mjs`: a real bot reply, through the whole pipeline (every tool, the
  state note, the checks), against the test database, with the real model.
  `node scripts/agent-evals-ours.mjs --suite shared|hard|mercbot|chat|memory --runs N [--only a,b] [--variant …] [--label name]`.
  Runs are written to `artifacts/agent-evals/<label>/` (results, each run's messages, a summary
  table); the folder is git-ignored. Run one at a time: two runs on the test database steal each
  other's goal rounds.
- `scripts/agent-evals-dsh.mjs`: the same shared cases through DeepSeek Harness, for reference.
- **Variants** (`--variant`): `base` (as in production), `quiet`, `minimal-tools`,
  `no-reasoning-back`, `anthropic` (Together's Anthropic endpoint), `deepseek-anthropic`
  (DeepSeek's endpoint as Claude Code calls it), `deepseek-openai`, `thinking-off`.
- **Judges are hidden** from the bot: they're copied in only after it finishes. Folder cases judge
  the files; Mercbot cases judge the home's apps, tables and records; chat cases judge the words.
  Every hard case was checked against a reference solution (passes) and against the shipped files
  (fails).

### The cases

**Shared coding (`tests/agent-evals/shared`, 15):** each gets a folder; the judge checks the result.

| Case | The job | Judged on |
|---|---|---|
| big-file-edit | change one helper in a 1,200-line module, nothing else | the helper's new behaviour, every other line untouched |
| bug-fix | fix two bugs in `money.py` so its tests pass | hidden tests of the documented behaviour |
| contacts-extract | pull emails and Australian phone numbers from messy text | exact normalised, sorted lists; no versions or prices |
| crash-debug | make a crashing stats script skip bad values | both commands' exact output |
| csv-summary | totals per region across three CSVs | `summary.csv` against the expected totals |
| date-ranges | merge touching and overlapping booking ranges, with tests | hidden tests including invalid input |
| fix-js-bugs | fix two JavaScript files so `npm test` passes | hidden tests |
| four-deliverables | a script, its tests, its output and a README | all four exist and are right |
| json-flatten | flatten nested orders into CSV lines | exact rows and totals |
| log-report | top IPs and 5xx counts from a 60,000-line log | `report.json` against the expected answer |
| notes-needle | three facts hidden in 40 meeting notes | the facts and the files they're in |
| refactor-js | rename a function everywhere and add a discount parameter, with tests | hidden tests; the old name gone |
| sqlite-questions | four questions about a SQLite shop database | exact answers |
| textstats | word counts and top words, with own tests | hidden tests (apostrophes, ties) |
| todo-cli | a planned command-line to-do app with subprocess tests | hidden CLI tests (ids never reused, errors) |

**Hard coding (`tests/agent-evals/hard`, 5):** longer, trickier jobs where loops fall over.

| Case | The job | Judged on |
|---|---|---|
| calc | build a calculator language (precedence, power, variables, functions, exact error positions) from a 17-test spec, no eval | the spec plus hidden programs and errors |
| billing | "March invoices are wrong": three bugs across modules (CSV thousands, month end, tiers) that only show when run | every invoice regenerated and exact |
| notes-api | a JSON HTTP API with validation, filters and persistence, plus tests | the server started and probed over HTTP, including a restart |
| async-migration | convert four callback modules and their tests to async/await, a test per error case | hidden async tests, no callbacks left, `npm test` passes |
| dedupe-perf | make a quadratic dedupe fast (under 10 s on 60,000 rows) without changing output for any input | output identical to the original on 30 tricky random inputs, the sample, and the big file in time |

**Mercbot app building (`tests/agent-evals/mercbot`, 5):** a throwaway home, the bot as its Builder.

| Case | The job | Judged on |
|---|---|---|
| app-new | a plant-watering app: name, last watered, notes; sorted list and add form | a table with date and text fields, an app using it, sorted, with a form, passing `checkApp` |
| app-change | add a Birthday date field to the CRM's contacts and show it | the field's type and the column on the list |
| app-rule | refuse deals with a negative amount, tested | a saved script with tests; a negative deal refused, a positive one saved |
| app-data | add three named contacts as leads | the three records with their emails |
| group-app | app-new asked in a group chat with the Builder | as app-new (the open item from D-46 step 2) |

**Quick chat (`tests/agent-evals/chat`, 5):** a greeting, 15% of 84, three bakery names, a
friendlier rewrite, a 20-minute dinner idea. Judged on a sensible answer; timed.

**Memory (`tests/agent-evals/memory`, 1):** recall-long seeds a 2.4M-character chat (about 600k
tokens) with five facts in its older part (a birthday, a café name, a plumber's name and visit, a
budget, an allergy) and asks for all five. Judged on a written summary plus all five facts; facts the
bot saves to memory are cleared so they can't answer for the summary.

### Results over time (Together unless noted)

| Run | Shared | Failure-prone (7 × 10) | Hard | Apps |
|---|---|---|---|---|
| DeepSeek Harness, reference | 44/45 | — | — | — |
| Baseline, before changes | 40/45 | — | — | 7/12 |
| Reasoning from the first step | 43/45 | 53/60 (6 cases) | — | 11/12 |
| No narration | 44/45 | 60/60 (6 cases), 64/70 | — | 12/12 |
| Format test: DeepSeek's endpoint, Claude Code's way | — | 70/70 | 9/10 | 12/12 |
| Whole loop on Together | 45/45 | 70/70 | 14/15, then 15/15 | 15/15 |
| With the final-reply check | 30/30 | — | — | 10/10 |
| After the gVisor computer (D-49) | 30/30 | — | 5/5 | 5/5 |

**References on the same tasks:** Claude Code with Sonnet 15/15 shared; Claude Code with DeepSeek
(the same model as ours) 15/15 shared and 5/5 hard, 97.8% of its input cached.

---

## 12. How good is it

**Strong:**
- On every task we have, it matches Claude Code running the same model, and passes DeepSeek's own
  harness.
- The failures that mattered are gone: announcing a step and stopping, raw markup, claiming work
  that wasn't done, losing a reply when a server stops, and forgetting old conversation.
- It's built for Mercbot's world, beyond what Claude Code needs: any server can resume any reply,
  jobs carry on unattended in rounds, and everything is in PostgreSQL or on the shared volume.

**Not yet proven:**
- **Very long builds.** The tasks run from seconds to a few minutes. A real multi-hour build,
  where in-turn trimming and summaries matter most, hasn't been measured; that's where a mid-turn
  summary might turn out to be needed.
- **Breadth.** About 30 tasks. They're varied and judged strictly, but small next to real use.
- **The final-reply check's hit rate.** The check prompts aren't stored, so we know it causes no
  failures but not how often it fires.

**Costs:** the final-reply check adds about 1–2 s to replies that report actions; everything else
Mercbot does around the model costs about 0.05–0.2 s a reply.

## 13. Keeping it good

- Rerun the suites after any change to the loop, instructions or tools:
  `--suite shared --runs 3`, `--suite hard --runs 3`, `--suite mercbot --runs 3`, `--suite chat`,
  `--suite memory`. No case may get worse without an explanation.
- Add a case for every failure seen in real use, with a hidden judge checked against a reference
  solution.
- Keep this document, `docs/decisions.md` (D-48) and the Program in step with the code.
