import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FILES_OWNS } from "../../packages/files/src/server/FilesFeature.js";
import { startGateway } from "../../packages/files/src/server/gateway.js";
import { createInternetUsage, internetLimits } from "../../packages/files/src/server/internetUsage.js";
import { ownedHandles } from "../support/ownedHandles.mjs";
import { queriesDuring } from "../support/queryCount.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";

// Bots' commands' internet limits that outlast a command (D-127), on the database every server shares (D-15): a bot's
// new connections a minute and its home's internet a day, counted by each command's gateway and written a batch at a
// time. Every gateway here is a real one on this machine, as a command's is; the "public" hosts are stand-ins on this
// machine (the gateway's `standIns`), so nothing reaches the internet. Two gateways on one database are two commands,
// on one server or two.

const MB = 1024 ** 2;
const KB = 1024;

/** Two homes of their own, the first with two bots and the second with one, so each test's figures are its own. */
async function setup(context) {
  const knex = await connectTestDatabase();
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const userId = String((await knex("users").first()).id);
  const homes = await knex("workspaces").insert([
    { slug: `net-a-${stamp}`, name: `Net A ${stamp}`, owner_user_id: userId, is_personal: false },
    { slug: `net-b-${stamp}`, name: `Net B ${stamp}`, owner_user_id: userId, is_personal: false }
  ]).returning("id");
  const [home, other] = homes.map((row) => String(row.id));
  const bots = await knex("bots").insert([
    { made_by: userId, workspace_id: home, name: "Fetcher", color: "#1E86FC" },
    { made_by: userId, workspace_id: home, name: "Getter", color: "#1E86FC" },
    { made_by: userId, workspace_id: other, name: "Elsewhere", color: "#1E86FC" }
  ]).returning("id");
  const [bot, second, away] = bots.map((row) => String(row.id));
  const { features } = await ownedHandles(knex, context, { "mercbot.files": FILES_OWNS });
  const { resources, systemContext } = features["mercbot.files"];
  context.after(async () => {
    await knex("workspaces").whereIn("id", [home, other]).del();
    await knex.destroy();
  });
  /** The home's internet records, with these limits, clock and writes: what a server's files feature makes. */
  const usage = ({ limits = {}, now, writes } = {}) => createInternetUsage({
    internetDays: resources.internetDays,
    internetMinutes: resources.internetMinutes,
    systemContext,
    limits: { ...internetLimits({}), ...limits },
    ...(now ? { now } : {}),
    ...(writes ? { writes } : {})
  });
  const dayRow = async (homeId) => knex("internet_days").where({ workspace_id: homeId, day: new Date().toISOString().slice(0, 10) }).first();
  const inHome = (homeId) => ({ context: systemContext("the internet limits tests' own reads").forWorkspace(homeId) });
  return { knex, home, other, bot, second, away, usage, dayRow, inHome };
}

/**
 * A stand-in that sends `bytes` to whoever connects, in 16 KB pieces, then ends: as fast as it can, or with `pauseMs`
 * after each piece, as a far website sends.
 */
async function sender(context, bytes, { pauseMs = 0 } = {}) {
  const server = net.createServer((socket) => {
    socket.on("error", () => {});
    let left = bytes;
    const piece = Buffer.alloc(16 * KB, 7);
    const more = () => {
      while (left > 0 && !socket.destroyed) {
        left -= piece.length;
        const wrote = socket.write(left >= 0 ? piece : piece.subarray(0, piece.length + left));
        if (pauseMs) return setTimeout(more, pauseMs);
        if (!wrote) return socket.once("drain", more);
      }
      socket.end();
    };
    more();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  return server.address().port;
}

/** A command's gateway with its meter, on a socket of the test's own, reaching the stand-in as files.example.test. */
async function commandGateway(context, port, meter) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mb-net-"));
  const socketPath = path.join(dir, "gateway.sock");
  const gateway = await startGateway({
    socketPath,
    standIns: new Map([["files.example.test:443", { address: "127.0.0.1", port }]]),
    limits: { commandIn: 64 * MB, commandOut: 64 * MB },
    meter
  });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await gateway.close();
    await rm(dir, { recursive: true, force: true });
  };
  context.after(close);
  return { gateway, socketPath, close };
}

