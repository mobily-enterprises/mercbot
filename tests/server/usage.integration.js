import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { text } from "node:stream/consumers";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { ACCOUNT_OWNS } from "../../packages/account/src/server/AccountFeature.js";
import { providerCostNano } from "../../packages/account/src/server/cost.js";
import { createReports, csvCell, csvDollars } from "../../packages/account/src/server/reports.js";
import { HOMES_PER_FILE, createRetention } from "../../packages/account/src/server/retention.js";
import { createSpending } from "../../packages/account/src/server/spending.js";
import { createUsageRecorder } from "../../packages/account/src/server/usage.js";
import { ownedHandles } from "../support/ownedHandles.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";

// What work uses (D-56, D-73), on the database every server shares (D-15): Mercbot's own recorder counts each AI call,
// a computer's day and commands' seconds for the home, person and bot they were for, with what each cost at its
// provider, and never holds, refuses or pauses anything; who sees which spending; and old daily totals archived once
// by many servers.

/**
 * A home of its own with an owner, a member and two bots (the member's named like a spreadsheet formula), so each
 * test's figures are its own.
 */
async function setup(context) {
  const knex = await connectTestDatabase();
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const [owner, member] = await knex("users").insert([
    { auth_provider: "test", auth_provider_user_sid: `own-${stamp}`, email: `own-${stamp}@example.com`, username: `own${stamp}`, display_name: "Olive" },
    { auth_provider: "test", auth_provider_user_sid: `mem-${stamp}`, email: `mem-${stamp}@example.com`, username: `mem${stamp}`, display_name: "Max" }
  ]).returning("id");
  const [home] = await knex("workspaces").insert({ slug: `usage-${stamp}`, name: `Usage ${stamp}`, owner_user_id: owner.id, is_personal: false }).returning("id");
  await knex("workspace_memberships").insert([
    { workspace_id: home.id, user_id: owner.id, role_sid: "owner", status: "active" },
    { workspace_id: home.id, user_id: member.id, role_sid: "member", status: "active" }
  ]);
  const [bot, formula] = await knex("bots").insert([
    { user_id: owner.id, workspace_id: home.id, name: "Scout", color: "#1E86FC" },
    { user_id: member.id, workspace_id: home.id, name: "=HYPERLINK(\"x\")", color: "#1E86FC" }
  ]).returning("*");
  const { features, profiles } = await ownedHandles(knex, context, { "mercbot.account": ACCOUNT_OWNS });
  const { resources, systemContext } = features["mercbot.account"];
  // Database clean-ups a test adds run before the connection closes: a test's own after hooks would run after it.
  const cleanups = [];
  context.after(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    await knex.destroy();
  });
  const directory = {
    botOwner: async (botId) => {
      const found = [bot, formula].find((entry) => String(entry.id) === String(botId));
      return found ? { userId: String(found.user_id), workspaceId: String(home.id), name: found.name } : null;
    }
  };
  const recorder = (now) => createUsageRecorder({ resources, systemContext, directory, ...(now ? { now } : {}) });
  return {
    knex, resources, systemContext, profiles, recorder, cleanup: (step) => cleanups.push(step),
    homeId: String(home.id), ownerId: String(owner.id), memberId: String(member.id), botId: String(bot.id), formulaBot: String(formula.id)
  };
}

const NANO = 1e9;
const sum = async (knex, table, column, where) => Number((await knex(table).where(where).sum({ total: column }))[0].total) || 0;

