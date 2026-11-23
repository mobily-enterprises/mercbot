import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { seedChat } from "../support/chatFixtures.mjs";
import { startShell } from "../support/ownedHandles.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { createFileStore } from "../../packages/files/src/server/fileStore.js";
import { shellAvailable } from "../../packages/files/src/server/gvisor.js";
import { __testables } from "../../packages/files/src/server/shell.js";
import { refuseWork } from "../../packages/account/src/server/meter.js";

const { LIMITS } = __testables;

// Bots' command line (D-47): gVisor, no network of its own (the internet only through its gateway, D-126, which
// commandInternet.test.js proves), only the chat's folders (R6; in a private chat the bot's and the
// home's are read-only, D13), limits on time, memory, processes, file size and output; background runs, heartbeats and
// stopped servers. A bot's commands in a chat are its seat's there (chat_bots, D14).
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

test("bots' commands run sealed off, within limits, and carry on in the background", { skip: shellAvailable(process.env) ? false : "the toolbox isn't installed (npm run tools:install)" }, async (context) => {
  const knex = await connectTestDatabase();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mercbot-shell-test-"));
  const userId = String((await knex("users").first())?.id);
  const [home] = await knex("workspaces").insert({ slug: `shell-${Date.now()}`, name: "Shell test", owner_user_id: userId, is_personal: false }).returning("id");
  const workspaceId = String(home.id ?? home);
  const [bot] = await knex("bots").insert({ made_by: userId, workspace_id: workspaceId, name: "Shelly", color: "#1E86FC" }).returning("id");
  const botId = String(bot.id ?? bot);
  const chat = await seedChat(knex, { homeId: workspaceId, kind: "public", people: [userId], bots: [botId] });
  const chatBotId = chat.chatBotIds.get(botId);
  context.after(async () => {
    await knex("workspaces").where({ id: workspaceId }).del();
    await knex.destroy();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const store = createFileStore({ root: "", fallback: dir, ownStorage: async () => null, settle: async () => {}, explain: async () => {} });
  // The whole sandbox's memory under one program's here, so that one program can go past it.
  const limits = { ...LIMITS, fileSize: 10 * 1024 * 1024, sandboxMemory: 1024 ** 3 };
  const { shell, inHome } = await startShell(knex, context, { store, limits });
  const place = store.placeFor({ homeId: workspaceId, chatId: chat.id, chatKind: "public", botId });
  const ended = [];
  shell.onEnd((run) => ended.push(run));
  const go = (script, extra = {}) => shell.start({ place, workspaceId, botId, chatBotId, userId, why: "test", script, ...extra });

  // The toolbox, the three folders, and what changed.
  let run = await go("echo hello > /files/chat/hello.txt && ls /files && ffmpeg -version | head -1 && python3 -c 'import pandas, pptx; print(\"py ok\")'");
  assert.equal(run.status, "done", run.output);
  assert.match(run.output, /^bot\nchat\ndb\nshared\n/u);
  assert.match(run.output, /ffmpeg version/u);
  assert.match(run.output, /py ok/u);
  assert.deepEqual(run.changed, ["/files/chat/hello.txt"]);
  assert.equal((await fs.readFile((await store.existingFile(place, "/files/chat/hello.txt")).real, "utf8")), "hello\n");

  // No network of its own (a direct connection finds none), no server files, no server environment: only its own
  // variables, with the gateway's proxy (D-126).
  run = await go("python3 -c 'import socket; socket.create_connection((\"1.1.1.1\", 80), 3)' 2>&1 | tail -1; ls /var/lib /home 2>&1; ls " + JSON.stringify(dir) + " 2>&1; env | cut -d= -f1 | sort | tr '\\n' ' '");
  assert.match(run.output, /Network is unreachable/u);
  assert.doesNotMatch(run.output, /^vibe64$/mu);
  assert.match(run.output, /cannot access '[^']*mercbot-shell-test[^']*': No such file or directory/u);
  assert.equal(run.output.trim().split("\n").at(-1).trim(), "ALL_PROXY GIT_SSH_COMMAND HOME HTTPS_PROXY HTTP_PROXY LANG LC_ALL MPLBACKEND NODE_USE_ENV_PROXY NO_PROXY " +
    "NPM_CONFIG_PREFIX PATH PIP_BREAK_SYSTEM_PACKAGES PIP_ROOT_USER_ACTION PWD PYTHONDONTWRITEBYTECODE SHLVL TERM TMPDIR _ " +
    "all_proxy http_proxy https_proxy no_proxy");

  // Limits: time, memory, file size, processes, output.
  run = await go("while true; do :; done", { maxSeconds: 3 });
  assert.equal(run.status, "failed");
  assert.match(run.stopped, /ran out of time/u);
  run = await go("python3 -c 'x = bytearray(8 * 1024 ** 3)' 2>&1 | tail -1");
  assert.match(run.output, /MemoryError/u);
  run = await go("python3 -c 'x = bytearray(1536 * 1024 ** 2); import time; time.sleep(30)'", { maxSeconds: 60 });
  assert.equal(run.stopped, "It used too much memory.");
  run = await go("head -c 20M /dev/zero > /files/chat/big 2>&1; ls -l /files/chat/big | awk '{print $5}'");
  assert.match(run.output, /File too large|10485760/u);
  run = await go("bomb() { bomb | bomb & }; bomb; sleep 2; echo survived", { maxSeconds: 10 });
  assert.ok(["done", "failed"].includes(run.status));
  run = await go("seq 1 50000");
  assert.equal(run.truncated, true);
  assert.match(run.output, /output cut/u);

  // Files are never programs: nothing in the folders can be started, scripts run through bash.
  run = await go("cp /bin/echo /files/chat/e && chmod +x /files/chat/e && /files/chat/e hi 2>&1; printf 'echo via-bash' > /files/chat/s.sh && bash /files/chat/s.sh; rm -f /files/chat/e /files/chat/s.sh");
  assert.match(run.output, /\/files\/chat\/e: Permission denied/u);
  assert.match(run.output, /via-bash/u);

  // A link made inside can't make the app serve a server file.
  await go("ln -s /etc/passwd /files/chat/p");
  await assert.rejects(store.existingFile(place, "/files/chat/p"), /isn't there/u);

  // The records' Database files are there to read and copy from, never to change (D-127).
  await fs.writeFile(path.join(dir, "pic.png"), "picture");
  await store.writeRecordFile(workspaceId, { table: "graphics", record: "1", field: "picture" }, path.join(dir, "pic.png"), "pic.png");
  run = await go("cat /files/db/tables/graphics/1/picture/pic.png; echo; cp /files/db/tables/graphics/1/picture/pic.png /files/chat/ && echo copied; rm /files/db/tables/graphics/1/picture/pic.png 2>&1; touch /files/db/x 2>&1");
  assert.match(run.output, /^picture\ncopied\n/u);
  assert.match(run.output, /pic\.png.*Read-only file system/u);
  assert.match(run.output, /\/files\/db\/x.*Read-only file system/u);

  // Asked by another bot: the chat's and the home's folders are read-only.
  run = await go("touch /files/chat/x 2>&1; touch /files/shared/x 2>&1; touch /files/bot/ok && echo bot-ok", { readOnly: ["chat", "shared"] });
  assert.match(run.output, /\/files\/chat\/x.*Read-only file system/u);
  assert.match(run.output, /\/files\/shared\/x.*Read-only file system/u);
  assert.match(run.output, /bot-ok/u);

  // In a private chat its bot only reads /files/bot and /files/shared (D13): they're mounted read-only and the chat's
  // own folder isn't. Widened (a card a person tapped), it writes in all three.
  await go("echo for-everyone > /files/bot/note.txt && echo the-home > /files/shared/note.txt");
  const secret = await seedChat(knex, { homeId: workspaceId, kind: "private", people: [userId], bots: [botId] });
  const privately = store.placeFor({ homeId: workspaceId, chatId: secret.id, chatKind: "private", botId });
  const goPrivately = (script, where = privately) => shell.start({ place: where, workspaceId, botId, chatBotId: secret.chatBotIds.get(botId), userId, why: "test", script });
  run = await goPrivately("cat /files/bot/note.txt /files/shared/note.txt; touch /files/chat/ok && echo chat-ok; touch /files/bot/x 2>&1; touch /files/shared/x 2>&1");
  assert.match(run.output, /^for-everyone\nthe-home\nchat-ok\n/u);
  assert.match(run.output, /\/files\/bot\/x.*Read-only file system/u);
  assert.match(run.output, /\/files\/shared\/x.*Read-only file system/u);
  assert.deepEqual(run.changed, ["/files/chat/ok"]);
  run = await goPrivately("touch /files/bot/wide.txt /files/shared/wide.txt && echo wide-ok", store.widened(privately));
  assert.match(run.output, /wide-ok/u);
  assert.deepEqual([...run.changed].sort(), ["/files/bot/wide.txt", "/files/shared/wide.txt"]);

  // One command at a time per bot in a chat: two fired together run one after the other.
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
  const session = await shell.attach({ key: chatBotId, place, label: "Shelly's commands" });
  assert.ok(session);
  assert.deepEqual(shell.terminalCommand(chatBotId).slice(-4), ["tmux", "attach", "-t", "main"]);
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
  await shell.detach(chatBotId);
  assert.equal(shell.terminalCommand(chatBotId), null);
  run = await sleeper;
  assert.equal(run.status, "done", run.output);
  assert.match(run.output, /kept\nfinished/u);
  run = await go("cat /tmp/kept.txt 2>&1");
  assert.match(run.output, /No such file/u, "after the session ends, commands start fresh again");

  // A background run whose server stopped heartbeating is marked stopped, once, and its bot told.
  const [stale] = await knex("shell_runs").insert({ workspace_id: workspaceId, chat_bot_id: chatBotId, script: "sleep 999", server: "gone:1", background: true, heartbeat_at: knex.raw("now() - interval '5 minutes'") }).returning("id");
  await shell.sweep();
  await shell.sweep();
  assert.equal((await knex("shell_runs").where({ id: stale.id ?? stale }).first()).status, "stopped");
  assert.deepEqual(ended.slice(1).map((row) => row.status), ["stopped"]);
});

test("a command's computation is opened a block at a time: refused, none starts, and one running stops", { skip: shellAvailable(process.env) ? false : "the toolbox isn't installed (npm run tools:install)" }, async (context) => {
  const knex = await connectTestDatabase();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mercbot-shell-paused-"));
  const userId = String((await knex("users").first())?.id);
  const [home] = await knex("workspaces").insert({ slug: `shell-paused-${Date.now()}`, name: "Shell paused", owner_user_id: userId, is_personal: false }).returning("id");
  const workspaceId = String(home.id ?? home);
  const [bot] = await knex("bots").insert({ made_by: userId, workspace_id: workspaceId, name: "Shelly", color: "#1E86FC" }).returning("id");
  const botId = String(bot.id ?? bot);
  const chat = await seedChat(knex, { homeId: workspaceId, kind: "public", people: [userId], bots: [botId] });
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
  const place = store.placeFor({ homeId: workspaceId, chatId: chat.id, chatKind: "public", botId });
  const go = (script) => shell.start({ place, workspaceId, botId, chatBotId: chat.chatBotIds.get(botId), userId, why: "test", script, maxSeconds: 60 });

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
  // A command is always a bot's in a chat: without its seat, none starts.
  refused = false;
  await assert.rejects(shell.start({ place, workspaceId, botId, userId, why: "test", script: "echo nowhere" }), /chatBotId is needed/u);
  assert.equal(await knex("shell_runs").where({ workspace_id: workspaceId, script: "echo nowhere" }).first(), undefined);
});
