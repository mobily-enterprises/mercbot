import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { claimedWork, memberOptions } from "../support/botRecords.mjs";
import { seedChat } from "../support/chatFixtures.mjs";
import { botsOf, homeOfPeople, startChatTurns } from "../support/botDoubles.mjs";
import { queriesDuring, statementsDuring } from "../support/queryCount.mjs";
import { createMeteredFetch } from "../../packages/account/src/server/meter.js";
import { createChatRoutines } from "../../packages/bots/src/server/chatRoutines.js";
import { createRecurringTasks, jobName, jobSchedule, watchSchedule } from "../../packages/bots/src/server/recurringTasks.js";

// A home's recurring tasks (D-132): every routine and watch in the chats the person can open and every app's job, with
// what each cost in the last 30 days as far as they may see (owners and admins every task's, a member only those that
// run as them), a count of the tasks in chats they can't open for owners and admins, and each run counted once.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

/**
 * Olive (the owner) and Max (a member), with the bot Scout in three chats: a room they're both in, Olive's private room
 * and Max's private room, each with a routine of its own person. Apps' watches and jobs are `apps`'s.
 */
async function setup(context, { watches = [], scripts = [], reply = async () => ({ text: "Done.", transcript: [] }) } = {}) {
  const kit = await startChatTurns(context, { reply });
  const { knex } = kit;
  const { homeId, people: [olive, max] } = await homeOfPeople(kit, ["Olive", "Max"]);
  kit.cleanup.after(() => knex("usage_tasks_daily").where({ workspace_id: homeId }).del());
  const [scout] = await botsOf(kit, homeId, olive, ["Scout"]);
  const shared = await seedChat(knex, { homeId, kind: "private", title: "Team", people: [olive, max], bots: [scout] });
  const oliveOnly = await seedChat(knex, { homeId, kind: "private", title: "Olive's room", people: [olive], bots: [scout] });
  const maxOnly = await seedChat(knex, { homeId, kind: "private", title: "Max's room", people: [max], bots: [scout] });
  const routine = async (chat, madeBy, name, fields = {}) => {
    const [row] = await knex("bot_routines").insert({
      workspace_id: homeId,
      chat_bot_id: chat.chatBotIds.get(scout),
      made_by: madeBy,
      name,
      schedule: "Every day at 7:00 (UTC)",
      instructions: name,
      cron: "0 7 * * *",
      timezone: "UTC",
      next_run_at: knex.raw("now() + interval '3 hours'"),
      ...fields
    }).returning("*");
    return String(row.id);
  };
  // Apps answer as theirs do: the scripts of the kind asked for, when one is.
  const asked = [];
  const apps = {
    watches: { list: async () => watches, idsOfHome: async () => watches.map((watch) => watch.id) },
    scripts: { overview: async (where) => (asked.push(where?.kind ?? null), scripts.filter((script) => !where?.kind || script.kind === where.kind)) }
  };
  const routines = createChatRoutines({ records: kit.records });
  const tasks = createRecurringTasks({ records: kit.records, routines, apps, meter: kit.meter, systemContext: kit.systemContext });
  const as = (userId, manages) => ({
    list: (options = memberOptions({ userId, homeId, role: manages ? "owner" : "member" })) =>
      tasks.list({ homeId, reader: { userId, manages } }, options)
  });
  return { kit, knex, homeId, olive, max, scout, shared, oliveOnly, maxOnly, routine, asked, owner: as(olive, true), member: as(max, false) };
}

/** A day's figures of a task, as its runs and calls add them. */
const spent = (knex, homeId, kind, id, userId, costNano, day = today(), runs = 1) =>
  knex("usage_tasks_daily").insert({ workspace_id: homeId, day, task_kind: kind, task_id: id, user_id: userId, runs, calls: 2, cost_nano: costNano });

