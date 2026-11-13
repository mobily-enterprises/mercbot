import { execFile, spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { refusalOf } from "@local/account/meter";
import { BOT, MINE, SHARED } from "./fileStore.js";
import {
  folderMount, platformFlags, runSandboxed, runsc, sandboxMemory, sandboxPlace, sandboxSpec, shellAvailable, sweepSandboxes, toolsDir
} from "./gvisor.js";

const run = promisify(execFile);

// Bots' command line (D-47). A command is a bash script run in gVisor, which puts its own kernel
// between the script and the server's, rootless and without any network. The script sees the
// Ubuntu toolbox (scripts/build-toolbox.sh; its changes vanish after the run), a private /tmp, the
// Craft apps, and only the conversation's three folders. Limits: wall time, memory (each process,
// and the whole sandbox, watched from outside), processes, open files, file size and output.
// Every run is a shell_runs row. One that outlives the reply carries on in the background on this
// server, with a heartbeat; its ending is passed to `onEnd` handlers, which wake the bot.
const LIMITS = {
  foregroundSeconds: 120,
  maxSeconds: 1800,
  outputHead: 8000,
  outputTail: 8000,
  // The whole output, kept as a file when the above cuts it (D-48: /runs/<run>.log, as Claude Code
  // keeps large outputs), and for how long.
  outputFull: 16 * 1024 * 1024,
  outputFullDays: 7,
  sandboxMemory: 3 * 1024 ** 3,
  processMemory: 2 * 1024 ** 3,
  processes: 128,
  openFiles: 1024,
  fileSize: 4 * 1024 ** 3,
  scratch: "1g",
  changed: 50,
  heartbeatSeconds: 20,
  staleSeconds: 90,
  // MERCBOT_SHELL_RUNS sets it per server (createShell).
  perServer: 2
};

/** Why a run was stopped, as its bot is told (a run out of time says how long it had). */
const STOPPED = Object.freeze({
  memory: "It used too much memory.",
  shutdown: "It was stopped because its server shut down.",
  paused: "It was stopped because its home's work is paused."
});

/** The Craft apps' folders, for PATH inside the sandbox. */
function craftPaths(env) {
  const apps = path.join(toolsDir(env), "apps");
  try {
    return readdirSync(apps).map((name) => `/opt/apps/${name}/bin`);
  } catch {
    return [];
  }
}

/**
 * The OCI bundle for one run, or for a computer's command-line session (`term`, `label`). `args`,
 * `cwd`, `env` (replacing variables of the same name) and `mounts` ({source, destination,
 * readonly, exec}) are for other programs run in the same sandbox, such as the office apps. `runtimeEnv` is the
 * server's env, for the tools folder and the sandbox user.
 */
function bundle({
  runtimeEnv,
  dirs, script, limits, readOnly = [], term = "dumb", label = "",
  args = ["/bin/bash", "-c", script], cwd = dirs.personal ? MINE : BOT, env = [], mounts = [], rootReadOnly = false
}) {
  const apps = path.join(toolsDir(runtimeEnv), "apps");
  return sandboxSpec({
    runtimeEnv,
    args,
    cwd,
    env: [
      `PATH=${["/usr/local/bin", "/usr/bin", "/bin", ...craftPaths(runtimeEnv)].join(":")}`,
      "HOME=/tmp/home", "TMPDIR=/tmp", "LANG=C.UTF-8", "LC_ALL=C.UTF-8", "MPLBACKEND=Agg", "PYTHONDONTWRITEBYTECODE=1", `TERM=${term}`,
      ...(label ? [`BOT_LABEL=${label}`] : [])
    ].filter((entry) => !env.some((other) => other.split("=")[0] === entry.split("=")[0])).concat(env),
    limits,
    rootReadOnly,
    mounts: [
      folderMount(dirs.mine, MINE, { readonly: readOnly.includes(dirs.personal ? "mine" : "bot") }),
      ...(dirs.bot ? [folderMount(dirs.bot, BOT, { readonly: readOnly.includes("bot") })] : []),
      folderMount(dirs.shared, SHARED, { readonly: readOnly.includes("shared") }),
      // The conversation's whole command outputs, to read with grep, tail and the like (D-48).
      ...(dirs.runs ? [folderMount(dirs.runs, "/runs", { readonly: true })] : []),
      ...(existsSync(apps) ? [folderMount(apps, "/opt/apps", { readonly: true, exec: true })] : []),
      ...mounts.map((mount) => folderMount(mount.source, mount.destination, { readonly: mount.readonly, exec: mount.exec }))
    ]
  });
}

/** Keeps the first and the last part of a long output, and the whole of it up to `outputFull`. */
function outputBuffer(limits) {
  let head = "";
  let tail = "";
  let cut = false;
  let full = "";
  let fullCut = false;
  return {
    add(text) {
      if (full.length < limits.outputFull) full += text.slice(0, limits.outputFull - full.length);
      else fullCut = true;
      if (head.length < limits.outputHead) {
        const room = limits.outputHead - head.length;
        head += text.slice(0, room);
        text = text.slice(room);
      }
      if (!text) return;
      tail += text;
      if (tail.length > limits.outputTail) {
        tail = tail.slice(-limits.outputTail);
        cut = true;
      }
    },
    get text() {
      return cut ? `${head}\n… (output cut) …\n${tail}` : head + tail;
    },
    get truncated() {
      return cut;
    },
    // Only worth keeping when the shown text was cut.
    get full() {
      return cut ? `${full}${fullCut ? "\n… (the rest was too long to keep)" : ""}` : null;
    }
  };
}

/**
 * One command in gVisor. Returns { done, kill, output }: `done` resolves to
 * { exitCode, output, truncated, seconds, killed } and never rejects.
 */
function execute({ env, dirs, script, maxSeconds, limits, readOnly }) {
  const output = outputBuffer(limits);
  const started = runSandboxed({
    env,
    place: sandboxPlace(),
    spec: bundle({ runtimeEnv: env, dirs, script, limits, readOnly }),
    maxSeconds,
    memory: limits.sandboxMemory,
    onOutput: (text) => output.add(text)
  });
  const done = started
    .then(({ done: ended }) => ended, (error) => {
      output.add(`\n${error.message}`);
      return { exitCode: 127, seconds: 0, killed: null };
    })
    .then((result) => ({ ...result, output: output.text, truncated: output.truncated, full: output.full }));
  return { done, kill: (reason) => started.then((job) => job.kill(reason), () => {}), output };
}

/**
 * Another program in the bots' sandbox (D-49: everything runs in gVisor), with the place's
 * folders (`dirs`) and the same limits, for the office apps and voice memos. Its system is
 * read-only, so a save outside the folders and /tmp fails instead of vanishing. Returns
 * { command, args } to run, with its stdin and stdout, and stop() to call once it has ended.
 */
export async function gvisorProcess({ runtimeEnv, dirs, args, cwd, env, mounts, readOnly }) {
  await sweepSandboxes(runtimeEnv);
  const { id, dir: runDir, state } = sandboxPlace("app");
  await fs.mkdir(state, { recursive: true });
  await fs.writeFile(path.join(runDir, "config.json"), JSON.stringify(
    bundle({ runtimeEnv, dirs, args, cwd, env, mounts, readOnly, limits: LIMITS, rootReadOnly: true })
  ));
  const [command, runArgs] = runsc(runtimeEnv, [
    "--rootless", "--network=none", "--ignore-cgroups", "--overlay2=root:memory", ...platformFlags(runtimeEnv),
    "--root", state, "run", "--bundle", runDir, id
  ]);
  return {
    command,
    args: runArgs,
    async stop() {
      await run(...runsc(runtimeEnv, ["--root", state, "delete", "-force", id]), { timeout: 30000 }).catch(() => {});
      await fs.rm(runDir, { recursive: true, force: true }).catch(() => {});
    }
  };
}

// How the session's tmux looks: no status bar, and each pane titled.
const TMUX_LOOK = "tmux set -g mouse on \\; set -g status off \\; set -g pane-border-status top \\;" +
  ' set -g pane-border-format " #{pane_title} " \\; set -g history-limit 5000';

// A computer's command line while it's awake (D-47): one sandbox that stays up, with a tmux
// session showing the bot's commands on top and the person's own shell below. The Terminal on the
// computer's desktop attaches to it, and the bot's commands run in it, so they show there live.
const SESSION = `mkdir -p /tmp/home; touch /tmp/bot.log
tmux -f /dev/null new-session -d -s main -x 160 -y 48 "tail -n 400 -F /tmp/bot.log 2>/dev/null"
${TMUX_LOOK}
tmux select-pane -t main.0 -T "$BOT_LABEL"
tmux split-window -v -t main -l 55% -c "$PWD" "while true; do bash -l; done"
tmux select-pane -t main.1 -T "Your shell"
exec sleep infinity`;

// The command itself, cut off at its time limit with everything it started; at most 1 MB of its
// output goes in the log.
const LOGGED_RUN = '{ setsid bash -c "$s" < /dev/null 2>&1 & p=$!; ( exec > /dev/null 2>&1; sleep "$t"; kill -KILL -- -"$p" ) & k=$!;' +
  ' wait "$p"; c=$?; kill "$k" 2>/dev/null; exit "$c"; } | tee -p >(head -c 1048576 >> /tmp/bot.log)';

// A bot's command inside a session: shown in the session's log as it runs, cut off at its time
// limit with everything it started, and its exit code returned. The log stays small: it starts
// again once past 1 MB, and takes at most 1 MB of one command (the bot still gets all of it).
const IN_SESSION = `w="$1"; t="$2"; s="$3"
[ "$(stat -c %s /tmp/bot.log 2>/dev/null || echo 0)" -lt 1048576 ] || : > /tmp/bot.log
printf '\\n\\033[1;36m$ %s\\033[0m\\n' "$w" >> /tmp/bot.log
${LOGGED_RUN}
c="\${PIPESTATUS[0]}"; wait $! 2>/dev/null
printf '\\033[2m(exit %s)\\033[0m\\n' "$c" >> /tmp/bot.log
exit "$c"`;

function executeIn(session, { env, script, why, maxSeconds, limits }) {
  const output = outputBuffer(limits);
  const started = Date.now();
  let killed = null;
  let child = null;
  const kill = async (reason) => {
    if (killed || !child) return;
    killed = reason;
    child.kill("SIGKILL");
  };
  const done = new Promise((resolve) => {
    child = spawn(...runsc(env, [
      "--root", session.state, "exec", "--cwd", session.cwd, session.id,
      "/bin/bash", "-c", IN_SESSION, "command", why || "command", String(maxSeconds), script
    ]), { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.setEncoding("utf8").on("data", (text) => output.add(text));
    child.stderr.setEncoding("utf8").on("data", (text) => output.add(text));
    // The script's own limit is inside; this is the backstop if the sandbox stops answering.
    const timer = setTimeout(() => kill("time"), (maxSeconds + 15) * 1000);
    const finish = (exitCode) => {
      clearTimeout(timer);
      const seconds = (Date.now() - started) / 1000;
      if (!killed && exitCode === 137 && seconds >= maxSeconds - 1) killed = "time";
      resolve({
        exitCode,
        output: output.text,
        truncated: output.truncated,
        full: output.full,
        seconds: Math.round(seconds * 10) / 10,
        killed
      });
    };
    child.on("error", (error) => {
      output.add(`\n${error.message}`);
      finish(127);
    });
    child.on("close", (code) => finish(code ?? 137));
  });
  return { done, kill, output };
}

/** What a command started while another runs in the background tells the bot. */
function busyMessage(runId) {
  return `A command is still running in the background in this conversation (run ${runId}). ` +
    "Use check_command to follow it, or wait for it to finish.";
}

/** What a command still running after its foreground time tells the bot. */
function backgroundNote(foregroundSeconds, maxSeconds) {
  return `Still running after ${foregroundSeconds} s, so it carries on in the background (up to ${Math.round(maxSeconds / 60)} minutes). ` +
    "You'll be woken in this conversation when it ends; check_command shows its progress.";
}

/**
 * The bots' command line (D-21, D-49): runs in gVisor sandboxes on the bot's folders, one after
 * another per conversation, with the shell_runs rows any server can read.
 * @param {object} dependencies
 * @param {import("./types.js").FileStore} dependencies.store
 * @param {import("./types.js").ShellRuns} dependencies.runs the shell_runs rows
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 * @param {typeof LIMITS} [dependencies.limits]
 * @param {string} [dependencies.server]
 * @param {Pick<import("@local/account/server/types").Meter, "startComputation">} dependencies.meter each command's
 *   computation is recorded through it a block at a time (D-73)
 */
export function createShell({
  store,
  runs,
  env,
  meter,
  limits = { ...LIMITS, perServer: Number(env.MERCBOT_SHELL_RUNS) || LIMITS.perServer },
  server = `${os.hostname()}:${process.pid}`
}) {
  const endHandlers = new Set();
  const sessions = new Map();
  const live = new Map();
  // A conversation's commands run one after another: one fired while another runs waits for it,
  // unless that one went on in the background (then the bot follows it with check_command).
  const busy = new Map();
  const waiting = [];
  let active = 0;
  let stopping = false;
  let sweeper = null;

  /** At most `perServer` sandboxes at once on this server; the rest wait their turn. */
  async function slot() {
    if (active < limits.perServer) {
      active += 1;
      return;
    }
    await new Promise((resolve) => waiting.push(resolve));
  }
  function release() {
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  }

  async function changedSince(place, since) {
    const { mine = [], bot = [], shared = [] } = await store.list(place).catch(() => ({}));
    return [...mine, ...bot, ...shared]
      .filter((file) => Date.parse(file.modified) >= since - 10)
      .map((file) => file.path)
      .slice(0, limits.changed);
  }

  async function ended(row) {
    for (const handler of endHandlers) await Promise.resolve(handler(row)).catch((error) => console.warn("A command-run end handler failed; the others still run.", error));
  }

  /**
   * Runs `script` for a bot's conversation. Waits up to `foregroundSeconds`; a run still going
   * after that carries on in the background and returns { status: "running", run }. `readOnly`
   * lists folders the script may only read ("mine", "shared"), for turns nobody asked for.
   */
  async function start({
    place, workspaceId, botId, conversationId = null, userId = null, why = "", script, readOnly = [],
    foregroundSeconds = limits.foregroundSeconds, maxSeconds = limits.maxSeconds
  }) {
    if (stopping) return { status: "unavailable", error: "This server is shutting down; try again in a moment." };
    if (!shellAvailable(env)) return { status: "unavailable", error: "The command line isn't installed on this server." };
    const key = String(conversationId ?? `${botId}:${userId}`);
    while (busy.has(key)) {
      const current = busy.get(key);
      if (current.background) return { status: "busy", error: busyMessage(current.run) };
      await current.finished.catch(() => {});
    }
    let settle = null;
    const mine = { background: false, run: null, finished: new Promise((resolve) => (settle = resolve)) };
    busy.set(key, mine);
    let dirs = null;
    let row = null;
    let hold = null;
    try {
      // Its computation is recorded a block at a time while it runs (D-73): work that's refused starts nothing.
      hold = await meter.startComputation({ workspaceId, botId, ...(userId ? { userId } : {}) });
      dirs = await store.prepare(place);
      if (conversationId && store.runsFolder) dirs = { ...dirs, runs: await store.runsFolder(conversationId) };
      row = await runs.begin(workspaceId, { botId, conversationId, userId, why: String(why).slice(0, 300), script, server });
    } catch (error) {
      busy.delete(key);
      settle();
      await hold?.settle(0).catch(() => {});
      const refusal = refusalOf(error);
      if (refusal) return { status: "unavailable", error: refusal.message };
      throw error;
    }
    mine.run = String(row.id);
    const startedAt = Date.now();
    await slot();
    // While the conversation's computer is awake its commands run in its session, where the
    // Terminal shows them; a turn another bot started keeps to a fresh sandbox (read-only folders).
    const session = !readOnly.length && conversationId != null ? sessions.get(String(conversationId)) : null;
    const job = session
      ? executeIn(session, { env, script, why, maxSeconds, limits })
      : execute({ env, dirs, script, maxSeconds, limits, readOnly });
    if (session) session.running += 1;
    // Before its block runs out, the next is opened; when that's refused, the command stops.
    let heldUntil = startedAt + hold.blockSeconds * 1000;
    const heartbeat = setInterval(() => {
      runs.beat(row, job.output.text).catch(() => {});
      if (Date.now() < heldUntil - 2 * limits.heartbeatSeconds * 1000) return;
      heldUntil = Infinity;
      hold.renew().then((renewed) => (renewed ? (heldUntil = Date.now() + hold.blockSeconds * 1000) : job.kill("paused")), () => job.kill("paused"));
    }, limits.heartbeatSeconds * 1000);
    heartbeat.unref();
    const finished = job.done.then(async (result) => {
      clearInterval(heartbeat);
      // The time it ran is recorded as computation for the bot, its home and the person the work is for (D-73).
      hold.settle(result.seconds).catch((error) => console.warn("Recording a command's computation failed.", error));
      // A computer that went to sleep while this ran ends its session now.
      if (session) {
        session.running -= 1;
        if (session.asleep && !session.running) end(session);
      }
      live.delete(String(row.id));
      busy.delete(key);
      settle();
      release();
      const changed = await changedSince(place, startedAt);
      // The whole output, when the shown one was cut, written once as /runs/<run>.log (D-48).
      if (result.full !== null && dirs.runs) {
        await fs.writeFile(path.join(dirs.runs, `${row.id}.log`), result.full)
          .catch((error) => console.error(`Keeping run ${row.id}'s output: ${error.message}`));
      }
      const status = ["shutdown", "paused"].includes(result.killed) ? "stopped" : result.exitCode === 0 ? "done" : "failed";
      const saved = await runs.finish(row, { status, exitCode: result.exitCode, output: result.output, changed });
      return { result, status, changed, saved };
    });
    live.set(String(row.id), { job, finished });
    // The wait's timer is cleared once the run finishes, so it doesn't hold the process for its whole length.
    let wait;
    const inTime = await Promise.race([
      finished,
      new Promise((resolve) => (wait = setTimeout(() => resolve(null), foregroundSeconds * 1000)))
    ]);
    clearTimeout(wait);
    if (inTime) {
      // As its record says: stopped when this server stopped it or its home's work was paused.
      const { result, status, changed } = inTime;
      return {
        status,
        run: String(row.id),
        exitCode: result.exitCode,
        output: result.output,
        truncated: result.truncated,
        seconds: result.seconds,
        ...(result.killed ? { stopped: STOPPED[result.killed] || `It ran out of time (${maxSeconds} s).` } : {}),
        changed
      };
    }
    mine.background = true;
    await runs.inBackground(row).catch(() => {});
    finished.then(({ saved }) => saved && ended(saved), () => {});
    return { status: "running", run: String(row.id), note: backgroundNote(foregroundSeconds, maxSeconds) };
  }

  /** A run's state, for the call's own home: status, output so far, files changed. */
  async function check(runId, options) {
    const row = await runs.find(runId, options);
    if (!row) return { error: "There's no such command." };
    const job = live.get(String(row.id))?.job;
    return {
      status: row.status,
      why: row.why,
      startedAt: row.startedAt,
      ...(row.finishedAt ? { finishedAt: row.finishedAt, exitCode: row.exitCode } : {}),
      output: job ? job.output.text : row.output,
      ...(await wholeOutputOf(row) ? { truncated: true } : {}),
      changed: row.changed
    };
  }

  /** Runs whose server stopped heartbeating: marked stopped once, here or on any other server. */
  async function sweep() {
    const stale = await runs.stopStale(limits.staleSeconds).catch(() => []);
    for (const row of stale) if (row.background) await ended(row);
    // Whole outputs can hold secrets, so they go after a week (D-48); looked for once an hour.
    if (Date.now() - lastOutputSweep > 3600 * 1000) {
      lastOutputSweep = Date.now();
      await removeOldOutputs().catch((error) => console.error(`Removing old command outputs: ${error.message}`));
    }
  }

  let lastOutputSweep = 0;
  async function removeOldOutputs({ now = Date.now() } = {}) {
    const oldest = now - limits.outputFullDays * 86400 * 1000;
    const conversations = await fs.readdir(store.runsRoot).catch(() => []);
    for (const conversation of conversations) {
      const dir = path.join(store.runsRoot, conversation);
      for (const name of await fs.readdir(dir).catch(() => [])) {
        const stat = await fs.stat(path.join(dir, name)).catch(() => null);
        if (stat && stat.mtimeMs < oldest) await fs.rm(path.join(dir, name), { force: true });
      }
      if (!(await fs.readdir(dir).catch(() => ["keep"])).length) await fs.rmdir(dir).catch(() => {});
    }
  }

  /** A run's whole output (/runs/<run>.log), when it was kept: of a run row, check()'s, or a commandOutput. */
  async function wholeOutputOf(row) {
    const conversationId = row?.conversationId ?? row?.conversation_id;
    if (!conversationId || !store.runsRoot) return null;
    return fs.readFile(path.join(store.runsRoot, String(conversationId), `${row.id}.log`), "utf8").catch(() => null);
  }

  /**
   * The computer's session for a conversation: started when its computer wakes, ended when it
   * sleeps. Its memory is watched like a run's; a session past the limit is ended.
   */
  async function attach({ key, place, label = "The bot's commands" }) {
    if (!shellAvailable(env)) return null;
    if (sessions.has(String(key))) return sessions.get(String(key));
    // The key is the conversation's id: its whole outputs are at /runs, as in its runs.
    let dirs = await store.prepare(place);
    if (store.runsFolder) dirs = { ...dirs, runs: await store.runsFolder(key) };
    await sweepSandboxes(env);
    const { id, dir: runDir, state } = sandboxPlace("session");
    await fs.mkdir(state, { recursive: true });
    await fs.writeFile(path.join(runDir, "config.json"), JSON.stringify(
      bundle({ runtimeEnv: env, dirs, script: SESSION, limits, term: "xterm-256color", label })
    ));
    await new Promise((resolve) => {
      const child = spawn(...runsc(env, [
        "--rootless", "--network=none", "--ignore-cgroups", "--overlay2=root:memory", ...platformFlags(env),
        "--root", state, "run", "--detach", "--bundle", runDir, id
      ]), { stdio: "ignore" });
      child.on("error", resolve);
      child.on("close", resolve);
    });
    const session = { key: String(key), id, state, runDir, cwd: dirs.personal ? MINE : BOT, running: 0, asleep: false };
    session.watchdog = setInterval(async () => {
      const used = await sandboxMemory(env, session);
      if (used !== null && used <= limits.sandboxMemory) return;
      if (sessions.get(session.key) === session) sessions.delete(session.key);
      end(session);
    }, 5000);
    session.watchdog.unref();
    sessions.set(session.key, session);
    return session;
  }

  /**
   * The computer went to sleep. New commands start fresh sandboxes from now on, but one still
   * running in the session finishes there first; the session ends after it.
   */
  async function detach(key) {
    const session = sessions.get(String(key));
    if (!session) return;
    sessions.delete(session.key);
    session.asleep = true;
    if (!session.running) await end(session);
  }

  async function end(session) {
    clearInterval(session.watchdog);
    await run(...runsc(env, ["--root", session.state, "delete", "-force", session.id]), { timeout: 30000 }).catch(() => {});
    await fs.rm(session.runDir, { recursive: true, force: true }).catch(() => {});
  }

  /** What the Terminal window runs to show a session: the person types into it, nothing else. */
  function terminalCommand(key) {
    const session = sessions.get(String(key));
    if (!session) return null;
    const [command, args] = runsc(env, ["--root", session.state, "exec", "--cwd", session.cwd, session.id, "tmux", "attach", "-t", "main"]);
    return [command, ...args];
  }

  function onEnd(handler) {
    endHandlers.add(handler);
    return () => endHandlers.delete(handler);
  }

  function startSweeping(everyMs = 30000) {
    sweeper ??= setInterval(() => sweep().catch(() => {}), everyMs);
    sweeper.unref();
  }

  /** Shutting down (D-19): no new runs; running ones are stopped and their bots told. */
  async function drain() {
    stopping = true;
    clearInterval(sweeper);
    // Each run's own ending marks it stopped and, for a background one, tells its bot.
    const running = [...live.values()];
    await Promise.all(running.map(({ job }) => job.kill("shutdown")));
    await Promise.allSettled(running.map(({ finished }) => finished));
    await Promise.all([...sessions.keys()].map(detach));
  }

  /** Whether this server has the command line installed. */
  function available() {
    return shellAvailable(env);
  }

  return Object.freeze({
    available,
    attach,
    detach,
    terminalCommand,
    start,
    check,
    sweep,
    removeOldOutputs,
    wholeOutputOf,
    onEnd,
    startSweeping,
    drain
  });
}

/** Pure helpers and data the tests reach directly (rule 64). */
export const __testables = Object.freeze({ LIMITS });
