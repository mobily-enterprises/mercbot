// readable-check: allow no-direct-knex - infrastructure: a developer's evaluation run makes and clears a disposable bot's rows on a disposable database
// Our side of the shared agent cases (D-48): each case runs through a real bot reply (the whole
// pipeline: every tool, the state note, the reply checks) with the real model and the bots' own
// command line (the gVisor toolbox), on the test database, in a disposable bot. Same prompts, inputs
// and judges as scripts/agent-evals-dsh.mjs. Usage:
//   DB_NAME=$TEST_DB_NAME node scripts/agent-evals-ours.mjs [--runs 3] [--only a,b] [--label name]
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import knexLib from "knex";
import { createMeter, createMeteredFetch } from "../packages/account/src/server/meter.js";
import { providerCostNano } from "../packages/account/src/server/cost.js";
import { REASONING, createTool, unsupportedClaims } from "@jskit-ai/agent/server";
import { generateReply } from "../packages/bots/src/server/botAgent.js";
import { createChatModel } from "../packages/bots/src/server/model.js";
import { createBotsService } from "../packages/bots/src/server/botsService.js";
import { createFileStore } from "../packages/files/src/server/fileStore.js";
import { createOfficeApps } from "../packages/files/src/server/officeApps.js";
import { startApps } from "../tests/support/appsFeatures.mjs";
import { serviceDoubles } from "../tests/support/botDoubles.mjs";
import { memberOptions, startBotParts } from "../tests/support/botRecords.mjs";
import { seedChat } from "../tests/support/chatFixtures.mjs";
import { startShell } from "../tests/support/ownedHandles.mjs";

if (!process.env.TEST_DB_NAME || process.env.DB_NAME !== process.env.TEST_DB_NAME) throw new Error("Run with DB_NAME=$TEST_DB_NAME: evaluations use the test database only.");
const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const runs = Number(option("runs", 3));
// "shared": the cases DeepSeek Harness also runs; "mercbot": building Mercbot apps (ours only).
const suite = option("suite", "shared");
// Experiments (D-48): "base" is the bot as it is; "minimal-tools" gives the model only the
// harness-like tools (files and the command line); "quiet" drops the narration instructions and the
// tools' acknowledgement lines.
const variant = option("variant", "base");
const MINIMAL = new Set(["list_files", "read_file", "move_file", "run_command", "check_command"]);
const NARRATION = /status line|acknowledg|Keep the person informed/iu;
// Its responses are counted like the meter counts ours: one model call each, with its tokens.
async function anthropicFetch(input, init) {
  if (process.env.EVAL_TRACE_FILE) await fs.appendFile(process.env.EVAL_TRACE_FILE, `${init.body}\n`);
  const response = await fetch(input, init);
  if (process.env.EVAL_TRACE_FILE) await fs.appendFile(process.env.EVAL_TRACE_FILE, `RESPONSE ${await response.clone().text()}\n`);
  if (response.ok) {
    response.clone().json().then(({ usage: used }) => {
      if (used) usage.push({ kind: "model", cacheHit: used.cache_read_input_tokens || 0, cacheMiss: used.input_tokens || 0, output: used.output_tokens || 0 });
    }).catch(() => {});
  }
  return response;
}
// People's chat runs on the premium AI (D-72), so the experiments below call Together with its key; the DeepSeek ones
// need EVAL_DEEPSEEK_API_KEY, a key for DeepSeek's own API that only these experiments use.
const meteredFetch = createMeteredFetch(process.env, "together");
const noReasoningBackModel = variant === "no-reasoning-back"
  ? createDeepSeek({
    apiKey: process.env.AI_PREMIUM_API_KEY, baseURL: "https://api.together.xyz/v1",
    fetch: (input, init) => {
      const body = JSON.parse(init.body);
      for (const message of body.messages || []) delete message.reasoning_content;
      return meteredFetch(input, { ...init, body: JSON.stringify(body) });
    }
  })("deepseek-ai/DeepSeek-V4.1-Flash")
  : null;
const deepseekOpenaiModel = variant === "deepseek-openai"
  ? createDeepSeek({ apiKey: process.env.EVAL_DEEPSEEK_API_KEY, baseURL: "https://api.deepseek.com", fetch: meteredFetch })("deepseek-flash")
  : null;
