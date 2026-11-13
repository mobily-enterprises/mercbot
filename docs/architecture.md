# Mercbot: technical and architectural decisions

Mercbot's implementation brief of 2026-10-24 (D-6 in [decisions.md](decisions.md)), kept as written except where
later decisions changed what Mercbot is.

---

This is the implementation brief for Mercbot. It records the stack, the architecture and the evidence behind
them. Every requirement here is Mercbot's own product decision. Build from this document, the decisions in
`docs/decisions.md` and public technical documentation.

---

## 1. What Mercbot is

Mercbot is **personal AI agents ("bots") that do real work for a person**, on that person's own copy: errands
across their email, calendar, files and business apps, and tasks on the web.

- A user can have **several bots**. Each has its own name, job description, rules and memory.
- The person's bots get a **persistent computer** in a sandbox (a real browser, a terminal and files) that
  keeps working while the person is away. Each bot that is working has its own screen on that computer.
- The user can **watch a bot's screen live and take control of it**, for example to sign in to a website
  themselves. The bot never sees the password.
- Bots connect to the user's apps through **integrations** (OAuth connectors and MCP servers).
- **Sensitive actions need the user's approval** before they run.
- Bots can run **on a schedule** or **when something happens** (an event), not only when spoken to.
- Bots can **learn reusable procedures** (skills), including by recording a demonstration in the browser and
  replaying it.
- **Several bots can work together**, passing work to each other in one conversation.
- Usage is **metered per use**, with what each AI call cost at its provider (D-73); there are no plans.
- Mercbot is **free software (AGPL-3.0)**. Each copy is one person's (D-81): it runs on their own computer,
  reached only from that computer and opened with its key, with **their own AI keys**.
- Mercbot is **built in Vibe64** as a normal Vibe64 project, and **people customise it with Vibe64**.

Agents in this product **don't write code for users**. They need no coding loop, only tool use, browser
control and planning.

---

## 2. Stack (decided)

| Layer | Choice | Version tested | License |
|---|---|---|---|
| App | Vibe64 project: **JSKIT + Vue**, Node | — | — |
| Database | **PostgreSQL** (`jskit-postgresql`) | Postgres 16+ (`embedded-postgres` in spikes) | — |
| Agent orchestrator | **Mastra** `@mastra/core` | 1.79.0 | Apache-2.0 |
| Orchestrator storage | `@mastra/pg` | 1.32.0 | Apache-2.0 |
| Memory | `@mastra/memory` | 1.39.0 | Apache-2.0 |
| Model SDK | `ai` + **`@ai-sdk/deepseek`** | 7.0.152 / 3.0.72 | Apache-2.0 |
| Model | **DeepSeek `deepseek-flash`**, thinking disabled | API, Oct 2026 | — |
| Browser automation | **Stagehand v4** `@browserbasehq/stagehand` + **our own replay cache** | 4.3.0 | MIT |
| Browser | Headful **Google Chrome** on **Xvfb** | stable | — |
| Schemas | `zod` | 4.6.7 | MIT |
| Runtime | Node | 26.5 | — |
| Computer v2 | **Firecracker microVMs** on bare metal (KVM) | not yet spiked | Apache-2.0 |

Rejected, with reasons:
- **MySQL:** `@mastra/mysql` is only 0.14, while `@mastra/pg` is at 1.32. Postgres is the mature path.
- **Claude/Codex agent runtimes:** they're built for coding loops, which we don't need, and they come with
  provider terms and cost. Mastra is a maintained, general agent orchestrator.
- **Composio** for integrations: its per-call price swung between ~$0.0003 and ~$0.004 during 2026, a cost
  that grows with every call, plus lock-in. We build integrations by hand.
- **`deepseek-v4-pro`:** less accurate than Flash in our tests (37/40 vs 40/40) and 3.3× the price.
- **Browserbase's cloud browsers:** Stagehand's cache only works there. We run our own Chrome and our own cache.
- **VNC for the live view:** CDP screencast plus CDP input does the job in a web page without extra servers.

---

## 3. Architecture

