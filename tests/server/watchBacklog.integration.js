import assert from "node:assert/strict";
import test from "node:test";
import knexLib from "knex";
import { createMeter, createMeteredFetch } from "../../packages/account/src/server/meter.js";
import { createAppJobs } from "../../packages/apps/src/server/appJobs.js";
import { createWatches } from "../../packages/apps/src/server/watches.js";
import { createBackgroundRuns } from "../../packages/bots/src/server/backgroundRuns.js";
import { appsHome, appsParts } from "../support/appsHome.mjs";
import { startBotRecords } from "../support/botRecords.mjs";
import { seedChat } from "../support/chatFixtures.mjs";
import { cleanupStack } from "../support/cleanupStack.mjs";
import { earlierTransactionsEnded, testDatabaseConfig } from "../support/testDatabase.mjs";

// A runaway watch while the app job runner is behind (D-134): a public form's spam fires it every 5 seconds for 10
// minutes, while the runner, which every home shares, gets through one bot's run every 15 seconds (two at a time, 30
// seconds each). Its limit counts its runs in the hour and the tasks it still has waiting, so the backlog never runs
// more than 30 in the hour; once it's paused its waiting tasks end with their one line, without the bot, and another
// home's tasks queued meanwhile aren't left behind them. The watches, the jobs table and the runner's runs are the
// server's; only the bot's turn is a stand-in, its two AI calls metered as a real turn's are.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const TICKS = 120; // 10 minutes of 5-second ticks
const RUNNER_EVERY = 3; // one bot's run ends every 15 seconds

/** A home of the test's, with its table `key`, its bot in a chat and that bot's watch on the table. */
async function homeWithWatch(cleanup, knex, records, { slug, key, watch }) {
  const home = await appsHome(cleanup, { slug, knex, records });
  const parts = appsParts(home, { records });
  const watches = createWatches({ ...parts, records });
  const person = { type: "person", id: home.userId, name: "Pat" };
  await parts.registry.createTable(person, { key, fields: [{ key: "title", type: "text", required: true }] }, home.options);
  const [bot] = await knex("bots").insert({ made_by: home.userId, workspace_id: home.workspaceId, name: "Wendy", color: "#1E86FC" }).returning("id");
  const botId = String(bot.id);
  const chat = await seedChat(knex, { homeId: home.workspaceId, people: [home.userId], bots: [botId] });
  const chatBotId = chat.chatBotIds.get(botId);
  await earlierTransactionsEnded(knex);
  await watches.create({ chatBotId, createdBy: Number(home.userId) }, { name: watch, table: key, on: "create", instructions: "Reply." }, home.options);
  return { home, parts, watches, chatBotId, botId, chatId: String(chat.id), add: (title) => parts.gate.create(home.ctx(person), key, { title }) };
}