const deepseekAnthropicModel = variant === "deepseek-anthropic"
  ? createAnthropic({ apiKey: process.env.EVAL_DEEPSEEK_API_KEY, baseURL: "https://api.deepseek.com/anthropic/v1", fetch: anthropicFetch })("deepseek-v4-flash")
  : null;
const anthropicModel = variant === "anthropic"
  ? createAnthropic({ apiKey: process.env.AI_PREMIUM_API_KEY, baseURL: "https://api.together.xyz/v1", fetch: anthropicFetch })("deepseek-ai/DeepSeek-V4.1-Flash")
  : null;
function variantReply(bot, timeline, tools, state, prompt, options = {}) {
  if (variant === "minimal-tools") {
    tools = Object.fromEntries(Object.entries(tools).filter(([, tool]) => MINIMAL.has(tool.id)));
  }
  // DeepSeek's own Anthropic-style endpoint, set up as Claude Code calls it: adaptive thinking at
  // high effort on every step, signed reasoning sent back, DeepSeek's automatic cache.
  if (variant === "deepseek-anthropic") {
    options = { ...options, languageModel: deepseekAnthropicModel };
  }
  // DeepSeek's own endpoint in the OpenAI style, as Together is called today: is it the format or
  // the provider?
  if (variant === "deepseek-openai") {
    options = { ...options, languageModel: deepseekOpenaiModel };
  }
  // The same model through Together's Anthropic-style messages endpoint (it doesn't sign reasoning,
  // so none goes back, and it reports no cache).
  if (variant === "anthropic") {
    options = { ...options, languageModel: anthropicModel, reasoning: { anthropic: { thinking: { type: "enabled", budgetTokens: 16000 } } } };
  }
  // The usual endpoint and format, but DeepSeek's earlier reasoning isn't sent back to it.
  if (variant === "no-reasoning-back") {
    options = { ...options, languageModel: noReasoningBackModel };
  }
  // No reasoning at all, to see what it costs in time.
  if (variant === "thinking-off") {
    options = { ...options, reasoning: REASONING.off };
  }
  if (variant === "quiet") {
    tools = Object.fromEntries(Object.entries(tools).map(([key, tool]) => {
      const shape = tool.inputSchema?.shape;
      if (!shape?.acknowledgement) return [key, tool];
      return [key, createTool({ id: tool.id, description: tool.description, inputSchema: tool.inputSchema.omit({ acknowledgement: true }), execute: tool.execute })];
    }));
    options = { ...options, transformInstructions: (text) => text.split(/(?<=[.!?])\s+/u).filter((sentence) => !NARRATION.test(sentence)).join(" ") };
  }
  return generateReply(bot, timeline, tools, state, prompt, options);
}
const only = (option("only", "") || "").split(",").filter(Boolean);
const label = option("label", `ours-${new Date().toISOString().slice(0, 16).replace(/[:T]/gu, "")}`);
const CASES = path.resolve("tests/agent-evals", suite);
const OUT = path.resolve("artifacts/agent-evals", label);
mkdirSync(OUT, { recursive: true });

const knex = knexLib({ client: "pg", connection: { host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME } });
const root = await fs.mkdtemp(path.join(os.tmpdir(), "mercbot-evals-"));
// As filesRuntime assembles it: no home has connected its own storage here, and nothing is mounted to settle.
const store = createFileStore({ root: "", fallback: root, ownStorage: async () => null, settle: async () => {} });
// The features started here (the command line's handles, the bots' records, the Apps feature), stopped as the run ends.
const stops = [];
const features = { after: (stop) => stops.unshift(stop) };
// The command line on the files feature's own handles, as filesRuntime builds it.
const { shell, commandOutput } = await startShell(knex, features, { store });
if (!shell.available()) throw new Error("The command line isn't available here: run npm run tools:install first.");
const files = { store, shell, commandOutput, apps: createOfficeApps({ store, env: process.env }) };
// The meter's recorder, kept in memory: each AI call's figures and what it cost at its provider (D-73).
let usage = [];
const recorder = {
  open: async (call) => ({ provider: call.provider }),
  finish: async (ticket, outcome) => {
    usage.push({ ...outcome, kind: "model", costNano: providerCostNano(outcome, ticket.provider) });
  }
};
const meter = createMeter({ recorder });
// News between servers isn't needed here: one process, no open pages.
const notices = { publish: async () => {}, subscribe: () => () => {} };
// What BotsFeature gives the bots service on the bots' own records (D-112: chats, their people and bots), and the Apps
// feature as the server starts it on those records (mercbot.apps: registry, gate, apps, views, runtime, watches,
// scripts, templates), on the test database, as the integration tests start them (tests/support).
const parts = await startBotParts(knex, features);
const started = await startApps({ knex, env: process.env, records: parts.records });
features.after(started.stop);
const { apps } = started;
// The final-reply check is on, as for real replies (D-48).
const chatModel = createChatModel(process.env);
// No computer and no connected accounts here: those come neutral from the test doubles.
// The run's own meter (its recorder above) in place of the account's.
const service = createBotsService(serviceDoubles({
  ...parts,
  model: chatModel,
  knex,
  approvals: { decide: async () => "allow" },
  meter,
  notices,
  files,
  apps,
  reply: variantReply,
  checkClaims: (reply, record) => unsupportedClaims({ model: chatModel, reply, record })
}));
const userId = String((await knex("users").orderBy("id").first("id")).id);
const homeId = (await knex("workspace_memberships").where({ user_id: userId, status: "active" }).orderBy("workspace_id").first()).workspace_id;