test("every AI call, computer day and command is recorded with what it cost at its provider; nothing is held, refused or paused", async (context) => {
  const { knex, recorder: make, homeId, ownerId, memberId, botId } = await setup(context);
  const recorder = make();
  const since = new Date(Date.now() - 1000);
  const chat = { state: "done", cacheHit: 100, cacheMiss: 200, output: 50 };
  await recorder.finish(await recorder.open({ userId: ownerId, botId, work: "chat", provider: "together", requestChars: 3000, mostOutput: 1000 }), chat);
  await recorder.finish(await recorder.open({ userId: memberId, botId, work: "build", provider: "deepinfra", requestChars: 2000 }), { state: "done", reportedCost: 0.01 });
  const picture = { state: "done", cacheMiss: 10, output: 1290, images: 1 };
  await recorder.finish(await recorder.open({ userId: memberId, botId, provider: "gemini", pictures: 1 }), picture);
  const events = await knex("usage_events").where({ workspace_id: homeId }).orderBy("id");
  assert.deepEqual(
    events.map((event) => [event.kind, event.purpose, event.state, event.bot_name, Number(event.cost_nano)]),
    [
      ["premium", "chat", "done", "Scout", providerCostNano(chat, "together")],
      ["economy", "build", "done", "Scout", 1e7],
      ["images", "chat", "done", "Scout", providerCostNano(picture, "gemini", 1)]
    ],
    "each at its provider's cost, its own figure when it gives one"
  );

  // A computer's day is counted once a day, however often it wakes, at no cost of its own; one that couldn't start
  // counts nothing.
  const computer = { computerId: "1", botId, userId: memberId };
  const couldnt = await recorder.startComputerDay({ computerId: "2", botId });
  assert.equal(await recorder.release(couldnt), true);
  assert.equal(await recorder.computerDay(computer), true);
  assert.equal(await recorder.computerDay(computer), false, "once a day");
  assert.equal(await recorder.startComputerDay(computer), null, "a day counted already starts nothing");
  assert.equal(await make(() => new Date(Date.now() + 86400000)).computerDay(computer), true, "and again the next day");
  assert.equal(await sum(knex, "usage_daily", "calls", { workspace_id: homeId, kind: "computer" }), 2, "a computer's calls are its days");
  assert.equal(await sum(knex, "usage_daily", "cost_nano", { workspace_id: homeId, kind: "computer" }), 0);

  // A command's computation is never stopped for what it uses, and is counted in seconds, without a row of its own.
  const command = await recorder.startComputation({ botId, userId: memberId });
  for (let block = 0; block < 3; block += 1) assert.equal(await recorder.renewComputation(command), true);
  assert.equal(await recorder.finishComputation(command, 700), true);
  assert.equal(await sum(knex, "usage_daily", "seconds", { workspace_id: homeId, kind: "computation" }), 700);
  assert.equal(await knex("usage_events").where({ workspace_id: homeId, kind: "computation" }).first(), undefined);

  // The totals add up the rows they count, and a goal's spending is the member's work on the bot since it began.
  for (const column of ["calls", "cost_nano", "seconds"]) {
    assert.equal(await sum(knex, "usage_monthly", column, { workspace_id: homeId }), await sum(knex, "usage_daily", column, { workspace_id: homeId }), column);
  }
  assert.equal(await recorder.spentSince({ workspaceId: homeId, userId: memberId, botId, since }), (1e7 + providerCostNano(picture, "gemini", 1)) / 1e9);

  // However much a home has used, nothing is refused, held or paused: the largest call opens. (No other table keeps
  // anything for a home's use: everyTableOwned.integration.js finds every table a feature's.)
  await knex("usage_monthly").insert({ workspace_id: homeId, month: `${new Date().toISOString().slice(0, 7)}-01`, bot_id: 0, user_id: 0, kind: "premium", calls: 1, cost_nano: 1e15 });
  const largest = await recorder.open({ userId: memberId, botId, provider: "together", requestChars: 3e9, mostOutput: 1e9 });
  assert.equal(await recorder.finish(largest, { state: "failed" }), true);
  assert.equal(await recorder.pausedMessage(homeId), null);
});

