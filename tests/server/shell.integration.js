import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startShell } from "../support/ownedHandles.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { createFileStore } from "../../packages/files/src/server/fileStore.js";
import { shellAvailable } from "../../packages/files/src/server/gvisor.js";
import { __testables } from "../../packages/files/src/server/shell.js";
import { refuseWork } from "../../packages/account/src/server/meter.js";

const { LIMITS } = __testables;

// Bots' command line (D-47): gVisor, no network, only the conversation's folders, limits on time,
// memory, processes, file size and output; background runs, heartbeats and stopped servers.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

test("bots' commands run sealed off, within limits, and carry on in the background", { skip: shellAvailable(process.env) ? false : "the toolbox isn't installed (npm run tools:install)" }, async (context) => {
  const knex = await connectTestDatabase();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mercbot-shell-test-"));
  const userId = (await knex("users").first())?.id;
  const [home] = await knex("workspaces").insert({ slug: `shell-${Date.now()}`, name: "Shell test", owner_user_id: userId, is_personal: false }).returning("id");
  const workspaceId = home.id ?? home;
  const [bot] = await knex("bots").insert({ user_id: userId, workspace_id: workspaceId, name: "Shelly", color: "#1E86FC" }).returning("id");
  const botId = String(bot.id ?? bot);
  const [conversation] = await knex("bot_conversations").insert({ workspace_id: workspaceId, bot_id: botId, user_id: userId }).returning("id");
  const conversationId = String(conversation.id ?? conversation);
  context.after(async () => {
    await knex("workspaces").where({ id: workspaceId }).del();
    await knex.destroy();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const store = createFileStore({ root: "", fallback: dir, ownStorage: async () => null, settle: async () => {}, explain: async () => {} });
  // The whole sandbox's memory under one program's here, so that one program can go past it.
  const limits = { ...LIMITS, fileSize: 10 * 1024 * 1024, sandboxMemory: 1024 ** 3 };
  const { shell, inHome } = await startShell(knex, context, { store, limits });
  const place = { homeId: workspaceId, botId, userId };
  const ended = [];
  shell.onEnd((run) => ended.push(run));
  const go = (script, extra = {}) => shell.start({ place, workspaceId, botId, conversationId, userId, why: "test", script, ...extra });

  // The toolbox, the three folders, and what changed.
  let run = await go("echo hello > /files/mine/hello.txt && ls /files && ffmpeg -version | head -1 && python3 -c 'import pandas, pptx; print(\"py ok\")'");
  assert.equal(run.status, "done", run.output);
  assert.match(run.output, /^bot\nmine\nshared\n/u);
  assert.match(run.output, /ffmpeg version/u);
  assert.match(run.output, /py ok/u);
  assert.deepEqual(run.changed, ["/files/mine/hello.txt"]);
  assert.equal((await fs.readFile((await store.existingFile(place, "/files/mine/hello.txt")).real, "utf8")), "hello\n");

  // No network, no server files, no server environment.
  run = await go("python3 -c 'import socket; socket.create_connection((\"1.1.1.1\", 80), 3)' 2>&1 | tail -1; ls /var/lib /home 2>&1; ls " + JSON.stringify(dir) + " 2>&1; env | cut -d= -f1 | sort | tr '\\n' ' '");
  assert.match(run.output, /Network is unreachable/u);
  assert.doesNotMatch(run.output, /^vibe64$/mu);
  assert.match(run.output, /cannot access '[^']*mercbot-shell-test[^']*': No such file or directory/u);
  assert.equal(run.output.trim().split("\n").at(-1).trim(), "HOME LANG LC_ALL MPLBACKEND PATH PWD PYTHONDONTWRITEBYTECODE SHLVL TERM TMPDIR _");

  // Limits: time, memory, file size, processes, output.
  run = await go("while true; do :; done", { maxSeconds: 3 });
  assert.equal(run.status, "failed");
  assert.match(run.stopped, /ran out of time/u);
  run = await go("python3 -c 'x = bytearray(8 * 1024 ** 3)' 2>&1 | tail -1");
  assert.match(run.output, /MemoryError/u);
  run = await go("python3 -c 'x = bytearray(1536 * 1024 ** 2); import time; time.sleep(30)'", { maxSeconds: 60 });
  assert.equal(run.stopped, "It used too much memory.");
  run = await go("head -c 20M /dev/zero > /files/mine/big 2>&1; ls -l /files/mine/big | awk '{print $5}'");
  assert.match(run.output, /File too large|10485760/u);
  run = await go("bomb() { bomb | bomb & }; bomb; sleep 2; echo survived", { maxSeconds: 10 });
  assert.ok(["done", "failed"].includes(run.status));
  run = await go("seq 1 50000");
  assert.equal(run.truncated, true);
  assert.match(run.output, /output cut/u);

  // Files are never programs: nothing in the folders can be started, scripts run through bash.
  run = await go("cp /bin/echo /files/mine/e && chmod +x /files/mine/e && /files/mine/e hi 2>&1; printf 'echo via-bash' > /files/mine/s.sh && bash /files/mine/s.sh; rm -f /files/mine/e /files/mine/s.sh");
  assert.match(run.output, /\/files\/mine\/e: Permission denied/u);
  assert.match(run.output, /via-bash/u);

  // A link made inside can't make the app serve a server file.
  await go("ln -s /etc/passwd /files/mine/p");
  await assert.rejects(store.existingFile(place, "/files/mine/p"), /isn't there/u);

  // Asked by another bot: the person's and the home's folders are read-only.
  run = await go("touch /files/mine/x 2>&1; touch /files/shared/x 2>&1; touch /files/bot/ok && echo bot-ok", { readOnly: ["mine", "shared"] });
  assert.match(run.output, /\/files\/mine\/x.*Read-only file system/u);
  assert.match(run.output, /\/files\/shared\/x.*Read-only file system/u);
  assert.match(run.output, /bot-ok/u);

  // One command at a time per conversation: two fired together run one after the other.
  const [first, second] = await Promise.all([go("sleep 1; date +%s%N"), go("date +%s%N")]);
  assert.equal(first.status, "done");
  assert.equal(second.status, "done");
  assert.ok(BigInt(second.output.trim()) > BigInt(first.output.trim()), "the second waited for the first");

  // A long one carries on in the background, and then new ones are refused until it ends. It ends when the test
  // has checked it, by a file written from outside, not after a fixed time a loaded host can use up first.
  run = await go("until [ -e /files/bot/go ]; do sleep 0.1; done; rm /files/bot/go; echo late > /files/bot/late.txt", { foregroundSeconds: 1 });
  assert.equal(run.status, "running");
  assert.equal((await go("true")).status, "busy");
  assert.equal((await shell.check(run.run, inHome(workspaceId))).status, "running");
  await fs.writeFile(path.join((await store.prepare(place)).bot, "go"), "");
  for (let tries = 0; tries < 100 && !ended.length; tries += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(ended.length, 1);
  assert.equal(ended[0].status, "done");
  assert.deepEqual(ended[0].changed, ["/files/bot/late.txt"]);
  assert.equal((await shell.check(run.run, inHome(workspaceId))).status, "done");
  assert.deepEqual(await shell.check(run.run, inHome(Number(workspaceId) + 1000000)), { error: "There's no such command." });

  // A computer's session: the bot's commands run in it, share its /tmp, show in its log, and keep
  // their own time limit; the Terminal's command attaches to it; it ends with the computer.
  const session = await shell.attach({ key: conversationId, place, label: "Shelly's commands" });
  assert.ok(session);
  assert.deepEqual(shell.terminalCommand(conversationId).slice(-4), ["tmux", "attach", "-t", "main"]);
  run = await go("echo kept > /tmp/kept.txt; echo first-run");
  assert.equal(run.status, "done", run.output);
  run = await go("cat /tmp/kept.txt; tmux ls | cut -d: -f1");
  assert.match(run.output, /kept\nmain/u);
  // A whole output written after the session started is there at /runs, read-only.
  run = await go("seq 1 50000");
  assert.equal(run.truncated, true);
  const cut = run.run;
  run = await go(`tail -n 1 /runs/${cut}.log; touch /runs/x 2>&1`);
  assert.match(run.output, /^50000\n.*Read-only file system/u);
  run = await go("sleep 30", { maxSeconds: 2 });
  assert.equal(run.status, "failed");
  assert.match(run.stopped, /ran out of time/u);
  run = await go("sed 's/\\x1b\\[[0-9;]*m//g' /tmp/bot.log");
  assert.match(run.output, /\$ test\nfirst-run\n\(exit 0\)/u);
  // The log under the Terminal's top pane stays small, even when a command reads it while it grows.
  run = await go("seq 1 300000");
  assert.equal(run.status, "done", run.output);
  run = await go("stat -c %s /tmp/bot.log");
  assert.ok(Number(run.output.trim()) < 3 * 1024 * 1024, run.output);
  run = await go("echo still-fine");
  assert.match(run.output, /still-fine/u);
  // The computer going to sleep doesn't stop a command running in its session: it finishes there,
  // and the session ends after it.
  const sleeper = go("sleep 3; cat /tmp/kept.txt; echo finished");
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await shell.detach(conversationId);
  assert.equal(shell.terminalCommand(conversationId), null);
  run = await sleeper;
  assert.equal(run.status, "done", run.output);
  assert.match(run.output, /kept\nfinished/u);
  run = await go("cat /tmp/kept.txt 2>&1");
  assert.match(run.output, /No such file/u, "after the session ends, commands start fresh again");

  // A background run whose server stopped heartbeating is marked stopped, once, and its bot told.
  const [stale] = await knex("shell_runs").insert({ workspace_id: workspaceId, bot_id: botId, conversation_id: conversationId, script: "sleep 999", server: "gone:1", background: true, heartbeat_at: knex.raw("now() - interval '5 minutes'") }).returning("id");
  await shell.sweep();
  await shell.sweep();
  assert.equal((await knex("shell_runs").where({ id: stale.id ?? stale }).first()).status, "stopped");
  assert.deepEqual(ended.slice(1).map((row) => row.status), ["stopped"]);
});

test("a command's computation is opened a block at a time: refused, none starts, and one running stops", { skip: shellAvailable(process.env) ? false : "the toolbox isn't installed (npm run tools:install)" }, async (context) => {
  const knex = await connectTestDatabase();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mercbot-shell-paused-"));
  const userId = (await knex("users").first())?.id;
  const [home] = await knex("workspaces").insert({ slug: `shell-paused-${Date.now()}`, name: "Shell paused", owner_user_id: userId, is_personal: false }).returning("id");
  const workspaceId = home.id ?? home;
  const [bot] = await knex("bots").insert({ user_id: userId, workspace_id: workspaceId, name: "Shelly", color: "#1E86FC" }).returning("id");
  const botId = String(bot.id ?? bot);
  context.after(async () => {
    await knex("workspaces").where({ id: workspaceId }).del();
    await knex.destroy();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const store = createFileStore({ root: "", fallback: dir, ownStorage: async () => null, settle: async () => {}, explain: async () => {} });
  // A home whose work is paused after its first two-second block: the next block isn't renewed.
  const settled = [];
  let blocks = 0;
  let refused = false;
  const meter = {
    startComputation: async () => {
      if (refused) throw refuseWork("This home's work is paused.", { code: "work_paused" });
      return { blockSeconds: 2, renew: async () => (blocks += 1, false), settle: async (seconds) => settled.push(seconds) };
    }
  };
  const { shell } = await startShell(knex, context, { store, meter, limits: { ...LIMITS, heartbeatSeconds: 1 } });
  const go = (script) => shell.start({ place: { homeId: workspaceId, botId, userId }, workspaceId, botId, userId, why: "test", script, maxSeconds: 60 });

  const run = await go("sleep 30; echo never");
  assert.equal(run.status, "stopped", JSON.stringify(run));
  assert.equal(run.stopped, "It was stopped because its home's work is paused.");
  assert.equal(blocks, 1, "it stopped when the next block wasn't renewed");
  assert.equal(settled.length, 1, "what it ran is settled once");
  assert.ok(settled[0] < 10, `it ran ${settled[0]} s, not its thirty`);

  refused = true;
  const notStarted = await go("echo hello");
  assert.equal(notStarted.status, "unavailable");
  assert.equal(notStarted.error, "This home's work is paused.");
  assert.equal(await knex("shell_runs").where({ workspace_id: workspaceId, script: "echo hello" }).first(), undefined, "nothing started");
});
