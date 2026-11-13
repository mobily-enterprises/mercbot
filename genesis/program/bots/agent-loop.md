# Agent loop

The agent loop Mercbot's replies run on (D-52), from JSKIT: `@jskit-ai/agent` (`/server`: the model
call, reasoning, tools, context for a 1-million-token window and the checks on every reply) and
`@jskit-ai/agent-runtime` (`/server`: saved runs, goals, summaries, planning, the default tools, the
executors and their tables). Its source and its own tests live in JSKIT; this is the contract
Mercbot relies on. Mercbot's bots plug their instructions, tools and cards into it
(`genesis/program/bots/conversations.md`); the full account of the design, its decisions and the
evaluations is `docs/agent-loop.md`.

## Sources

- Main: `packages/bots/src/server/botAgent.js`
- `packages/bots/src/server/botHistory.js`
- `packages/bots/src/server/model.js`
- `packages/bots/package.json`
- `package.json`
- `migrations/20261113120000_baseline.cjs`
- `tests/server/leakedMarkup.test.js`
- `tests/server/turnContext.test.js`
- `tests/server/stoppedShort.test.js`
- `tests/server/compaction.test.js`
- `tests/server/repeatReminder.test.js`

## Public contract

- `runLoop({ model, name, instructions, history, tools, summary, state, maxSteps, onSteps, carriesOn,
  quietIfEmpty, clean, reasoning, maxOutputTokens, turnLimits, deadlineMs })` runs one reply on the AI
  SDK's `generateText` until the model answers without a tool call, runs out of steps or reaches its
  deadline (15 minutes). The summary, the state note and any other system messages in `history` join
  the instructions in the system prompt, in that order: one message in the OpenAI style, separate
  blocks in the Anthropic format. Every step reasons (`REASONING.on`); old tool results give way past
  700k tokens (`trimOldResults`); `onSteps(transcript)` hears the whole run so far after each step.
  It returns `{ text, transcript, unfinished?, account? }`; a reply that stopped early ends with the
  model's own account of where it got to (`account`), saying it carries on by itself when `carriesOn`,
  and the stopped-short check leaves that account alone.
- `chatModel({ apiKey, model, baseURL, anthropicURL, fetch })`: DeepSeek's Flash model in the Anthropic
  format when `anthropicURL` is set (DeepSeek's own API), else the OpenAI style (Together AI).
  `generateOnce` is one call without tools. Failed calls are retried 6 times (2, 4, 8… s).
- `createTool({ id, description, inputSchema, execute })` defines a tool; the model is offered it by
  its key, with the schema rewritten by `toolSchema` as DeepSeek models were always shown it (string,
  number and array limits as "constraints: …" in the description), and input checked against the
  original schema.
- Context: `withinBudget` (cut past 600k tokens, saying so), `summaryNote`, `estimateTokens`,
  `textPart` (long text in parts of about 30k tokens, very long lines split).
- Checks: `stoppedShort`, `LEAKED_MARKUP` / `withoutMarkup`, `reportsActions` / `toolRecord` /
  `unsupportedClaims`, `withoutClosingWords`, and `checkTexts(app)`, the notes a reply is sent back
  with, signed by the app.
- Runs: `createRuns({ knex, table })` keeps one reply per conversation (`claim`, `heartbeat`,
  `release`), saves its steps as they happen (`save`, `saved`) and lets any server take over one a
  stopped server left (`takeOverStalled`); `startResumer({ runs, resume, resumable })` does that
  every 30 seconds.
- Goals: `createGoals({ knex, runs, table, channel, find, respond, claim, record, notify, owner,
  spent, track, background })` gives each turn its goal operations (`operationsFor`, used by
  `goalTools`: `create_goal`, `get_goal`, `update_goal`), queues the next round after a turn
  (`afterTurn`) until the goal is complete, blocked, or at its round or cost limit
  (`AGENT_JOB_COST_USD`), and runs rounds claimed once across servers (`start`). `openFor` opens one
  for a reply that ran out of steps or time.
- Summaries: `createSummaries({ knex, model, app, history, track, tables, channel })` summarises a
  conversation in the background past 450k tokens (`consider`, `start`), or before a reply past 550k
  (`ensureWithin`); a reply reads `current(conversationId)`.
- Planning: `planningTools({ knex, conversationId, post, tables })` gives `keep_notes` and, with
  `post`, `update_todos` (a to-do card in the chat); `planningNotes` puts both in the state note.
- Turn wrappers: `hearWhileWorking(tool, inbox)` hands the model what the person wrote mid-reply with
  the next tool result; `remindOnRepeat(tool, repeats)` notes the 3rd, 5th and 8th identical call.
- Tables (`@jskit-ai/agent-runtime`'s `migrations/agent_initial.cjs`, found through its
  `package.json#jskit.migrations`): `agent_runs`, `agent_goals`, `agent_summaries`,
  `agent_summary_queue`, `agent_commands`, each keyed by `conversation_id` without a foreign key;
  the app adds that key, and columns of its own, in its own migration
  (`migrations/20261113120000_baseline.cjs`).
- Default tools: `defaultTools({ root, commands, knex, conversationId, post, goals, tables })` gives
  `list_files`, `find_files`, `search`, `read_file`, `write_file`, `edit_file` (`fileTools`, confined
  to the workspace `root`, links followed), `run_command`, `check_command`, `read_command_output`
  (`commandTools` over `createCommands({ knex, executor, outputDir, onEnd })`), `keep_notes`,
  `update_todos`, the goal tools and `ask_user`, each left out when what it needs isn't given.
- Executors: `gvisorExecutor()` (the default: gVisor's own kernel, no network, the machine's
  programs read-only, people's and services' folders hidden, only the workspace writable) and
  `localExecutor()` (opt in, no sandbox). Neither passes the server's environment to a command.