test("owners and admins see the whole home's spending; a member sees their own use", async (context) => {
  const { knex, resources, systemContext, profiles, recorder: make, homeId, ownerId, memberId, botId } = await setup(context);
  const recorder = make();
  const spending = createSpending({ resources, systemContext });
  const reports = createReports({ resources, systemContext, profiles });
  await recorder.finish(await recorder.open({ userId: ownerId, botId, provider: "together" }), { state: "done", reportedCost: 0.5 });
  await recorder.finish(await recorder.open({ userId: memberId, botId, provider: "deepinfra" }), { state: "done", reportedCost: 0.25 });
  const picture = { state: "done", cacheMiss: 10, output: 1290, images: 2 };
  await recorder.finish(await recorder.open({ userId: memberId, botId, provider: "gemini", pictures: 2 }), picture);
  const pictures = providerCostNano(picture, "gemini", 2);

  const owner = { userId: ownerId, manages: true };
  const member = { userId: memberId, manages: false };
  const month = new Date().toISOString().slice(0, 7);
  assert.deepEqual(await spending.summary(homeId, owner), { scope: "home", month, monthNano: 5e8 + 2.5e8 + pictures, note: null, attention: false, action: null });
  assert.deepEqual(await spending.summary(homeId, member), { scope: "own", month, monthNano: 2.5e8 + pictures, note: null, attention: false, action: null });
  assert.deepEqual((await spending.priceTags(homeId, member)).bots, [{ botId, monthNano: 2.5e8 + pictures, allNano: 2.5e8 + pictures }]);

  const whole = await reports.report(homeId, owner);
  assert.equal(whole.totalNano, 7.5e8 + pictures);
  assert.deepEqual(whole.byKind.map((row) => [row.kind, row.spentNano, row.images]).sort(), [["economy", 2.5e8, 0], ["images", pictures, 2], ["premium", 5e8, 0]]);
  assert.deepEqual(whole.byBot, [{ botId, name: "Scout", spentNano: 7.5e8 + pictures, calls: 3 }]);
  assert.deepEqual(whole.byPerson.map((row) => [row.name, row.spentNano]), [["Olive", 5e8], ["Max", 2.5e8 + pictures]]);
  assert.deepEqual(whole.byDay.filter((day) => day.spentNano).map((day) => day.day), [new Date().toISOString().slice(0, 10)], "days are UTC's");
  const own = await reports.report(homeId, member);
  assert.deepEqual([own.scope, own.totalNano, own.byPerson], ["own", 2.5e8 + pictures, []], "only the member's own use, and no one else's");

  const { stream } = reports.exportCsv(homeId, owner);
  const lines = (await text(stream)).trim().split("\r\n");
  assert.equal(lines[0], "Day,Bot,Person,Kind,Uses,Pictures,Seconds,Spent (USD)");
  assert.ok(lines.includes(`${new Date().toISOString().slice(0, 10)},Scout,Olive,Premium AI,1,0,0,0.5`), lines.join("\n"));
  assert.equal(lines.length, 4);
  assert.equal(await knex("usage_events").where({ workspace_id: homeId }).count({ n: "*" }).first().then((row) => Number(row.n)), 3);
});