test("each person sees the routines of the chats they can open, and the costs they may see", async (context) => {
  const { knex, homeId, olive, max, shared, oliveOnly, maxOnly, routine, owner, member } = await setup(context);
  const weather = await routine(shared, olive, "Weather");
  const digest = await routine(shared, max, "Digest");
  await routine(oliveOnly, olive, "Diary");
  const secret = await routine(maxOnly, max, "Max's own");
  await routine(shared, max, "Broken", { enabled: false, failures: 5, next_run_at: null });
  await spent(knex, homeId, "routine", weather, olive, 30e6);
  await spent(knex, homeId, "routine", weather, olive, 20e6, daysAgo(10), 2);
  await spent(knex, homeId, "routine", digest, max, 5e6);
  await spent(knex, homeId, "routine", secret, max, 7e6);
  // Older than 30 days: not counted.
  await spent(knex, homeId, "routine", digest, max, 900e6, daysAgo(40));
  // A routine since deleted.
  await spent(knex, homeId, "routine", "999999999", olive, 3e6);

  const mine = await owner.list();
  const byName = new Map(mine.tasks.map((task) => [task.name, task]));
  assert.deepEqual([...byName.keys()].sort(), ["Broken", "Diary", "Digest", "Weather"], "the owner sees the chats they can open");
  assert.deepEqual(byName.get("Weather").cost, { nano: 50e6, runs: 3 });
  assert.deepEqual(byName.get("Digest").cost, { nano: 5e6, runs: 1 }, "and every task's cost, the last 30 days only");
  assert.deepEqual(mine.others, { count: 1, costNano: 7e6 }, "Max's private room: counted, unnamed");
  assert.equal(mine.notListedNano, 3e6, "a deleted routine's cost");
  assert.equal(mine.costScope, "home");
  const weatherRow = byName.get("Weather");
  assert.deepEqual(
    [weatherRow.kind, weatherRow.state, weatherRow.where.chatTitle, weatherRow.bot.name, weatherRow.schedule, weatherRow.madeByYou],
    ["routine", "running", "Team", "Scout", "Every day at 7:00 (UTC)", true]
  );
  assert.ok(weatherRow.nextRunAt);
  assert.deepEqual(weatherRow.can, { pause: true, resume: false, edit: true, delete: true });
  // A routine in an archived chat can't be edited or resumed, as in its chat's details.
  await knex("conversations").where({ id: oliveOnly.id }).update({ archived_at: new Date() });
  const archived = (await owner.list()).tasks.find((task) => task.name === "Diary");
  assert.deepEqual(archived.can, { pause: true, resume: false, edit: false, delete: true });
  const brokenRow = byName.get("Broken");
  assert.deepEqual([brokenRow.state, brokenRow.why, brokenRow.nextRunAt], ["failing", "Paused after 5 failed runs in a row", null]);
  assert.deepEqual(brokenRow.can, { pause: false, resume: false, edit: false, delete: true }, "only its maker resumes it");

  const his = await member.list();
  const hisByName = new Map(his.tasks.map((task) => [task.name, task]));
  assert.deepEqual([...hisByName.keys()].sort(), ["Broken", "Digest", "Max's own", "Weather"], "a member sees only the chats they can open");
  assert.equal(hisByName.get("Weather").cost, null, "and not the cost of a task that runs as someone else");
  assert.deepEqual(hisByName.get("Digest").cost, { nano: 5e6, runs: 1 });
  assert.deepEqual(hisByName.get("Broken").can, { pause: false, resume: true, edit: true, delete: true });
  assert.equal(his.others, null, "a member isn't told about chats they can't open");
  assert.deepEqual(hisByName.get("Broken").cost, { nano: 0, runs: 0 }, "their own task that cost nothing yet");
  assert.deepEqual(byName.get("Diary").cost, { nano: 0, runs: 0 }, "and every task, for the owner");
  assert.equal(his.costScope, "own");
  assert.equal(his.notListedNano, 0);
});

test("watches and apps' jobs are listed with their schedules in words; a job runs without AI and only managers switch it", async (context) => {
  const watchRow = (chat, fields) => ({
    id: "41", name: "New deals", table: "Deals", on: "create", condition: null, enabled: true, lastRunAt: "2026-11-20T08:00:00.000Z",
    pausedByLimit: false, chatId: chat.id, canResume: true, ...fields
  });
  const watches = [];
  const scripts = [
    {
      id: "s1", key: "nightly", kind: "job", summary: "Close stale deals", enabled: true, nextRunAt: "2026-11-25T02:00:00.000Z",
      settings: { every: "day", at: "02:00", timeZone: "Europe/Rome" }, app: { slug: "crm", name: "CRM" }, lastRun: { at: "2026-11-24T02:00:00.000Z", ok: false }
    },
    { id: "s2", key: "button", kind: "action", summary: "A button", enabled: true, settings: {}, app: { slug: "crm", name: "CRM" }, lastRun: null }
  ];
  const kit = await setup(context, { watches, scripts });
  watches.push(
    watchRow(kit.shared, { botId: kit.scout }),
    watchRow(kit.shared, { id: "42", name: "Runaway", enabled: false, pausedByLimit: true, botId: kit.scout, canResume: false })
  );
  await spent(kit.knex, kit.homeId, "watch", "41", kit.olive, 2e6);

  const { tasks } = await kit.owner.list();
  const watch = tasks.find((task) => task.id === "41");
  assert.deepEqual(
    [watch.kind, watch.schedule, watch.state, watch.where.chatTitle, watch.cost, watch.can],
    ["watch", "When Deals records are added", "running", "Team", { nano: 2e6, runs: 1 }, { pause: true, resume: false, edit: false, delete: true }]
  );
  const runaway = tasks.find((task) => task.id === "42");
  assert.deepEqual([runaway.state, runaway.why, runaway.can.resume], ["failing", "Paused after running more than 30 times in an hour", false]);
  const job = tasks.find((task) => task.kind === "job");
  assert.deepEqual(
    [job.name, job.detail, job.schedule, job.where, job.state, job.why, job.cost, job.can],
    ["Nightly", "Close stale deals", "Every day at 02:00 (Europe/Rome)", { appSlug: "crm", appName: "CRM" }, "failing", "Its last run failed", null,
      { pause: true, resume: false, edit: false, delete: false }]
  );
  assert.equal(tasks.filter((task) => task.kind === "job").length, 1, "only jobs: a button isn't a recurring task");
  assert.deepEqual(kit.asked, ["job"], "and apps are asked for their jobs alone, not every script");
  const { tasks: his } = await kit.member.list();
  assert.equal(his.find((task) => task.kind === "job").can.pause, false, "a member can't switch an app's job");
});