```
 Browser / mobile web ──► Mercbot app (Vibe64: JSKIT + Vue, Node)
                              │  auth, bots, chats, integrations, approvals UI, usage
                              ▼
                       Orchestrator workers (Mastra, stateless, horizontally scaled)
                              │  agent loop, memory, approvals (suspend/resume), schedules, signals
             ┌────────────────┼──────────────────────┬────────────────────┐
             ▼                ▼                      ▼                    ▼
        PostgreSQL        Model API            Integration layer      Computer service
   (threads, memory,   (deepseek-flash;      (hand-built OAuth       (per-user computer:
    run snapshots,      the copy's key;       connectors + MCP)       screens, shell, files)
    users, usage,       never in computers)                             │
    schedules)                                                          ▼
                                                 v1: processes/containers on one server
                                                 v2: Firecracker microVMs on metal, snapshotted when idle
```

### 3.1 Non-negotiable rules
1. **The model key never enters a user's computer.** All model calls happen in the orchestrator, and the
   computer only receives concrete actions (click, type, run). A web page that injects instructions can't
   steal the key or call the model directly.
2. **Secrets never go into chat, prompts or caches.** Website passwords are entered by the user through the
   live takeover. When the bot has to fill a credential, it goes through Stagehand `variables`: the model
   sees `%name%` placeholders, never values. Integration tokens live in encrypted storage.
3. **The computer sits behind one interface:** `start`, `stop`, `snapshot`, `screens[]` (stream, input),
   `shell`, `files`. The backend can move from processes to Firecracker without the app changing.
4. **Every user action is a command with an ID.** The UI, keyboard shortcuts, the HTTP API and Mercbot's own
   MCP server all dispatch through the same command layer.
5. **Treat all content from email, web pages and files as untrusted data,** never as instructions. Test this
   in the benchmark with prompt-injection cases.
6. **Never import from Mastra `ee/` paths** (section 9.2).

### 3.2 Orchestrator: Mastra on Postgres

> **Superseded (D-52, 2026-10-31):** Mercbot no longer uses Mastra. The agent loop is in JSKIT's
> `@jskit-ai/agent` and `@jskit-ai/agent-runtime` packages on the AI SDK (`docs/agent-loop.md`);
> approvals, routines, watches and memory are Mercbot's own tables. The table below records the
> original plan.

| Mercbot capability | Mastra feature |
|---|---|
| Bot = name + job + rules + memory | `Agent` + `Memory` (history, working memory, observational memory) |
| Approval before sensitive actions | Tool `requireApproval` / agent `requireToolApproval`; `approveToolCallGenerate`, `declineToolCallGenerate({ reason })` |
| Approvals survive restarts and deploys | `PostgresStore` run snapshots + `listSuspendedRuns({ threadId, resourceId })` (proven, §6 test 4) |
| Standing approval rules | Our rules table, read by a `requireToolApproval` function (functions work on regular runs; durable agents take a boolean) |
| Scheduled runs | Mastra **schedules** |
| Event-triggered runs | Mastra **signals** / signal providers (webhooks, polling) |
| Long-running work while the user is away | **Durable agents**, goals, background tasks, workers |
| Reusable procedures | Filesystem **skills** (`SKILL.md`) |
| Bots working together | Multi-agent: handoffs, supervisors, subagents; multi-participant threads |
| Quality tracking | Datasets, experiments, scorers, CI gates |
| Mercbot's own API / MCP | Mastra server + MCP server |

Model setup:
```js
import { createDeepSeek } from '@ai-sdk/deepseek'
const deepseek = createDeepSeek({ apiKey: process.env.DEEPSEEK_API_KEY })
const agent = new Agent({ id, name, instructions, model: deepseek('deepseek-flash'), tools, memory })
await agent.generate(prompt, {
  memory: { thread, resource: userId },
  providerOptions: { deepseek: { thinking: { type: 'disabled' } } },
})
```
Resource = user and thread = conversation. Pin Mastra versions and upgrade on purpose, because releases come
almost daily.

### 3.3 Model: DeepSeek
- **`deepseek-flash`** (V4.1-Flash; 1M context; accepts images), with thinking **disabled** for normal steps.
  Use thinking (`reasoningEffort: 'low'`) only for planning or error recovery. It was no more accurate in our
  tests.