test("a report adds up any range of days by day, kind, bot and person from the totals, and its CSV streams the same, safe to open", async (context) => {
  const { knex, resources, systemContext, profiles, recorder: make, homeId, ownerId, memberId, botId, formulaBot } = await setup(context);
  const recorder = make();
  const home = { id: homeId };
  const owner = { userId: ownerId, manages: true };
  const member = { userId: memberId, manages: false };
  const reports = createReports({ resources, systemContext, profiles });
  await recorder.finish(await recorder.open({ userId: ownerId, botId, provider: "together" }), { state: "done", reportedCost: 0.5 });
  await recorder.finish(await recorder.open({ userId: memberId, botId: formulaBot, provider: "deepinfra" }), { state: "done", reportedCost: 0.25 });

  const whole = await reports.report(home.id, owner);
  assert.equal(whole.scope, "home");
  assert.equal(whole.totalNano, 0.75 * NANO);
  assert.deepEqual(whole.byBot.map((row) => [row.name, row.spentNano]), [["Scout", 0.5 * NANO], ["=HYPERLINK(\"x\")", 0.25 * NANO]]);
  assert.deepEqual(whole.byPerson.map((row) => [row.name, row.spentNano]), [["Olive", 0.5 * NANO], ["Max", 0.25 * NANO]]);
  assert.equal(whole.byDay.length, Number(whole.to.slice(8)), "every day of the month so far");
  assert.equal(whole.byDay.at(-1).spentNano, 0.75 * NANO);
  const own = await reports.report(home.id, member);
  assert.deepEqual([own.scope, own.totalNano, own.byPerson], ["own", 0.25 * NANO, []], "a member, their own use");

  const today = whole.to;
  assert.equal(today, new Date().toISOString().slice(0, 10), "days are UTC's");
  const day = await reports.report(home.id, { ...owner, from: today, to: today });
  assert.deepEqual(day.byDay, [{ day: today, spentNano: 0.75 * NANO }]);
  // The daily totals are kept for this month and the twelve before it: any range of up to a year starting then.
  const now = new Date();
  const kept = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 12, 1));
  const longest = await reports.report(home.id, { ...owner, from: kept.toISOString().slice(0, 10), to: new Date(kept.getTime() + 365 * 86_400_000).toISOString().slice(0, 10) });
  assert.deepEqual([longest.daysKept, longest.byDay.length], [true, 366]);
  // An older month is read whole from the monthly totals, kept for good, without its days.
  const old = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 14, 1));
  const oldMonth = old.toISOString().slice(0, 7);
  const oldLast = new Date(Date.UTC(old.getUTCFullYear(), old.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  await knex("usage_monthly").insert({
    workspace_id: home.id, month: `${oldMonth}-01`, bot_id: botId, user_id: ownerId, kind: "premium", bot_name: "Scout", calls: 4, cost_nano: 3 * NANO
  });
  const archived = await reports.report(home.id, { ...owner, from: `${oldMonth}-01`, to: oldLast });
  assert.deepEqual([archived.daysKept, archived.byDay, archived.totalNano], [false, [], 3 * NANO]);
  assert.deepEqual(archived.byPerson.map((row) => [row.name, row.spentNano, row.calls]), [["Olive", 3 * NANO, 4]]);
  const tooOld = (error) => error.statusCode === 400 && error.code === "report_range_too_old";
  await assert.rejects(reports.report(home.id, { ...owner, from: `${oldMonth}-02`, to: oldLast }), tooOld, "part of a month older than the days kept");
  const invalid = (error) => error.statusCode === 400 && error.code === "report_range_invalid";
  await assert.rejects(reports.report(home.id, { ...owner, from: "2026-02-02", to: "2026-02-01" }), invalid);
  await assert.rejects(reports.report(home.id, { ...owner, from: "2024-01-01", to: "2025-01-01" }), invalid, "a year and a day at most");
  await assert.rejects(reports.report(home.id, { ...owner, from: "2026-02-30", to: "2026-03-01" }), invalid);

  const read = async (answer) => {
    let text = "";
    for await (const chunk of answer.stream) text += chunk;
    return text;
  };
  const csv = reports.exportCsv(home.id, { ...owner, from: today, to: today });
  assert.equal(csv.fileName, `mercbot-spending-${today}-to-${today}.csv`);
  assert.deepEqual((await read(csv)).split("\r\n"), [
    "Day,Bot,Person,Kind,Uses,Pictures,Seconds,Spent (USD)",
    `${today},Scout,Olive,Premium AI,1,0,0,0.5`,
    `${today},"'=HYPERLINK(""x"")",Max,Economy AI,1,0,0,0.25`,
    ""
  ]);
  assert.deepEqual((await read(reports.exportCsv(home.id, { ...member, from: today, to: today }))).split("\r\n").slice(1), [
    `${today},"'=HYPERLINK(""x"")",Max,Economy AI,1,0,0,0.25`,
    ""
  ], "a member's CSV is their own use");
  assert.deepEqual((await read(reports.exportCsv(home.id, { ...owner, from: `${oldMonth}-01`, to: oldLast }))).split("\r\n"), [
    "Month,Bot,Person,Kind,Uses,Pictures,Seconds,Spent (USD)",
    `${oldMonth},Scout,Olive,Premium AI,4,0,0,3`,
    ""
  ], "an older month, a line per bot, person and kind");
  // A CSV longer than a page reads every row once, in order.
  await knex("usage_daily").insert(Array.from({ length: 250 }, (_, index) => ({
    workspace_id: home.id, day: today, bot_id: 100_000 + index, user_id: ownerId, kind: "images", bot_name: `Bot ${index}`, calls: 1, images: 1, cost_nano: NANO
  })));
  const long = (await read(reports.exportCsv(home.id, { ...owner, from: today, to: today }))).split("\r\n").slice(3, -1);
  assert.deepEqual(long, Array.from({ length: 250 }, (_, index) => `${today},Bot ${index},Olive,Pictures,1,1,0,1`));
  assert.deepEqual([csvDollars(1), csvDollars("123456789012"), csvDollars(-5e8), csvDollars(0)], ["0.000000001", "123.456789012", "-0.5", "0"]);
  assert.deepEqual([csvCell("+1"), csvCell("@a"), csvCell("-2"), csvCell(-2), csvCell("a,b"), csvCell(null)], ["'+1", "'@a", "'-2", "-2", "\"a,b\"", ""]);
});

