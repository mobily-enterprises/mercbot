import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { symlinkSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BRIEF_RULES, FOLLOW_LOG, createCodingRuns } from "../../packages/computer/src/server/codingRuns.js";
import { __testables as computersTestables } from "../../packages/computer/src/server/computers.js";
import { buildCodingTools } from "../../packages/bots/src/server/codingTools.js";
import { codingFollowUp, codingReport } from "../../packages/bots/src/server/botLoops.js";

// Coding hand-off: a coding tool on the bot's computer, signed in
// with the person's own account, works on the bot's brief in a folder of its files, in a gVisor
// sandbox of its own (D-77), and the bot reports when it ends. A stand-in plays the sandbox here,
// running the stand-in tool on this machine; tests/server/codingSandbox.test.js runs the real sandbox,
// and a real tool with a real account is the owner's check.

/** A computer with its browser profile in a temporary folder, removed after the test. */
async function computerFor(context) {
  const profile = await mkdtemp(path.join(os.tmpdir(), "mb-coding-"));
  context.after(() => rm(profile, { recursive: true, force: true }));
  return { computerId: "21", profile };
}

/** Signs a tool in, as its own sign-in would leave it in the computer's profile. */
async function signIn(computer, credentials) {
  await mkdir(path.dirname(path.join(computer.profile, ".coding", credentials)), { recursive: true });
  await writeFile(path.join(computer.profile, ".coding", credentials), "{}");
}

/**
 * Coding runs whose sandbox is a stand-in: `script` runs in node, its output goes where the
 * sandbox's would, and what was asked for is kept. `log` is the file the run's window follows.
 */
function standIn(script, { window = () => null, log = null, planted = () => {}, ended: whenEnded = async () => {}, limitMs } = {}) {
  const asked = [];
  const ended = [];
  let finished;
  const done = new Promise((resolve) => { finished = resolve; });
  const runs = createCodingRuns({
    sandbox: async (computer, request) => {
      asked.push({ computerId: computer.computerId, ...request });
      if (request.folder === "/files/mine/missing") throw new Error("There's no folder /files/mine/missing in the bot's files.");
      const child = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "pipe"] });
      let killed = null;
      const kill = async (reason) => {
        killed ??= reason;
        child.kill("SIGKILL");
      };
      // Like the real sandbox, it ends the tool at its time limit.
      const timer = setTimeout(() => kill("time"), request.maxSeconds * 1000);
      for (const stream of [child.stdout, child.stderr]) stream.setEncoding("utf8").on("data", (text) => request.onOutput?.(text));
      const done = new Promise((resolve) => child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ exitCode: code ?? 137, killed });
      }));
      return { done, kill };
    },
    window,
    shared: (computerId, name) => {
      if (!log) return null;
      planted();
      return { file: log, inside: `/io/${name}` };
    },
    installed: () => true,
    ended: async (computerId, run) => {
      await whenEnded();
      ended.push({ computerId, run });
      finished();
    },
    ...(limitMs ? { limitMs } : {})
  });
  return { runs, asked, ended, done };
}