- **Prices** (USD per 1M tokens, peak; off-peak is half): cache hit **0.006**, cache miss **0.30**, output
  **1.20**. Peak is 01:00–04:00 and 06:00–10:00 UTC on weekdays.
- **Limits:** 2,500 concurrent requests per account for Flash, which can be raised for free on request; above
  it the API returns HTTP 429. Connections close if inference hasn't started within 10 minutes.
- **Prefix caching is automatic and 50× cheaper than a miss.** Prompts must keep a stable prefix (system
  prompt → tool definitions → bot profile → active skill), followed by **append-only** history. Never put
  timestamps or per-request noise at the top. Our tests reached 87% cache hits without tuning.
- **Latency:** ~1.2 s for a small call. Multi-step errands slow down under concurrency (~34 s each with 10 in
  parallel, ~97 s with 30), so queue the work and show progress in the UI.
- **The provider must be configurable.** DeepSeek's API is served from China, which is a GDPR and enterprise
  issue for bots that read email. The weights are open, so the same models can run on US/EU inference hosts
  or our own GPUs. Each copy chooses its providers and brings its own keys (D-72).

### 3.4 Browser automation: Stagehand v4 + our replay cache
- Stagehand 4.3 drives **our own Chrome** (`localBrowser.launch({ userDataDir })`, so cookies persist) using
  `act()`, `observe()` and `extract()`.
- **DeepSeek adapter:** Stagehand v4 only accepts OpenAI, Anthropic, Google, Groq or Cerebras model names, so
  DeepSeek goes in through the client model `model: { generate(params) }`. Requests are MCP-sampling style
  (text, image, `tool_use` and `tool_result` blocks, `tools`, `toolChoice`, `responseFormat`). The adapter:
  - converts the messages to OpenAI chat format and passes the tools through;
  - for `responseFormat`, uses `json_object` with the schema in the system prompt;
  - returns `{ role: 'assistant', content, stopReason, usage, outputFormat: 'text' | 'json_schema', structuredContent }`.
    Structured replies are rejected without `role`, `content` and `structuredContent`.
- **Our replay cache** (~30 lines; Stagehand's own cache only works on Browserbase):
  1. the key is page path + instruction (`new URL(await page.url()).pathname`);
  2. on a hit, `act(cachedAction)` runs with **no model call**, and success is checked at `result.data.success`;
  3. on a miss or a failed replay, `observe(instruction)` → `act(action)` → store the action;
  4. **Stagehand's `selfHeal` stays off** when replay is used, so failures reach our layer and the cache gets
     updated instead of the model silently paying every time.
  5. The cache stores `%variable%` placeholders, never secret values.
- **Recorded procedures** use the same action format: capture the user's actions over the takeover stream as
  a sequence of cached actions, then replay them.
- **Gotchas:** never pass `{ variables: undefined }` (validation fails; leave the key out); `page.url()` is
  async; the remaining model calls in replay runs are `extract()`, so use DOM-level extraction on stable pages.

### 3.5 The computer
- **v1 (beta), one server:** each bot screen is an **Xvfb display plus a headful Chrome** with its own
  profile, started on demand and stopped when idle.
  - Measured memory (PSS): **462 MB** for 1 screen, **351 MB** each for 3, **310 MB** each for 6. That's
    about 40 active screens per 16 GB, or about 160 per 64 GB server, leaving headroom.
  - Idle CPU looked high at 6 screens on a laptop (~1 core); re-measure on a server with a longer settle time.
- **Live view and takeover, no VNC:** stream with CDP `Page.startScreencast` (JPEG frames, acknowledged with
  `Page.screencastFrameAck`) over a websocket into the web page. Send the user's mouse and keys back with
  `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent`. This is proven: a human signed in to a test site
  through the stream.
- **Terminal:** xterm.js over a websocket to a PTY in the computer. **Files:** a per-user volume.
- **Website logins** belong to the user's computer. Decide in milestone 2 between one Chrome profile per user
  with screens taking turns, and copying the cookie store into each bot's profile when it starts.
- **v2: Firecracker microVMs on bare metal.** One VM with the screens inside it, snapshotted when idle and
  restored in about a second when a message, schedule or event arrives.

### 3.6 Integrations (hand-built)
- **One shared OAuth layer:**
  - a per-user connect flow, encrypted token storage, refresh and revocation;
  - the scopes shown to the user before connecting;
  - one tool definition per action.
  Each provider is then mostly configuration plus tools.
- **Initial providers** (in priority order): Google (Gmail, Calendar, Drive); Microsoft 365 (Outlook mail and
  calendar, Teams, SharePoint/OneDrive); Slack; Notion; GitHub; Salesforce.
- **Use official remote MCP servers** where they exist (GitHub, Notion, Slack, Atlassian…), and let users add
  **custom MCP servers**.
- **One folder per integration:** `plugins/<name>/` holds the OAuth config and tool definitions, with Gmail as
  the worked example. This keeps them drop-in for people customising Mercbot.
- **Provider verification,** for an app many people sign in to (a person's own app works in Google's testing
  mode, up to 100 users):
  - Gmail and Drive restricted scopes need Google app verification plus a yearly third-party security
    assessment, with weeks of lead time and real cost;
  - Microsoft Graph needs Microsoft publisher verification.

### 3.7 Approvals and policy
- **Every tool has a risk class:**
  - **read:** runs automatically;
  - **write:** needs approval by default;
  - **irreversible or external send:** always needs approval unless the user has set a standing rule.
- **The user's possible decisions:**
  - approve this one call;
  - reject it with an optional reason, which goes back to the model;
  - create a **standing rule** (bot + tool + scope), stored in Postgres and read by the `requireToolApproval`
    function.
- **Bind each approval to the exact arguments** with a fingerprint checked in `beforeToolCall`, so the call
  can't change after it was approved.
- Pending approvals reach the user in the chat and as a notification, always showing the arguments.
- **Gotcha:** after a rejection, Mastra's reply still contains the text the model wrote before the pause (for
  example "I'll send that now"). Trim it before showing the reply.
