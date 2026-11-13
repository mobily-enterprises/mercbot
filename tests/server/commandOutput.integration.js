import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startShell } from "../support/ownedHandles.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { createFileStore } from "../../packages/files/src/server/fileStore.js";
import { shellAvailable } from "../../packages/files/src/server/gvisor.js";
import { __testables } from "../../packages/files/src/server/shell.js";
import { buildTools } from "../../packages/bots/src/server/botTools.js";
import { turnDoubles } from "../support/botDoubles.mjs";

const { LIMITS } = __testables;

// A command's whole output (D-48): when run_command's result is cut, all of it is the file
// /runs/<run>.log, which the bot greps on its command line or reads in parts with
// read_command_output, from its own conversation only; it's gone after a week.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

test("a cut command output is read whole, in parts, by its own conversation", { skip: shellAvailable(process.env) ? false : "the toolbox isn't installed (npm run tools:install)" }, async (context) => {
  const knex = await connectTestDatabase();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mercbot-output-test-"));
  const userId = (await knex("users").first())?.id;
  const [home] = await knex("workspaces").insert({ slug: `output-${Date.now()}`, name: "Output test", owner_user_id: userId, is_personal: false }).returning("id");
  const homeId = home.id ?? home;
  const [bot] = await knex("bots").insert({ user_id: userId, workspace_id: homeId, name: "Outie", color: "#1E86FC" }).returning("id");
  const botId = String(bot.id ?? bot);
  const conversations = await knex("bot_conversations").insert([{ workspace_id: homeId, bot_id: botId, user_id: userId }, { workspace_id: homeId, bot_id: botId, user_id: null, title: "Other" }]).returning("id");
  const [mine, other] = conversations.map((row) => String(row.id ?? row));
  context.after(async () => {
    await knex("workspaces").where({ id: homeId }).del();
    await knex.destroy();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const store = createFileStore({ root: "", fallback: dir, ownStorage: async () => null, settle: async () => {}, explain: async () => {} });
  const { shell, commandOutput, inHome } = await startShell(knex, context, { store, limits: LIMITS });
  const place = { homeId, botId, userId };
  const files = { store, shell, commandOutput, apps: { session: () => ({ close() {} }) } };
  // The tools read and write with their turn's call options, in the bot's home.
  const toolsFor = (conversationId) =>
    buildTools(turnDoubles({ call: inHome(homeId), approvals: { decide: async () => "allow" }, computer: null, files, place, homeId, userId, botId, conversationId })).tools;
  const tools = toolsFor(mine);

  // 40,000 numbered lines, then one 200,000-character line: far past the 16,000 shown.
  const run = await tools.runCommand.execute({ why: "a long output", script: "seq 1 40000 | sed 's/^/line /'; head -c 200000 /dev/zero | tr '\\0' 'x'; echo; echo the end" });
  assert.equal(run.truncated, true);
  assert.match(run.wholeOutput, new RegExp(`/runs/${run.run}\\.log`, "u"));
  const grepped = await tools.runCommand.execute({ why: "find a line", script: `grep -c '^line ' /runs/${run.run}.log; grep -n '^line 20000$' /runs/${run.run}.log; touch /runs/x 2>&1 | head -1` });
  assert.match(grepped.output, /^40000\n20000:line 20000\n/u, "the middle is there, and grep works on it");
  assert.match(grepped.output, /Read-only file system|Permission denied/u, "and the bot can't change it");

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

  assert.match((await toolsFor(other).readCommandOutput.execute({ run: run.run })).error, /no such command in this conversation/u, "another conversation can't read it");
  assert.equal((await toolsFor(other).runCommand.execute({ why: "look", script: "ls /runs | wc -l" })).output.trim(), "0", "nor see it on its command line");
  const short = await tools.runCommand.execute({ why: "a short output", script: "echo hello" });
  assert.equal(short.wholeOutput, undefined);
  assert.match((await tools.readCommandOutput.execute({ run: short.run })).note, /wasn't cut/u);

  // After a week, it's removed.
  await shell.removeOldOutputs({ now: Date.now() + 8 * 86400 * 1000 });
  await assert.rejects(fs.access(path.join(store.runsRoot, mine, `${run.run}.log`)));
  assert.match((await tools.readCommandOutput.execute({ run: run.run })).note, /gone/u);
});