test("schedules in words", () => {
  assert.equal(jobSchedule({ every: "hour", at: "00:15" }), "Every hour at :15");
  assert.equal(jobName("sync_latest_weight"), "Sync latest weight");
  assert.equal(jobSchedule({ every: "week", day: 1, at: "09:00" }), "Every Monday at 09:00 (UTC)");
  assert.equal(jobSchedule({ watch: { tableLabel: "Contacts", on: "update" } }), "When Contacts records change");
  assert.equal(watchSchedule({ table: "Deals", on: "any", condition: "stage = 'Won'" }), "When Deals records are added or change, if they match");
});

test("a routine's run is counted once, by the server that started it, with the AI it used", async (context) => {
  // Its reply makes one AI call, as a bot's does: a run counts once its first call goes out (D-132). The call goes to a
  // stand-in here, never to a provider.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ usage: { prompt_tokens: 10, completion_tokens: 2 } });
  context.after(() => {
    globalThis.fetch = realFetch;
  });
  const reply = async () => {
    await createMeteredFetch({}, "deepinfra")("https://stand-in.invalid/v1/chat/completions", { method: "POST", body: "{}" });
    return { text: "Done.", transcript: [] };
  };
  const { kit, knex, homeId, olive, shared, routine } = await setup(context, { reply });
  kit.cleanup.after(() => Promise.all(["usage_events", "usage_daily", "usage_monthly"].map((table) => knex(table).where({ workspace_id: homeId }).del())));
  const id = await routine(shared, olive, "Weather");
  const run = async (attempts) => {
    const [row] = await knex("bot_routines").where({ id }).update({ run_id: randomUUID(), run_attempts: attempts, run_lease_until: knex.raw("now() + interval '90 seconds'") }).returning("*");
    await kit.turns.runRoutine(claimedWork(row));
  };
  const runs = async () => Number((await knex("usage_tasks_daily").where({ workspace_id: homeId, task_kind: "routine", task_id: id }).first())?.runs || 0);
  await run(1);
  // Counted without holding the run up: waited for here.
  for (let wait = 0; wait < 50 && (await runs()) < 1; wait += 1) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(await runs(), 1);
  await run(2);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(await runs(), 1, "a run carried on after its server stopped isn't counted again");
  const row = await knex("usage_tasks_daily").where({ workspace_id: homeId, task_kind: "routine", task_id: id }).first();
  assert.equal(String(row.user_id), olive, "for the person it runs as");
  assert.equal(Number(row.calls), 2, "with the AI call each run made");
  assert.ok((await knex("bot_routines").where({ id }).first("last_run_at")).last_run_at, "and it's the routine's last run");
});

test("the list costs the same queries for 5 routines or 200, but a page of costs per 100, and never reads a routine's saved run", async (context) => {
  const { knex, homeId, olive, shared, routine, owner } = await setup(context);
  const count = () => queriesDuring(knex, () => owner.list());
  for (let index = 0; index < 5; index += 1) await spent(knex, homeId, "routine", await routine(shared, olive, `Few ${index}`), olive, 1e6);
  const few = await count();
  assert.ok(few > 0, "it counts the list's queries");
  // 195 more in one insert each, as a realistic home's.
  const steps = Array.from({ length: 50 }, (_, step) => ({ role: "assistant", content: `Step ${step} `.repeat(40) }));
  const rows = await knex("bot_routines").insert(Array.from({ length: 195 }, (_, index) => ({
    workspace_id: homeId, chat_bot_id: shared.chatBotIds.values().next().value, made_by: olive, name: `Many ${index}`,
    schedule: "Every day at 7:00 (UTC)", instructions: "Many", cron: "0 7 * * *", timezone: "UTC", run_steps: JSON.stringify(steps)
  }))).returning("id");
  await knex("usage_tasks_daily").insert(rows.map((row) => ({
    workspace_id: homeId, day: today(), task_kind: "routine", task_id: String(row.id), user_id: olive, runs: 1, calls: 1, cost_nano: 1e6
  })));
  // The costs are read a page of 100 tasks' totals at a time (spending's everyGroup): one more for the second hundred.
  assert.equal(await count(), few + 1, "the same queries, and one more page of costs");
  const { tasks } = await owner.list();
  assert.equal(tasks.length, 200);
  const reads = await statementsDuring(knex, () => owner.list(), /from "bot_routines"/u);
  assert.ok(reads.length, "it reads the routines");
  for (const { sql } of reads) assert.doesNotMatch(sql, /run_steps|"\*"|bot_routines"\.\*/u, "only the columns the list shows");
});