test("a watch fired every 5 seconds for 10 minutes runs at most 30 times in the hour, and another home's tasks still run", async (context) => {
  const knex = knexLib(await testDatabaseConfig());
  const cleanup = cleanupStack(context);
  cleanup.after(() => knex.destroy());
  const records = await startBotRecords(knex, cleanup);
  const spam = await homeWithWatch(cleanup, knex, records, { slug: "backlog-spam", key: "posts", watch: "New posts" });
  const shop = await homeWithWatch(cleanup, knex, records, { slug: "backlog-shop", key: "orders", watch: "New orders" });
  const homeOf = new Map([[spam.home.workspaceId, "spam"], [shop.home.workspaceId, "shop"]]);
  const system = spam.home.systemContext;

  // The runner's parts: the server's jobs and watches, a meter that counts each run once its first AI call goes out.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ usage: { prompt_tokens: 1, completion_tokens: 1 } }), { headers: { "content-type": "application/json" } });
  cleanup.after(() => (globalThis.fetch = realFetch));
  const counted = [];
  const meter = {
    ...createMeter({ recorder: { open: async () => ({ id: "1" }), finish: async () => true } }),
    countTaskRun: async (run) => (counted.push(run), true)
  };
  const aiCall = () => createMeteredFetch({}, "deepinfra")("https://provider", { method: "POST", body: "{}" });
  const ended = [];
  const seatOf = new Map([spam, shop].map((one) => [one.chatBotId, one]));
  const runs = createBackgroundRuns({
    records: { chats: { withTransaction: (options, work) => work(options) } },
    systemContext: () => system,
    meter,
    seats: {
      backgroundSeat: async ({ chatBotId, homeId, userId }) => {
        const one = seatOf.get(String(chatBotId));
        return { seat: { id: one.botId, chat_id: one.chatId, user_id: userId, workspace_id: String(homeId) }, call: {} };
      },
      working: async () => {},
      tell: async () => {},
      say: async () => []
    },
    jobs: null,
    watches: spam.watches,
    // The bot's turn: two AI calls, or, for a task that can't run now, only its line (botReplies' pausedTurn).
    respond: async (_seat, options) => {
      ended.push(options.stopped ?? null);
      if (options.stopped) return [];
      await aiCall();
      await aiCall();
      return [];
    }
  });
  const jobs = createAppJobs({ appJobs: spam.home.handles.appJobs });
  const tasks = new Map();

  /** The tasks queued since the last look, at `tick`. */
  async function queuedAt(tick) {
    const rows = await knex("app_jobs").whereIn("workspace_id", [...homeOf.keys()]).orderBy("id").select("id", "workspace_id");
    for (const row of rows) {
      if (!tasks.has(String(row.id))) tasks.set(String(row.id), { home: homeOf.get(String(row.workspace_id)), queued: tick, ran: null, worked: null, line: null });
    }
  }

  /** The runner's next bot run, at `tick`: tasks that end with their line take no time, so it goes on past them. */
  async function runnerTurn(tick) {
    for (;;) {
      const job = await jobs.withTransaction({ context: system }, (txOptions) => jobs.claimNext(txOptions, 60));
      if (!job) return;
      const before = ended.length;
      await runs.runAppTask(job);
      await jobs.finish(job, "done", { context: system.forWorkspace(String(job.workspaceId)) });
      const task = tasks.get(String(job.id));
      Object.assign(task, { ran: tick, line: ended.at(-1), worked: ended.length > before && ended.at(-1) === null });
      if (task.worked) return;
    }
  }

  let pausedAt = null;
  for (let tick = 1; tick <= TICKS; tick += 1) {
    await spam.add(`Spam ${tick}`);
    if (tick % 12 === 0) await shop.add(`Order ${tick}`);
    await earlierTransactionsEnded(knex);
    while (await spam.watches.evaluateOnce());
    await queuedAt(tick);
    if (pausedAt === null && !(await knex("app_watches").where({ chat_bot_id: spam.chatBotId }).first("enabled")).enabled) pausedAt = tick;
    if (tick % RUNNER_EVERY === 0) await runnerTurn(tick);
  }
  // The rest of the hour: nothing fires, and the runner gets through what's left, one turn a task at most.
  const last = TICKS + RUNNER_EVERY * tasks.size;
  for (let tick = TICKS + RUNNER_EVERY; tick <= last && [...tasks.values()].some((task) => task.ran === null); tick += RUNNER_EVERY) await runnerTurn(tick);
  assert.deepEqual([...tasks.values()].filter((task) => task.ran === null), [], "every task ended");

  const hot = [...tasks.values()].filter((task) => task.home === "spam");
  const orders = [...tasks.values()].filter((task) => task.home === "shop");
  const worked = hot.filter((task) => task.worked);
  assert.ok(pausedAt, "the runaway watch paused itself");
  assert.equal(hot.length, 31, "its firings until the one over its limit: 30 counted, runs and waiting tasks, and that one");
  assert.ok(worked.length <= 30, `at most 30 runs in the hour: ${worked.length}`);
  assert.deepEqual(counted.filter((run) => run.workspaceId === spam.home.workspaceId).length, worked.length, "each counted once, as it worked");
  const line = "The watch \"New posts\" fired more than 30 times in an hour, so Mercbot paused it. Changes made while it's paused aren't handled, even once it's resumed.";
  assert.deepEqual([...new Set(hot.filter((task) => !task.worked).map((task) => task.line))], [line], "the rest ended with its line, without the bot");
  assert.equal((await spam.watches.list({}, spam.home.options))[0].pausedByLimit, true);

  assert.equal(orders.length, TICKS / 12, "an order a minute in the other home");
  assert.ok(orders.every((task) => task.worked), "each order's task ran its bot");
  assert.ok(orders.every((task) => task.ran <= TICKS), "within the 10 minutes");
  const late = orders.filter((task) => task.queued > pausedAt && task.ran - task.queued > RUNNER_EVERY);
  assert.deepEqual(
    late.map((task) => [task.queued, task.ran]),
    [],
    `once the watch paused (tick ${pausedAt}), each order waits one runner turn at most; longest wait ${Math.max(...orders.map((task) => task.ran - task.queued))} ticks`
  );
});