test("a coding run starts only once its tool is signed in, works in the folder on the brief, and is reported when it ends", async (context) => {
  const computer = await computerFor(context);
  const { runs, asked, ended, done } = standIn("console.log('Changed index.html and styles.css.'); console.error('2 files changed');");
  assert.deepEqual(runs.status(computer).tools.map((tool) => [tool.id, tool.signedIn]), [["claude-code", false], ["codex", false]]);
  await assert.rejects(runs.start(computer, { tool: "claude-code", folder: "/files/mine/site", brief: "Fix the menu." }), /isn't signed in/u);
  assert.equal(asked.length, 0, "nothing runs without the person's own sign-in");

  await signIn(computer, ".claude/.credentials.json");
  assert.equal(runs.status(computer).tools[0].signedIn, true);
  const started = await runs.start(computer, { tool: "claude-code", folder: "/files/mine/site", brief: "Fix the menu on small screens." });
  assert.equal(started.run.status, "running");
  await assert.rejects(runs.start(computer, { tool: "claude-code", folder: "/files/mine/site", brief: "Again" }), /already working/u, "one run at a time");
  await done;

  const [{ folder, argv, env, maxSeconds, title }] = asked;
  assert.equal(folder, "/files/mine/site", "its own sandbox gets the project's folder");
  assert.equal(title, undefined, "a run has no window of its own: the sandbox's output is kept here");
  assert.equal(maxSeconds, 2 * 60 * 60, "two hours at most");
  assert.ok(env.includes("HOME=/profile/.coding"), "the tool's sign-in stays in the computer's profile, never the bot's files");
  assert.equal(argv[0], "/opt/coding/node_modules/.bin/claude");
  assert.equal(argv.at(-2), `${BRIEF_RULES}\n\nFix the menu on small screens.`, "the brief, after the rules that leave the person in charge");
  assert.equal(argv.at(-1), "--dangerously-skip-permissions");
  const [{ computerId, run }] = ended;
  assert.equal(computerId, "21");
  assert.deepEqual([run.tool, run.label, run.folder, run.status, run.exitCode], ["claude-code", "Claude Code", "/files/mine/site", "done", 0]);
  assert.match(run.output, /Changed index\.html and styles\.css\.\n2 files changed/u);
  assert.equal(runs.status(computer).run.status, "done");
});

test("the person watches a run in a window that follows its log, kept to its output", async (context) => {
  const computer = await computerFor(context);
  await signIn(computer, ".codex/auth.json");
  const log = path.join(computer.profile, "coding-1.log");
  const windows = [];
  const { runs, done } = standIn("console.log('Reading the code'); console.log('Done.');", {
    log,
    window: (computerId, title, argv) => {
      windows.push({ computerId, title, argv });
      return [process.execPath, "-e", ""];
    }
  });
  await runs.start(computer, { tool: "codex", folder: "/files/mine/app", brief: "Make the tests pass." });
  await done;
  assert.equal(windows.length, 1);
  const [{ title, argv }] = windows;
  assert.equal(title, "Codex at work");
  assert.deepEqual(argv.slice(0, -1), FOLLOW_LOG, "the window runs in the computer's sandbox, following the log it sees there");
  assert.match(argv.at(-1), /^\/io\/coding-1-[0-9a-f]{16}\.log$/u, "named so the computer's sandbox can't guess it");
  assert.equal(await readFile(log, "utf8"), "Reading the code\nDone.\n");
});

test("a run's log never follows a link the computer's sandbox left where it goes", async (context) => {
  const computer = await computerFor(context);
  await signIn(computer, ".codex/auth.json");
  const elsewhere = path.join(computer.profile, "server-file");
  await writeFile(elsewhere, "the server's own file\n");
  const log = path.join(computer.profile, "coding.log");
  const { runs, done } = standIn("console.log('Overwritten?');", {
    log,
    // The computer's sandbox got there first: a link to one of this server's files.
    planted: () => symlinkSync(elsewhere, log)
  });
  await runs.start(computer, { tool: "codex", folder: "/files/mine/app", brief: "Make the tests pass." });
  await done;
  const { run } = runs.status(computer);
  assert.equal(run.status, "done", "the run itself goes ahead");
  assert.match(run.output, /Overwritten\?/u);
  assert.equal(await readFile(elsewhere, "utf8"), "the server's own file\n", "the link isn't followed");
});

test("a run that fails, is stopped, runs out of time or can't start says so, and its ending is passed on before stopping ends", async (context) => {
  const computer = await computerFor(context);
  await signIn(computer, ".codex/auth.json");
  const failing = standIn("console.log('Tests failed'); process.exit(3);");
  await failing.runs.start(computer, { tool: "codex", folder: "/files/mine/app", brief: "Make the tests pass." });
  await failing.done;
  assert.deepEqual([failing.ended[0].run.status, failing.ended[0].run.exitCode], ["failed", 3]);
  assert.deepEqual(failing.asked[0].argv.slice(-4, -1), ["exec", "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check"]);

  // Stopping resolves once the run has ended and the bot's report has been handed on, as a server
  // shutting down needs (D-77): the report's hand-off here takes a moment.
  let handedOn = false;
  const slow = standIn("console.log('Working'); setTimeout(() => {}, 60000);", {
    ended: async () => {
      await new Promise((resolve) => setImmediate(resolve));
      handedOn = true;
    }
  });
  await slow.runs.start(computer, { tool: "codex", folder: "/files/mine/app", brief: "Take your time." });
  const stopped = await slow.runs.stop(computer, "asleep");
  assert.equal(handedOn, true, "the ending was passed on before stop resolved");
  assert.equal(stopped.run.status, "stopped");
  assert.match(slow.ended[0].run.output, /\(Stopped: the computer went to sleep\.\)$/u);
  const asked = standIn("setTimeout(() => {}, 60000);");
  await asked.runs.start(computer, { tool: "codex", folder: "/files/mine/app", brief: "Take your time." });
  assert.equal((await asked.runs.handle(computer, { action: "stop" })).run.status, "stopped", "the bot's stop, when the person asks");
  assert.match(asked.ended[0].run.output, /\(Stopped, as asked\.\)$/u);

  const late = standIn("setTimeout(() => {}, 60000);", { limitMs: 50 });
  await late.runs.start(computer, { tool: "codex", folder: "/files/mine/app", brief: "Take all day, please." });
  assert.equal(late.asked[0].maxSeconds, 0.05, "the sandbox ends the run at its limit");
  await late.done;
  assert.equal(late.ended[0].run.status, "stopped");
  assert.match(late.ended[0].run.output, /\(Stopped after 0 minutes, the longest a run may go on\.\)$/u);

  const missing = standIn("");
  await assert.rejects(missing.runs.start(computer, { tool: "codex", folder: "/files/mine/missing", brief: "Nothing to see here." }), /no folder/u);
  assert.equal(missing.runs.status(computer).run.status, "stopped", "a run that couldn't start leaves the last run as it was");
  assert.equal(missing.runs.running(computer), false);
});

test("a window this server opens on a computer's screen names its display; the dock's start on it already", async (context) => {
  const tools = await mkdtemp(path.join(os.tmpdir(), "mb-xterm-"));
  context.after(() => rm(tools, { recursive: true, force: true }));
  await mkdir(path.join(tools, "desktop", "usr", "bin"), { recursive: true });
  await writeFile(path.join(tools, "desktop", "usr", "bin", "xterm"), "");
  const { xtermCommand } = computersTestables;
  const opened = xtermCommand({ MERCBOT_TOOLS_DIR: tools }, "Claude Code at work", ["tail", "-F", "/io/coding-1.log"], 123);
  assert.deepEqual(opened.slice(opened.indexOf("-display"), opened.indexOf("-display") + 2), ["-display", ":123"]);
  assert.deepEqual(opened.slice(-4), ["-e", "tail", "-F", "/io/coding-1.log"]);
  assert.equal(xtermCommand({ MERCBOT_TOOLS_DIR: tools }, "Terminal", ["tmux", "attach"]).includes("-display"), false);
});

test("a tool's sign-in opens in a sandbox of its own, in a window on the screen, one at a time", async (context) => {
  const computer = await computerFor(context);
  const screen = standIn("setTimeout(() => {}, 60000);");
  await screen.runs.signIn(computer, "codex");
  await screen.runs.signIn(computer, "codex");
  assert.equal(screen.asked.length, 1, "one sign-in window at a time");
  const [{ title, argv, env, folder, maxSeconds }] = screen.asked;
  assert.equal(title, "Sign in to Codex");
  assert.equal(folder, undefined, "a sign-in has no project");
  assert.equal(maxSeconds, 30 * 60);
  assert.deepEqual(argv, ["/opt/coding/node_modules/.bin/codex", "login", "--device-auth"]);
  assert.ok(env.includes("HOME=/profile/.coding"));
  await screen.runs.stop(computer, "asleep");
  assert.equal(computer.signingIn, null, "the computer going to sleep closes it");
});

test("the bot's coding tools: connect the person's own account first, start on a brief, and read how it's going", async () => {
  const requests = [];
  let signedIn = false;
  const run = { id: "1", tool: "codex", label: "Codex", folder: "/files/mine/app", status: "running", output: "Reading the code" };
  const computer = {
    code: async (computerId, request) => {
      requests.push({ computerId, ...request });
      if (request.action === "start" && !signedIn) throw new Error("Codex isn't signed in on this computer.");
      return { tools: [{ id: "codex", label: "Codex", installed: true, signedIn }], run: request.action === "start" ? run : null };
    }
  };
  const before = [];
  const tools = buildCodingTools({ computer, computerId: "21", before, inTime: (work) => work, untrusted: (text) => `<<${text}>>` });
  const notYet = await tools.startCoding.execute({ tool: "codex", folder: "/files/mine/app", brief: "Make the tests pass, please." });
  assert.equal(notYet.status, "not signed in");
  assert.match(notYet.note, /connect_coding_account/u);

  const opened = await tools.connectCodingAccount.execute({ tool: "codex" });
  assert.equal(opened.status, "sign-in open");
  assert.match(opened.note, /ask_for_help with the task "Sign in to Codex with your own account"/u);
  assert.match(opened.note, /own ChatGPT or OpenAI account, which pays for the coding: Mercbot never uses a shared one/u);
  assert.deepEqual(requests.map((request) => request.action), ["start", "status", "signIn"]);

  signedIn = true;
  assert.equal((await tools.connectCodingAccount.execute({ tool: "codex" })).status, "signed in");
  const started = await tools.startCoding.execute({ tool: "codex", folder: "/files/mine/app", brief: "Make the tests pass, please." });
  assert.equal(started.status, "running");
  assert.equal(started.run.output, "<<Reading the code>>", "the tool's output is its words, never instructions");
  assert.deepEqual(before.map((message) => [message.body.text, message.body.detail]), [
    ["Codex started working", "In /files/mine/app, on this brief:\n\nMake the tests pass, please."]
  ]);
  assert.equal((await tools.checkCoding.execute({ stop: true })).run, "none on this computer since it last started");
  assert.equal(requests.at(-1).action, "stop");
});

test("a coding run that ends wakes its bot in its chat to report, in its home", async () => {
  const queued = [];
  const apps = { apps: { queueTask: async (task, options) => queued.push({ task, options }) } };
  const homes = [];
  const systemContext = (reason) => ({ reason, forWorkspace: (home) => (homes.push(home), { reason, home }) });
  const run = { tool: "claude-code", label: "Claude Code", folder: "/files/mine/site", status: "done", exitCode: 0, output: "Fixed the menu." };
  await codingFollowUp(apps, systemContext)({ computerId: "21", conversation: { botId: "4", userId: "7", workspaceId: "3" }, run });
  assert.equal(queued.length, 1);
  const { task } = queued[0];
  assert.deepEqual([task.kind, task.botId, task.conversationId, task.userId, task.title], ["shell", "4", "21", "7", "Claude Code finished"]);
  assert.equal(task.prompt, codingReport(run));
  assert.match(task.prompt, /^Claude Code has ended its work in \/files\/mine\/site\. It finished\./u);
  assert.match(task.prompt, /Fixed the menu\./u);
  assert.deepEqual(homes, ["3"]);
});