/** CONNECTs through the gateway and reads to the end: { status, bytes, text }. */
const fetchThrough = (socketPath) => new Promise((resolve) => {
  const socket = net.connect(socketPath);
  let answer = Buffer.alloc(0);
  socket.on("data", (chunk) => (answer = Buffer.concat([answer, chunk])));
  socket.on("error", () => {});
  socket.on("close", () => {
    const end = answer.indexOf("\r\n\r\n");
    const head = answer.subarray(0, Math.max(0, end)).toString("latin1");
    resolve({ status: Number(/^HTTP\/1\.1 (\d+)/u.exec(head)?.[1] || 0), bytes: end < 0 ? 0 : answer.length - end - 4, text: answer.toString("latin1") });
  });
  socket.write("CONNECT files.example.test:443 HTTP/1.1\r\n\r\n");
});

/** A clock stopped at 10 s into a minute, so a test's connections all fall in that minute; `tick` moves it on. */
function stoppedClock() {
  let at = Math.floor(Date.now() / 60000) * 60000 + 10000;
  return { now: () => new Date(at), tick: (ms) => (at += ms) };
}

test("a bot's connections past its minute's are refused with \"slow down\", on every gateway of the bot, until the next minute", async (context) => {
  const { bot, second, home, usage } = await setup(context);
  const port = await sender(context, 10);
  const clock = stoppedClock();
  const records = usage({ limits: { perMinute: 5 }, now: clock.now });
  // Two commands of the bot at once, which may be on two servers, and one of another bot of the home.
  const first = await commandGateway(context, port, records.forGateway({ workspaceId: home, botId: bot }));
  const again = await commandGateway(context, port, usage({ limits: { perMinute: 5 }, now: clock.now }).forGateway({ workspaceId: home, botId: bot }));
  const other = await commandGateway(context, port, records.forGateway({ workspaceId: home, botId: second }));
  const statuses = [];
  for (const gateway of [first, first, first, again, again]) statuses.push((await fetchThrough(gateway.socketPath)).status);
  assert.deepEqual(statuses, [200, 200, 200, 200, 200]);
  const refused = await fetchThrough(again.socketPath);
  assert.equal(refused.status, 429);
  assert.match(refused.text, /\r\n\r\nMercbot's gateway refused a connection: slow down\. This bot opened 5 new internet connections this minute, the most a bot may; try again in 50 s\.$/u);
  assert.equal((await fetchThrough(first.socketPath)).status, 429, "the bot's other command too");
  assert.equal((await fetchThrough(other.socketPath)).status, 200, "another bot of the home has its own minute");
  assert.deepEqual(first.gateway.notes(), [
    "Mercbot's gateway refused a connection: slow down. This bot opened 5 new internet connections this minute, the most a bot may; try again in 50 s."
  ]);
  // The next minute, the bot connects again.
  clock.tick(60000);
  assert.equal((await fetchThrough(first.socketPath)).status, 200);
});

test("connections a command took but didn't use go back to its bot's minute when it ends", async (context) => {
  const { bot, home, usage, knex } = await setup(context);
  const port = await sender(context, 10);
  const clock = stoppedClock();
  const records = usage({ limits: { perMinute: 20 }, now: clock.now });
  // Seven connections take 1, 2 and 4 of the bot's minute; then 8 more are taken for the eighth, and 7 go back.
  const busy = await commandGateway(context, port, records.forGateway({ workspaceId: home, botId: bot }));
  for (let count = 0; count < 8; count += 1) assert.equal((await fetchThrough(busy.socketPath)).status, 200);
  assert.equal(Number((await knex("internet_minutes").where({ bot_id: bot }).first()).connections), 15);
  await busy.close();
  assert.equal(Number((await knex("internet_minutes").where({ bot_id: bot }).first()).connections), 8, "only what it used counts");
  // So twelve more this minute, not five.
  const next = await commandGateway(context, port, records.forGateway({ workspaceId: home, botId: bot }));
  const statuses = [];
  for (let count = 0; count < 13; count += 1) statuses.push((await fetchThrough(next.socketPath)).status);
  assert.deepEqual(statuses, [...Array(12).fill(200), 429]);
});

test("two commands of a home share its day: past it, their connections end and new ones are refused until midnight UTC", async (context) => {
  const { home, other, bot, second, away, usage, dayRow } = await setup(context);
  const port = await sender(context, 700 * KB);
  // A day of 1 MB, each gateway writing once 64 KB wait, as two servers would.
  const limits = { homeDay: MB };
  const writes = { flushBytes: 64 * KB };
  const one = await commandGateway(context, port, usage({ limits, writes }).forGateway({ workspaceId: home, botId: bot }));
  const two = await commandGateway(context, port, usage({ limits, writes }).forGateway({ workspaceId: home, botId: second }));
  const elsewhere = await commandGateway(context, port, usage({ limits, writes }).forGateway({ workspaceId: other, botId: away }));
  const read = await fetchThrough(one.socketPath);
  assert.equal(read.bytes, 700 * KB, "the first command's whole download, within the day");
  await one.close();
  assert.equal(Number((await dayRow(home)).bytes_in), 700 * KB, "written as the command ended");
  // The second command sees the first's 700 KB: its download ends once the home passes 1 MB.
  const cut = await fetchThrough(two.socketPath);
  assert.equal(cut.status, 200);
  assert.ok(cut.bytes < 700 * KB, `cut short (${cut.bytes} bytes)`);
  assert.ok(cut.bytes >= 300 * KB - 64 * KB, `but not before the home's day was used (${cut.bytes} bytes)`);
  const refused = await fetchThrough(two.socketPath);
  assert.equal(refused.status, 403);
  assert.match(refused.text, /Mercbot's gateway ended this command's internet connections: this home's commands have used 1 MB of internet today, the most a home's commands may use in a day\. It starts again at midnight UTC, in /u);
  assert.match(two.gateway.notes()[0], /^Mercbot's gateway ended this command's internet connections: this home's commands have used 1 MB of internet today[^]* It starts again at midnight UTC, in (\d+ h( \d+ min)?|\d+ min|less than a minute)\.$/u);
  await two.close();
  const day = await dayRow(home);
  const used = Number(day.bytes_in) + Number(day.bytes_out);
  assert.ok(used > MB && used <= MB + 2 * 64 * KB, `the home went past its day by no more than its writes wait for (${used} bytes)`);
  // A new command of the home is refused before it connects; the other home's day is its own.
  const later = await commandGateway(context, port, usage({ limits, writes }).forGateway({ workspaceId: home, botId: bot }));
  const after = await fetchThrough(later.socketPath);
  assert.equal(after.status, 403);
  assert.match(after.text, /Mercbot's gateway refused a connection: this home's commands have used 1 MB of internet today/u);
  assert.equal((await fetchThrough(elsewhere.socketPath)).bytes, 700 * KB);
});

test("two commands at once each see what the other used, as they write", async (context) => {
  const { knex, home, bot, second, usage, dayRow } = await setup(context);
  // How long the day's writes take on this machine, as D-127's bound depends on it: a busy one writes slower, so more
  // arrives while a write is under way.
  const started = new Map();
  let slowestWriteMs = 0;
  const DAY_WRITE = /^(?!\s*select\b)[^]*\binternet_days\b/iu;
  const onQuery = (query) => {
    if (DAY_WRITE.test(String(query.sql))) started.set(query.__knexQueryUid, performance.now());
  };
  const onDone = (_response, query) => {
    const at = started.get(query.__knexQueryUid);
    if (at !== undefined) slowestWriteMs = Math.max(slowestWriteMs, performance.now() - at);
  };
  const onError = (_error, query) => onDone(null, query);
  knex.on("query", onQuery).on("query-response", onDone).on("query-error", onError);
  context.after(() => knex.removeListener("query", onQuery).removeListener("query-response", onDone).removeListener("query-error", onError));
  // 16 KB every 2 ms, about 8 MB a second each: a gateway sees the other's use as of its own last write, so what a
  // home passes its day by is what its gateways haven't written yet, which grows with how fast data arrives while a
  // write is under way.
  const port = await sender(context, 2 * MB, { pauseMs: 2 });
  const limits = { homeDay: 3 * MB };
  const writes = { flushBytes: 64 * KB };
  const one = await commandGateway(context, port, usage({ limits, writes }).forGateway({ workspaceId: home, botId: bot }));
  const two = await commandGateway(context, port, usage({ limits, writes }).forGateway({ workspaceId: home, botId: second }));
  // Neither alone passes 3 MB; together they do, so one or both are cut short.
  const [a, b] = await Promise.all([fetchThrough(one.socketPath), fetchThrough(two.socketPath)]);
  assert.ok(a.bytes + b.bytes < 4 * MB, `the home's day ended them (${a.bytes} + ${b.bytes} bytes)`);
  await Promise.all([one.close(), two.close()]);
  const day = await dayRow(home);
  const used = Number(day.bytes_in) + Number(day.bytes_out);
  // Each gateway may be a write behind (64 KB waiting, 64 KB being written) and a piece past it when it sees, plus what
  // arrives while its write is under way (D-127): 16 KB every 2 ms for each of the two, during the slowest write.
  const duringWrites = 2 * 8 * KB * Math.ceil(slowestWriteMs);
  assert.ok(
    used > 3 * MB && used <= 3 * MB + 6 * 64 * KB + duringWrites,
    `past the day by at most what each gateway waits to write (${used} bytes; slowest write ${Math.round(slowestWriteMs)} ms)`
  );
});

test("a gateway writes its home's day once however many connections it opens: one statement, not one a connection", async (context) => {
  const { knex, home, other, bot, away, usage, dayRow } = await setup(context);
  const port = await sender(context, 1 * KB);
  // Its writes while bytes move (every 10 s, or each 64 MB) are left out: these commands end well before either, so
  // what they write is what they write as they end.
  const clock = stoppedClock();
  const records = usage({ limits: { perMinute: 1000 }, now: clock.now, writes: { flushMs: 10 * 60 * 1000 } });
  // Every statement on the table but a plain read (a SELECT ... FOR UPDATE before an UPDATE is one).
  const DAY_WRITES = /^(?!\s*select\b)[^]*\binternet_days\b/iu;
  const MINUTE_WRITES = /^(?!\s*select\b)[^]*\binternet_minutes\b/iu;
  /** A command of `connections` downloads, ended: the statements that wrote its home's day and its bot's minute. */
  async function command(homeId, botId, connections) {
    const gateway = await commandGateway(context, port, records.forGateway({ workspaceId: homeId, botId }));
    let minuteWrites = 0;
    const dayWrites = await queriesDuring(knex, async () => {
      minuteWrites = await queriesDuring(knex, async () => {
        for (let count = 0; count < connections; count += 1) assert.equal((await fetchThrough(gateway.socketPath)).bytes, KB);
        await gateway.close();
      }, { matching: MINUTE_WRITES });
    }, { matching: DAY_WRITES });
    return { dayWrites, minuteWrites };
  }
  // A day's first command makes its row (the change finds none to change, then the INSERT).
  const firsts = [await command(other, away, 1), await command(home, bot, 1)];
  const one = await command(home, bot, 1);
  const forty = await command(home, bot, 40);
  assert.equal(one.dayWrites, 1, "a command of one connection: one write as it ends");
  assert.equal(forty.dayWrites, 1, "a command of forty: the same one write");
  for (const first of firsts) assert.ok(first.dayWrites >= 1 && first.dayWrites <= 2, `a day's first: ${first.dayWrites} writes`);
  const row = await dayRow(home);
  assert.equal(Number(row.bytes_in), 42 * KB);
  assert.equal(Number(row.connections), 42);
  // The bot's minute is taken a few at a time (1, 2, 4, 8, then 16), and what's left goes back once: never once a
  // connection.
  assert.equal(one.minuteWrites, 1);
  assert.ok(forty.minuteWrites <= 8, `forty connections took the bot's minute in ${forty.minuteWrites} writes`);
  console.log(`internet writes: a day's first command ${firsts.map((first) => first.dayWrites).join(" and ")} day write(s); ` +
    `one connection ${one.dayWrites} day write and ${one.minuteWrites} minute write; ` +
    `forty connections ${forty.dayWrites} day write and ${forty.minuteWrites} minute writes`);
});

test("Settings → Spending reads the home's day, and days older than two weeks go", async (context) => {
  const { knex, home, usage, inHome } = await setup(context);
  const records = usage({ limits: { homeDay: 5 * MB } });
  const today = new Date().toISOString().slice(0, 10);
  const old = new Date(Date.now() - 15 * 86400 * 1000).toISOString().slice(0, 10);
  const recent = new Date(Date.now() - 13 * 86400 * 1000).toISOString().slice(0, 10);
  await knex("internet_days").insert([
    { workspace_id: home, day: today, bytes_in: 3 * MB, bytes_out: MB, connections: 12 },
    { workspace_id: home, day: old, bytes_in: 1, bytes_out: 0, connections: 1 },
    { workspace_id: home, day: recent, bytes_in: 1, bytes_out: 0, connections: 1 }
  ]);
  const figures = await records.today(inHome(home), home);
  assert.deepEqual({ ...figures, startsAgainAt: undefined }, {
    day: today, received: 3 * MB, sent: MB, connections: 12, homeDay: 5 * MB, commandIn: 2048 * MB, commandOut: 200 * MB, perMinute: 120,
    startsAgainAt: undefined
  });
  assert.equal(figures.startsAgainAt, `${new Date(Date.parse(`${today}T00:00:00Z`) + 86400 * 1000).toISOString()}`);
  await records.removeOld();
  const kept = await knex("internet_days").where({ workspace_id: home }).orderBy("day").select(knex.raw("day::text AS day"));
  assert.deepEqual(kept.map((row) => row.day), [recent, today]);
});
