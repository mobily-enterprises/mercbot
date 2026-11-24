import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { seedChat } from "../support/chatFixtures.mjs";
import { startShell } from "../support/ownedHandles.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { createFileStore } from "../../packages/files/src/server/fileStore.js";
import { shellAvailable } from "../../packages/files/src/server/gvisor.js";
import { __testables } from "../../packages/files/src/server/shell.js";

const { LIMITS } = __testables;
const SKIP = shellAvailable(process.env) ? false : "the toolbox isn't installed (npm run tools:install)";

// A command's whole output (D-48): when run_command's result is cut, all of it is the file
// /runs/<run>.log, which the bot greps on its command line or reads in parts with
// read_command_output, from its own seat in its chat only (chat_bots, D14); it's gone after a week.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

/** A home with bot Outie in two Public chats with the first user: `{ homeId, botId, userId, mine, other }`. */
async function twoChats(knex, context, dir) {
  const userId = String((await knex("users").first())?.id);
  const [home] = await knex("workspaces").insert({ slug: `output-${Date.now()}`, name: "Output test", owner_user_id: userId, is_personal: false }).returning("id");
  const homeId = String(home.id ?? home);
  const [bot] = await knex("bots").insert({ made_by: userId, workspace_id: homeId, name: "Outie", color: "#1E86FC" }).returning("id");
  const botId = String(bot.id ?? bot);
  const mine = await seedChat(knex, { homeId, kind: "public", people: [userId], bots: [botId] });
  const other = await seedChat(knex, { homeId, kind: "public", title: "Other", people: [userId], bots: [botId] });
  context.after(async () => {
    await knex("workspaces").where({ id: homeId }).del();
    await knex.destroy();
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { homeId, botId, userId, mine, other };
}

test("a cut command output is kept whole at /runs and read only by its own bot in its chat", { skip: SKIP }, async (context) => {
  const knex = await connectTestDatabase();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mercbot-output-test-"));
  const { homeId, botId, userId, mine, other } = await twoChats(knex, context, dir);
  const store = createFileStore({ root: "", fallback: dir, ownStorage: async () => null, settle: async () => {}, explain: async () => {} });
  const { shell, commandOutput, inHome } = await startShell(knex, context, { store, limits: LIMITS });
  const seatOf = (chat) => chat.chatBotIds.get(botId);
  const go = (chat, script) => shell.start({
    place: store.placeFor({ homeId, chatId: chat.id, chatKind: "public", botId }), workspaceId: homeId, botId, chatBotId: seatOf(chat), userId, why: "test", script
  });

  // 40,000 numbered lines, then one 200,000-character line: far past the 16,000 shown.
  const run = await go(mine, "seq 1 40000 | sed 's/^/line /'; head -c 200000 /dev/zero | tr '\\0' 'x'; echo; echo the end");
  assert.equal(run.truncated, true);
  const whole = await shell.wholeOutputOf({ id: run.run, chatBotId: seatOf(mine) });
  assert.ok(whole.startsWith("line 1\nline 2\n") && whole.includes("line 40000\n") && whole.trimEnd().endsWith("the end"), "all of it, through the very long line");
  const grepped = await go(mine, `grep -c '^line ' /runs/${run.run}.log; grep -n '^line 20000$' /runs/${run.run}.log; touch /runs/x 2>&1 | head -1`);
  assert.match(grepped.output, /^40000\n20000:line 20000\n/u, "the middle is there, and grep works on it");
  assert.match(grepped.output, /Read-only file system|Permission denied/u, "and the bot can't change it");

  // Its own seat reads it; the same bot in another chat, another home and a seat that isn't one read nothing.
  const found = await commandOutput(run.run, seatOf(mine), inHome(homeId));
  assert.deepEqual([found.id, found.chatBotId, found.status], [run.run, seatOf(mine), "done"]);
  assert.equal(await shell.wholeOutputOf(found), whole);
  assert.equal(await commandOutput(run.run, seatOf(other), inHome(homeId)), null, "another chat's bot can't read it");
  assert.equal(await commandOutput(run.run, seatOf(mine), inHome(Number(homeId) + 1000000)), null, "nor another home");
  for (const seat of [null, "x", `${seatOf(mine)} or 1=1`]) assert.equal(await commandOutput(run.run, seat, inHome(homeId)), null, String(seat));
  assert.equal((await go(other, "ls /runs | wc -l")).output.trim(), "0", "nor see it on its command line");
  const short = await go(mine, "echo hello");
  assert.ok(!short.truncated);
  assert.equal(await shell.wholeOutputOf({ id: short.run, chatBotId: seatOf(mine) }), null, "an output that wasn't cut isn't kept");

  // After a week, it's removed.
  await shell.removeOldOutputs({ now: Date.now() + 8 * 86400 * 1000 });
  await assert.rejects(fs.access(path.join(store.runsRoot, seatOf(mine), `${run.run}.log`)));
  assert.equal(await shell.wholeOutputOf(found), null);
});

// The bot's own tools on it, run_command and read_command_output (packages/bots commandTools.js), which page through
// the whole output.
test("read_command_output reads a cut output in parts, from its own chat only", { skip: SKIP }, async (context) => {
  const { buildTools } = await import("../../packages/bots/src/server/botTools.js");
  const { turnDoubles } = await import("../support/botDoubles.mjs");
  const knex = await connectTestDatabase();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mercbot-output-tools-"));
  const { homeId, botId, userId, mine, other } = await twoChats(knex, context, dir);
  const store = createFileStore({ root: "", fallback: dir, ownStorage: async () => null, settle: async () => {}, explain: async () => {} });
  const { shell, commandOutput, inHome } = await startShell(knex, context, { store, limits: LIMITS });
  const files = { store, shell, commandOutput, apps: { session: () => ({ close() {} }) } };
  // A turn's tools are the bot's in one chat, its seat there (chat_bot_id), and read and write with their turn's call
  // options, in the bot's home.
  const toolsFor = (chat) => buildTools(turnDoubles({
    call: inHome(homeId), approvals: { decide: async () => "allow" }, computer: null, files,
    seat: { id: botId, name: "Outie", workspace_id: homeId, user_id: userId, chat_id: chat.id, chat_bot_id: chat.chatBotIds.get(botId), chat: { id: chat.id, kind: "public" } },
    place: store.placeFor({ homeId, chatId: chat.id, chatKind: "public", botId })
  })).tools;
  const tools = toolsFor(mine);

  const run = await tools.runCommand.execute({ why: "a long output", script: "seq 1 40000 | sed 's/^/line /'; head -c 200000 /dev/zero | tr '\\0' 'x'; echo; echo the end" });
  assert.equal(run.truncated, true);
  assert.match(run.wholeOutput, new RegExp(`/runs/${run.run}\\.log`, "u"));
  const first = await tools.readCommandOutput.execute({ run: run.run });
  assert.match(first.output, /^line 1\nline 2\n/u);
  let from = Number(first.output.match(/from_line: (\d+)/u)[1]);
  let text = first.output;
  for (let parts = 0; parts < 10 && from; parts += 1) {
    const next = await tools.readCommandOutput.execute({ run: run.run, from_line: from });
    text += next.output;
    from = Number(next.output.match(/from_line: (\d+)/u)?.[1] || 0);
  }
  assert.ok(text.includes("line 40000\n") && text.trimEnd().endsWith("the end"), "reading on reaches the end, through the very long line");
  assert.match((await toolsFor(other).readCommandOutput.execute({ run: run.run })).error, /no such command in this (conversation|chat)/u, "another chat can't read it");
  const short = await tools.runCommand.execute({ why: "a short output", script: "echo hello" });
  assert.equal(short.wholeOutput, undefined);
  assert.match((await tools.readCommandOutput.execute({ run: short.run })).note, /wasn't cut/u);
  await shell.removeOldOutputs({ now: Date.now() + 8 * 86400 * 1000 });
  assert.match((await tools.readCommandOutput.execute({ run: run.run })).note, /gone/u);
});