test("daily totals older than 13 months are archived by home range once, by servers sweeping together, then dropped", async (context) => {
  const { knex, resources, systemContext, homeId, botId, cleanup } = await setup(context);
  const folder = await mkdtemp(path.join(os.tmpdir(), "mercbot-archive-"));
  context.after(() => rm(folder, { recursive: true, force: true }));
  await writeFile(path.join(folder, ".mercbot-files"), "");
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 14, 1));
  const month = start.toISOString().slice(0, 7);
  const table = `usage_daily_${month.replace("-", "")}`;
  await knex.raw("select mercbot_usage_daily_partition(?::date)", [start.toISOString().slice(0, 10)]);
  const far = Number(homeId) + HOMES_PER_FILE;
  const rows = Array.from({ length: 25 }, (_, index) => ({
    workspace_id: index === 24 ? far : homeId, day: new Date(start.getTime() + index * 86400000).toISOString().slice(0, 10), bot_id: botId, user_id: 0,
    kind: "premium", bot_name: index === 3 ? "Quote \"and\", comma\nline" : "Scout", calls: 1, cost_nano: 1000 + index
  }));
  await knex("usage_daily").insert(rows);
  const env = { MERCBOT_FILES_DIR: folder };
  const retention = (server) => createRetention({ resources, systemContext, env, knex, archivedColumns: [], server });
  const [one, two] = await Promise.all([retention("one").sweep(), retention("two").sweep()]);
  assert.deepEqual([...one, ...two], [month], "one server archived it");
  assert.equal((await knex.raw("select to_regclass(?) as found", [table])).rows[0].found, null, "its partition was dropped whole");

  const place = path.join(folder, "usage-archive", "daily", month);
  const files = (await readdir(place)).sort();
  assert.equal(files.length, 2, "a file for each range of homes");
  const csv = gunzipSync(await readFile(path.join(place, files[0]))).toString();
  assert.equal(csv.split("\n")[0], "workspace_id,day,bot_id,user_id,kind,bot_name,calls,estimated_calls,cache_hit_tokens,cache_miss_tokens,output_tokens,images,seconds,cost_nano");
  assert.match(csv, new RegExp(`\n${homeId},${month}-01,${botId},0,premium,Scout,1,`, "u"), "days as written, UTC's");
  assert.match(csv, /"Quote ""and"", comma\nline"/u, "a name with commas, quotes and a line break is kept whole");
  const job = await knex("usage_jobs").where({ job: "archive", period: month }).first();
  assert.equal(job.state, "done");
  assert.deepEqual(job.details.files.map((file) => file.rows).sort(), [1, 24]);
  assert.equal(job.details.files.reduce((total, file) => total + file.sums.cost_nano, 0), rows.reduce((total, row) => total + row.cost_nano, 0));
  assert.deepEqual(await retention("three").sweep(), [], "a later sweep finds nothing to do");

  // Archives older than seven years are deleted; younger ones stay.
  await mkdir(path.join(folder, "usage-archive", "daily", "2001-02"), { recursive: true });
  await writeFile(path.join(folder, "usage-archive", "daily", "2001-02", "homes-000000000000-000000099999.csv.gz"), "");
  await retention("three").sweep();
  await assert.rejects(readdir(path.join(folder, "usage-archive", "daily", "2001-02")), { code: "ENOENT" });
  assert.equal((await readdir(place)).length, 2);

  // An unmounted files volume is never written to, and nothing is dropped.
  await rm(path.join(folder, ".mercbot-files"));
  const older = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 15, 1)).toISOString().slice(0, 10);
  await knex.raw("select mercbot_usage_daily_partition(?::date)", [older]);
  cleanup(() => knex.raw("drop table if exists ??", [`usage_daily_${older.slice(0, 7).replace("-", "")}`]));
  await knex("usage_daily").insert({ ...rows[0], day: older });
  assert.deepEqual(await retention("four").sweep(), []);
  assert.equal(await knex("usage_daily").where({ workspace_id: homeId, day: older }).first().then(Boolean), true);
});