- An optional model-based reviewer can pre-screen low-risk calls later. Write it from our own requirements.

### 3.8 Usage and limits
- **Meter every model call** per user, bot and home, counting cache-hit, cache-miss and output tokens
  separately, with what the call cost at its provider. **Count a computer's day** (UTC, once however often it
  wakes) and **its commands' running time** as use, with no cost of their own (D-73, D-56's design:
  docs/usage-tracking-design.md).
- **Counting never stops work** (D-73): Mercbot's own recorder (`usage.js`) never holds, pauses or refuses
  anything. A copy built on Mercbot may record work its own way through the optional `mercbot.usage-recorder`
  capability, which may refuse work before it starts; a refusal is a 402 whose message says why.
- **Built to keep years of use:** per-call rows in daily partitions kept 14 days, daily totals 13 months then
  archived, monthly totals for good; every usage table keyed by home first.
- **Per-run guards:** a step limit, a token limit, and loop detection (the same action repeating with no
  change of state).
- Before enabling a schedule or event trigger, show the user an **estimated cost**, because broad triggers
  can run up a home's spending.

### 3.9 Memory
- Each bot has Mastra **working memory** (preferences, rules), **message history** per thread, and
  **observational memory** for long threads.
- **Users can view, edit and delete** memory items.
- **Export and import** of bots, skills, schedules and memory, so a person can move them to another copy.

---

## 4. Cost model (measured)

| Unit | Cost |
|---|---|
| Tool-based errand (~4.5 model calls, ~6 tool calls) | **$0.0008** at peak |
| Cold browser flow (~9 actions) | **~$0.0015**, ~12 s |
| Replayed browser flow (only `extract` uses the model) | **~$0.0003**, ~3 s |
| Active screen | **310–460 MB RAM** |

Example: a heavy user running 50 errands and 20 browser routines a day costs about **$0.05/day (~$1.40/month)**
in model calls at peak prices. **The computer is the main cost**: RAM-hours of active screens plus snapshot
storage.

---

## 5. Spike code to port (clean)

The throwaway spikes contain three small libraries that work; port them into the project:
- **`lib/deepseek.mjs`:** a DeepSeek provider with a per-run meter. It wraps `fetch` to record
  `prompt_cache_hit_tokens`, `prompt_cache_miss_tokens`, completion and reasoning tokens, and includes
  `PRICES` and `cost()`.