// The reply, then any goal rounds (D-48), as the server's runners would carry them on: a chat's bots' runs and goals
// are keyed by their seats in it (chat_bots ids, D-112).
async function settle(chatId) {
  const seats = knex("chat_bots").select("id").where({ conversation_id: chatId });
  const deadline = Date.now() + 30 * 60 * 1000;
  while (Date.now() < deadline) {
    await service.drain(30 * 60 * 1000);
    await service.goals.runDue();
    const due = await knex("agent_goals").whereIn("conversation_id", seats).where({ status: "active" }).whereNotNull("round_at").first();
    if (!due && !await knex("agent_runs").whereIn("conversation_id", seats).first()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** The person's words in a chat, and the bots' replies, as the chat routes run them (D-112). */
async function ask(chatId, text, workspaceId) {
  const options = memberOptions({ userId, homeId: String(workspaceId) });
  const sent = await service.chat.sendMessage(String(chatId), { text, clientId: `eval-${Date.now()}` }, options);
  await service.chat.reply(String(chatId), { afterMessageId: sent.messages.at(-1).id }, undefined, options);
  await settle(chatId);
  return sent.messages.at(-1);
}

/** The bots' words in a chat's messages. */
const botReply = (messages) => messages.filter((message) => message.role === "bot" && message.kind === "text").map((message) => message.body.text).join("\n\n");

/**
 * A case's figures once it has run: its tool calls, what the meter counted since `usage` was cleared, the bot's latest
 * goal, and whether the reply leaked the model's own markup.
 */
async function runFigures(messages, chatBotId, reply) {
  const toolCalls = messages.flatMap((message) => message.body?.transcript || []).flatMap((message) => (Array.isArray(message.content) ? message.content.filter((part) => part.type === "tool-call") : [])).length;
  const tokens = usage.reduce((sum, event) => sum + (event.cacheHit || 0) + (event.cacheMiss || 0) + (event.output || 0), 0);
  const cost = usage.reduce((sum, event) => sum + event.costNano, 0) / 1e9;
  const goal = await knex("agent_goals").where({ conversation_id: chatBotId }).orderBy("id", "desc").first();
  return {
    toolCalls,
    tokens,
    cost: Number(cost.toFixed(4)),
    goal: goal ? `${goal.status}/${goal.rounds}` : "-",
    leaked: /｜DSML｜|<parameter|<｜|<invoke|<budget:/u.test(reply),
    steps: usage.filter((event) => event.kind === "model").length,
    cached: Math.round(100 * usage.reduce((sum, event) => sum + (event.cacheHit || 0), 0) / Math.max(1, usage.reduce((sum, event) => sum + (event.cacheHit || 0) + (event.cacheMiss || 0), 0)))
  };
}

async function runCase(name, attempt) {
  const dir = path.join(CASES, name);
  const [bot] = await knex("bots").insert({ made_by: userId, workspace_id: homeId, name: `Eval ${name} ${attempt}`, color: "#1E86FC" }).returning("*");
  // The person's direct chat with the bot (Public, D15), whose folder is the project's (/files/chat, R6).
  const chat = await seedChat(knex, { homeId, direct: { userId, botId: bot.id } });
  const chatBotId = chat.chatBotIds.get(String(bot.id));
  const place = store.placeFor({ homeId, chatId: chat.id, chatKind: "public", botId: bot.id });
  const dirs = await store.prepare(place);
  const judgeDir = mkdtempSync(path.join(os.tmpdir(), `judge-${name}-`));
  try {
    if (existsSync(path.join(dir, "files"))) cpSync(path.join(dir, "files"), dirs.chat, { recursive: true });
    // Fixture test files are stored as *.fixture so the app's own test run skips them.
    for (const file of readdirSync(dirs.chat, { recursive: true }).filter((entry) => entry.endsWith(".fixture"))) renameSync(path.join(dirs.chat, file), path.join(dirs.chat, file.slice(0, -".fixture".length)));
    if (existsSync(path.join(dir, "hidden"))) cpSync(path.join(dir, "hidden"), judgeDir, { recursive: true });
    if (existsSync(path.join(dir, "setup.py"))) spawnSync("python3", [path.join(dir, "setup.py"), dirs.chat, judgeDir], { stdio: "inherit" });
    const prompt = `The project folder is /files/chat.\n\n${readFileSync(path.join(dir, "prompt.md"), "utf8")}`;
    usage = [];
    const started = Date.now();
    await meter.track({ userId, botId: String(bot.id) }, () => ask(chat.id, prompt, homeId));
    const seconds = Math.round((Date.now() - started) / 1000);
    const messages = await knex("messages").where({ conversation_id: chat.id }).orderBy("id");
    const reply = botReply(messages);
    // The judge's files join the folder only now, so the bot never saw them.
    for (const file of readdirSync(dir).filter((entry) => entry.startsWith("judge"))) cpSync(path.join(dir, file), path.join(dirs.chat, file));
    cpSync(judgeDir, dirs.chat, { recursive: true });
    const judgeFile = readdirSync(dir).find((entry) => entry.startsWith("judge"));
    const command = judgeFile.endsWith(".py") ? `python3 ${judgeFile}` : `node --test ${judgeFile}`;
    const judged = await shell.start({ place, workspaceId: homeId, botId: bot.id, chatBotId, userId, why: "judge", script: `cd /files/chat && ${command}` });
    const pass = judged.status === "done" && Number(judged.exitCode ?? 0) === 0;
    const { leaked, goal, steps, toolCalls, tokens, cached, cost } = await runFigures(messages, chatBotId, reply);
    const result = { name, attempt, pass, variant, leaked, goal, seconds, steps, toolCalls, tokens, cached, cost, judge: String(judged.output || judged.error || "").slice(-600), reply: reply.slice(0, 1500) };
    writeFileSync(path.join(OUT, `${name}-${attempt}.json`), JSON.stringify({ ...result, messages }, null, 1));
    return result;
  } finally {
    await knex("bots").where({ id: bot.id }).del();
  }
}

// A Mercbot app case: its own throwaway home with this bot as the Builder, the case's setup, the
// person's words, then the case's judge on the home's apps and data.
async function runAppCase(name, attempt) {
  const kase = await import(path.join(CASES, `${name}.mjs`));
  const [home] = await knex("workspaces").insert({ slug: `eval-${name}-${Date.now().toString(36)}`, name: `Eval ${name}`, owner_user_id: userId, is_personal: false }).returning("*");
  await knex("workspace_memberships").insert({ workspace_id: home.id, user_id: userId, role_sid: "owner", status: "active" });
  await knex("workspace_settings").insert({ workspace_id: home.id }).catch(() => {});
  const [bot] = await knex("bots").insert({ made_by: userId, workspace_id: home.id, name: "Builder", color: "#1C1C1C", is_main: true }).returning("*");
  const actor = { type: "person", id: userId, name: "Eval" };
  // The person's call options in the home, as its owner: what a case's setup and judge pass the apps.
  const options = memberOptions({ userId, homeId: String(home.id), role: "owner", permissions: ["workspace.settings.update"] });
  try {
    // A group case asks in a chat of the person and the bot (not their direct chat), mentioning it (R3); the rest in
    // their direct chat (D15). A case's setup may seed that chat (chatId).
    const chat = await seedChat(knex, kase.group ? { homeId: home.id, people: [userId], bots: [bot.id] } : { homeId: home.id, direct: { userId, botId: bot.id } });
    const chatBotId = chat.chatBotIds.get(String(bot.id));
    const ctx = { knex, apps, workspaceId: home.id, userId, actor, options, bot, chatId: String(chat.id) };
    // App cases make the bot the home's Builder, as an owner does; chat cases use an ordinary bot.
    if (kase.builder !== false) await apps.apps.setBuilder(actor, String(bot.id), options);
    if (kase.setup) await kase.setup(ctx);
    usage = [];
    const started = Date.now();
    let askedId = 0;
    // One message in the chat and all that follows from it; a case's `script` holds a whole conversation.
    const say = async (text) => {
      const sent = await meter.track({ userId, botId: String(bot.id) }, () => ask(chat.id, text, home.id));
      askedId ||= Number(sent.id);
      const last = await knex("messages").where({ conversation_id: chat.id, author_bot_id: bot.id, kind: "text" }).orderBy("id", "desc").first();
      return last?.body.text || "";
    };
    if (kase.script) await kase.script({ ...ctx, say, service, userId });
    else await say(kase.group ? `<@bot:${bot.id}> ${kase.prompt}` : kase.prompt);
    const seconds = Math.round((Date.now() - started) / 1000);
    // Only what came after the case's message: a case may seed a long history first.
    const messages = await knex("messages").where({ conversation_id: chat.id }).where("id", ">", askedId).orderBy("id");
    const reply = botReply(messages);
    const verdict = await kase.judge({ ...ctx, reply }).catch((error) => ({ pass: false, notes: `judge error: ${error.message}` }));
    const { leaked, goal, steps, toolCalls, tokens, cached, cost } = await runFigures(messages, chatBotId, reply);
    const result = { name, attempt, pass: verdict.pass, variant, leaked, goal, seconds, steps, toolCalls, tokens, cached, cost, judge: verdict.notes, reply: reply.slice(0, 1500) };
    writeFileSync(path.join(OUT, `${name}-${attempt}.json`), JSON.stringify({ ...result, messages }, null, 1));
    return result;
  } finally {
    await knex("workspaces").where({ id: home.id }).del().catch((error) => console.error(`Couldn't remove the eval home: ${error.message}`));
  }
}

// Folder cases (shared, hard) run in a workspace; module cases (mercbot, chat) in a home.
const inHome = ["mercbot", "chat", "memory", "views"].includes(suite);
const names = inHome
  ? readdirSync(CASES).filter((entry) => entry.endsWith(".mjs") && entry !== "helpers.mjs").map((entry) => entry.slice(0, -4)).filter((entry) => !only.length || only.includes(entry))
  : readdirSync(CASES).filter((entry) => !only.length || only.includes(entry));
const results = [];
try {
  for (const name of names) {
    for (let attempt = 1; attempt <= runs; attempt += 1) {
      const result = await (inHome ? runAppCase : runCase)(name, attempt).catch((error) => ({ name, attempt, pass: false, error: String(error?.message || error).slice(0, 300) }));
      results.push(result);
      console.log(`${name} #${attempt}: ${result.pass ? "PASS" : "FAIL"}${result.leaked ? " LEAKED" : ""} in ${result.seconds ?? "?"}s, ${result.cached ?? "?"}% cached, goal ${result.goal ?? "-"}, ${result.steps ?? "?"} model calls, ${result.toolCalls ?? "?"} tool calls, $${result.cost ?? "?"}${result.error ? ` (${result.error})` : ""}`);
      writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
    }
  }
  const median = (list) => list.filter((value) => value !== undefined).sort((a, b) => a - b)[Math.floor(list.length / 2)];
  const lines = ["| case | passed | median s | median model calls | median tool calls | median $ |", "|---|---|---|---|---|---|"];
  for (const name of names) {
    const mine = results.filter((result) => result.name === name);
    lines.push(`| ${name} | ${mine.filter((result) => result.pass).length}/${mine.length} | ${median(mine.map((result) => result.seconds))} | ${median(mine.map((result) => result.steps))} | ${median(mine.map((result) => result.toolCalls))} | ${median(mine.map((result) => result.cost))} |`);
  }
  writeFileSync(path.join(OUT, "summary.md"), `${lines.join("\n")}\n`);
  console.log(lines.join("\n"));
} finally {
  await service.drain(10000);
  await shell.drain?.(10000);
  for (const stop of stops) await stop();
  await knex.destroy();
  await fs.rm(root, { recursive: true, force: true });
  // Timers in the services would keep the process alive.
  process.exit(0);
}