- **`lib/stagehand-deepseek.mjs`:** the Stagehand v4 client-model adapter (§3.4).
- **`lib/replay.mjs`:** the replay/self-heal cache (§3.4).

The tests use a fake world (inbox, calendar, CRM, files, and a local webmail site with two designs). They're a
good seed for the benchmark (§7).

---

## 6. Evidence (all passed)

| # | Test | Result |
|---|---|---|
| 1 | Mastra + DeepSeek: 10 errands in a fake inbox/calendar/CRM/files world, including a prompt-injection email and a "draft, don't send" rule; ×4 runs | **flash/no-think 40/40**; ~4.5 model calls/task; 87% cache hits; $0.0008/task. flash/think-low 40/40 at $0.0010. pro 37/40 at $0.0027 |
| 2 | Stagehand v4 + DeepSeek driving local Chrome: sign in, read inbox, compose, send; then a full site redesign | **4/4** including the redesign; password never sent to the model |
| 3 | Replay cache | cold 10 calls / 10.9 s → **replay 2 calls / 3.1 s** → redesign healed → replay 2 calls / 2.8 s. ~80% cheaper, ~75% faster. No secrets in the cache file |
| 4 | Approval pause in Postgres across two processes | **PASS**: process 1 paused two sends; process 2 found them, approved one (sent) and rejected one with a reason (not sent; the model explained) |
| 5 | Screens (Xvfb + Chrome) + CDP takeover | **310–460 MB/screen**; takeover **PASS** |
| 6 | Latency and concurrency | ~1.2 s per small call; 34 s → 97 s per errand at 10 → 30 parallel |

**Gotchas, so nobody rediscovers them:**
1. Mastra's built-in DeepSeek model IDs are stale (`deepseek-v4.1-flash` is rejected). Use
   `@ai-sdk/deepseek` with `deepseek-flash`.
2. Stagehand v4 has no DeepSeek or base-URL option; use the client `generate` adapter.
3. Stagehand's cache only exists on Browserbase's servers (locally it reports `DISABLED`); use our replay
   cache.
4. Turn Stagehand's `selfHeal` off with the replay cache.
5. Stagehand success is at `result.data.success`.
6. Never pass `{ variables: undefined }`.
7. `page.url()` is async.
8. DeepSeek caching matches whole prefixes only.
9. Trim the text from before the pause after an approval decision.

---

## 7. How to build (method)

- **Spec and catalogue:** keep `docs/features.md`, a catalogue of Mercbot features. Each one gets an ID, a
  one-line spec written from Mercbot's requirements, a status, and a test. The number of passing tests only
  goes up.
- **Benchmark:** a set of real errands, seeded from spike tests 1–3, that tracks success rate, steps, cost
  and time per task. Run it on every change, and never let the success rate drop silently.
- **Loop for each piece of work:**
  1. orient (read the catalogue and the latest benchmark);
  2. pick one feature ID;
  3. implement it and test it;
  4. check it in the running app;
  5. record its status;
  6. commit with the ID in the message.
- **Every user action is a command** (§3.1, rule 4).
- **Stop only for the maintainers' decisions:** money, publishing, secrets, legal.
- **Design:** Mercbot's own visual identity, defined as theme tokens.

### Milestones (an order of work, not a promise)
- **M0, project:** a Vibe64 project with `jskit` + `vue` + `jskit-postgresql`. Write the Genesis files
  (Blueprint, subsystems, stack), AGENTS.md, LICENSE (AGPL-3.0), CONTRIBUTING with a CLA, the `ee/` import
  check in CI, and a self-host README. Port the three spike libraries and build the benchmark harness.
- **M1, one bot that does errands:**
  - bot CRUD (name, job, rules);
  - chat;
  - a Mastra agent per bot on Postgres, with prompt-prefix discipline;
  - per-run guards and metering;
  - approvals with Postgres resume.
- **M2, the computer:** computer service v1 (Xvfb + Chrome per screen), CDP live view and takeover, terminal,
  files, persistence and the website-login decision; browser tools via Stagehand + replay cache;
  wake-on-demand and stop-when-idle.
- **M3, integrations** (in parallel with M2): the shared OAuth layer, then Gmail, Calendar, Drive, Slack,
  Notion and GitHub, then Microsoft and Salesforce; custom MCP. **Start Google verification at the beginning
  of M3.**
- **M4, skills and automation:** skills, schedules and event triggers on Mastra, and recorded procedures (the
  takeover stream → replay format).
- **M5, collaboration:** several bots in one conversation, mentions and handoffs between bots, and team
  (shared) bots.
- **M6, polish:** mobile web, the spending UI, memory view/edit, the optional model-based reviewer.
- **M7, later:**
  - Firecracker microVMs with snapshot/restore;
  - a DeepSeek capacity request and a US/EU inference provider option;
  - load tests at thousands of concurrent runs;
  - the self-host installer and upgrade command, and a one-click app on a Vibe64 VPS;
  - export/import.

---

## 8. A person's own copy

| | |
|---|---|
| Model | **Bring your own key** (any configured provider, D-72) |
| Computers | On the same machine: Xvfb + Chrome screens in gVisor (`docs/deployment.md`) |
| Integrations | The person registers their own OAuth apps (Google restricted scopes need verification or "testing" mode), or links the copy to a hub that lends its apps (D-31) |
| Updates | Releases + one-command upgrade (`mercbot upgrade`) |

Open code is a trust feature for bots that act in people's accounts: anyone can read what their copy does.

---

## 9. Licensing and legal rules

### 9.1 License
- **AGPL-3.0** for all Mercbot code.
- Check every new dependency's license for AGPL compatibility. The current set is Apache-2.0 or MIT.
- Accept contributions under a **CLA** (or a DCO plus a relicensing clause), so a commercial license can be
  offered later.
- The **name and logo are trademarked separately**, and forks must rename.

### 9.2 Mastra `ee/` rule
- Some Mastra code ships *inside* the normal packages under a separate, non-free license, in `ee/` folders:
  `@mastra/core/auth/ee`, `@mastra/core/agent-builder/ee`, `@mastra/editor/ee`.
- **Never import from any `ee/` path.** A lint rule plus a CI check fails on any `@mastra/*` import containing
  `/ee/`.
- Mercbot doesn't need them: users and sign-in come from JSKIT, bot permissions are our approval rules, the
  bot editor is our own screen, and Studio is a developer tool.
- **Never read or port `ee/` source.** Write any similar feature from our own requirements.

---

## 10. Customising Mercbot with Vibe64

- **Mercbot is a model Vibe64 project.** In every change, keep the Genesis files (`genesis/blueprint.md`,
  `stack.md`, `subsystems.md`, `engineering.md`), AGENTS.md and the Colleague usage docs accurate. A
  stranger's Vibe64 agent must be able to understand and extend the project. Code stays simple and
  conventional (focused profile).
- **Extension points instead of core edits,** so customised copies keep merging with upstream:
  - `plugins/<name>/`: one folder per integration;
  - `skills/<name>/SKILL.md`;
  - `bot-templates/<name>`: name, job, rules, tools, avatar settings;
  - theme tokens for the look.
- **People fork the project** in Vibe64, change anything, and run their changed copy (the project's
  `genesis/stack.md`) with their own model key.
- **People who'd rather not change Mercbot itself** build an **MCP server** in Vibe64 and connect it as a
  custom integration.
- **Acceptance test for M7:** a fresh Vibe64 agent adds a new integration using only the project's own docs.

---

## 11. Open items

| Item | Notes |
|---|---|
| Firecracker spike | Boot a VM with Xvfb + Chrome; measure memory, boot time, snapshot and restore. Do it on bare metal. |
| Gmail integration spike | Needs a Google Cloud test project. |
| Idle CPU at density | Re-measure per-screen CPU on a server. |
| DeepSeek under load | Test at hundreds of concurrent runs; request more capacity. |
| Data residency | Add a US/EU inference provider option. |
| Google/Microsoft verification | Long lead time; start at the beginning of M3. |
| Mastra pace | Pin versions; upgrade on purpose. |
| Product name | Check products, domains and trademarks before registering. |
