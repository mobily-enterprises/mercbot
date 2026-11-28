import { execFile, spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { refusalOf } from "@local/account/meter";
import { BOT, CHAT, DB, SHARED } from "./fileStore.js";
import { GATEWAY_INSIDE, PROXY_ENV, START_FORWARDER, sandboxGateway, startGateway } from "./gateway.js";
import { internetLimits } from "./internetUsage.js";
import { secretMask } from "./secretMask.js";
import {
  ensureMountPoints, folderMount, platformFlags, runSandboxed, runsc, sandboxMemory, sandboxPlace, sandboxSpec, sharedScratch,
  shellAvailable, sweepSandboxes, toolsDir
} from "./gvisor.js";

const run = promisify(execFile);

// Bots' command line (D-47). A command is a bash script run in gVisor, which puts its own kernel
// between the script and the server's, rootless and with no network of its own: it reaches public
// internet addresses only through a gateway of its own (gateway.js, D-126), as the computer's
// browser does, within its internet limits (D-127). The script sees the toolbox
// (scripts/build-toolbox.sh; what it installs or changes
// there vanishes after the run), a private /tmp, the Craft apps, and only its place's folders: the
// chat's, the bot's and the home's (a private chat's last two read-only, D13). Limits: wall time,
// memory (each process, and the whole sandbox, watched from outside), processes, open files, file
// size and output.
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
  perServer: 2,
  // What one command may receive and send, a bot's new connections a minute and a home's internet a day (D-127): the
  // MERCBOT_INTERNET_* Env names set them (internetUsage.js).
  internet: internetLimits({}),
  // Apps' programs (D-146): at most this many at once per server (MERCBOT_APP_RUNS), one past them waiting up to
  // appWaitSeconds for a turn; what one may be given and bring back.
  appRuns: 4,
  appWaitSeconds: 30,
  program: Object.freeze({ files: 40, chars: 2000000, fileChars: 1000000, inputBytes: 160 * 1024 * 1024, bring: 5, bringBytes: 2 * 1024 * 1024, keep: 3, keepBytes: 25 * 1024 * 1024 })
};

// Where an app's program runs (D-146): its files' folder, the sandbox's working folder.
const WORK = "/work";
// A file's name in a program's folder: words, dots, dashes and folders, never "..", nor a name starting with a dot.
const PROGRAM_FILE = /^(?!.*(?:^|\/)\.)[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}(?:\/[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}){0,3}$/u;

/** A program's file name, or null when it isn't one. */
export function programFileName(name) {
  const text = String(name ?? "");
  return PROGRAM_FILE.test(text) ? text : null;
}

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

/** Where a sandbox starts: the chat's folder, else the bot's, else the home's. */
const homeFolder = (dirs) => (dirs.chat ? CHAT : dirs.bot ? BOT : SHARED);

// A command's way to the internet (D-126): the gateway's proxy, which Node's own fetch and http follow only when told
// to; installs for the command in its HOME, /tmp/home/.local, which goes with it (npm install -g there, since the
// toolbox's own is read-only on a store host; pip install there when the system's isn't writable), with pip quiet about
// running as root, which a sandbox's command always is, so a bot isn't told to follow advice for a system's
// administrator; and a plain answer where git would start ssh, which the command line doesn't have, for a
// repository's git@host:owner/name address.
const NO_SSH = "echo \"There's no ssh on this command line: use the repository's https:// address " +
  "(git clone https://github.com/OWNER/REPO.git).\" >&2; exit 128; :";
const INSTALLED = "/tmp/home/.local";
const INTERNET_ENV = Object.freeze([
  ...PROXY_ENV, "NODE_USE_ENV_PROXY=1", `NPM_CONFIG_PREFIX=${INSTALLED}`, "PIP_BREAK_SYSTEM_PACKAGES=1", "PIP_ROOT_USER_ACTION=ignore",
  `GIT_SSH_COMMAND=${NO_SSH}`
]);

// A sandbox with a gateway starts its forwarder first, then runs the script ($1) as a bash of its own, so the
// script's `wait` and `jobs` see only what it started. The forwarder goes with the sandbox.
const WITH_GATEWAY = `${START_FORWARDER}
/bin/bash -c "$1"`;

/**
 * The OCI bundle for one run, or for a computer's command-line session (`term`, `label`). `gateway` is the folder of
 * its own gateway on this server (sandboxGateway, D-126), which a command and a session have: it is the sandbox's
 * /gateway, its forwarder starts before the script, and its environment leads to it. `args`, `cwd`, `env` (replacing
 * variables of the same name) and `mounts` ({source, destination, readonly, exec}) are for other programs run in the
 * same sandbox, such as the office apps, which have no gateway. `runtimeEnv` is the server's env, for the tools folder
 * and the sandbox user. `readOnly` names folders ("chat", "bot", "shared") mounted read-only besides those the place
 * itself only reads (`dirs.readOnly`).
 */
function bundle({
  runtimeEnv,
  dirs, script, limits, readOnly = [], term = "dumb", label = "", gateway = "",
  args = gateway ? ["/bin/bash", "-c", WITH_GATEWAY, "command", script] : ["/bin/bash", "-c", script],
  cwd = homeFolder(dirs), env = [], mounts = [], rootReadOnly = false
}) {
  const apps = path.join(toolsDir(runtimeEnv), "apps");
  const reads = (name) => readOnly.includes(name) || (dirs.readOnly ?? []).includes(name);
  return sandboxSpec({
    runtimeEnv,
    args,
    cwd,
    env: [
      `PATH=${["/usr/local/bin", "/usr/bin", "/bin", ...craftPaths(runtimeEnv), ...(gateway ? [`${INSTALLED}/bin`] : [])].join(":")}`,
      "HOME=/tmp/home", "TMPDIR=/tmp", "LANG=C.UTF-8", "LC_ALL=C.UTF-8", "MPLBACKEND=Agg", "PYTHONDONTWRITEBYTECODE=1", `TERM=${term}`,
      ...(label ? [`BOT_LABEL=${label}`] : []),
      ...(gateway ? INTERNET_ENV : [])
    ].filter((entry) => !env.some((other) => other.split("=")[0] === entry.split("=")[0])).concat(env),
    limits,
    rootReadOnly,
    mounts: [
      ...(dirs.chat ? [folderMount(dirs.chat, CHAT, { readonly: reads("chat") })] : []),
      ...(dirs.bot ? [folderMount(dirs.bot, BOT, { readonly: reads("bot") })] : []),
      // An app's program (D-146) has no place: none of the home's folders.
      ...(dirs.shared ? [folderMount(dirs.shared, SHARED, { readonly: reads("shared") })] : []),
      // The records' Database files, to read and copy from, never to change (D-130).
      ...(dirs.db ? [folderMount(dirs.db, DB, { readonly: true })] : []),
      // The bot's whole command outputs in its chat, to read with grep, tail and the like (D-48).
      ...(dirs.runs ? [folderMount(dirs.runs, "/runs", { readonly: true })] : []),
      ...(existsSync(apps) ? [folderMount(apps, "/opt/apps", { readonly: true, exec: true })] : []),
      ...(gateway ? [folderMount(gateway, GATEWAY_INSIDE)] : []),
      ...mounts.map((mount) => folderMount(mount.source, mount.destination, { readonly: mount.readonly, exec: mount.exec }))
    ]
  });
}

/**
 * A command's output with its gateway's notes after it (D-127): what the gateway refused or ended and why, so the bot
 * reads it and the person sees it with the output.
 * @param {string} text
 * @param {string[]} notes
 */
function withNotes(text, notes) {
  return notes.length ? [text.replace(/\s+$/u, ""), notes.join("\n")].filter(Boolean).join("\n\n") : text;
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
 * One command in gVisor, with a gateway of its own (`gateway` starts it, with the command's internet limits and the
 * `meter` of its bot and home, D-127) that closes when it ends. `secret` is what a command signed in to GitHub has
 * (D-128): `env`, its variables, and `hide`, what never shows in its output. Returns { done, kill, output }: `done`
 * resolves to { exitCode, output, truncated, seconds, killed } and never rejects; the output ends with the gateway's
 * notes.
 */
function execute({ env, dirs, script, maxSeconds, limits, readOnly, gateway: startOne, meter, secret = null }) {
  const output = outputBuffer(limits);
  const mask = secretMask(secret?.hide || []);
  const place = sandboxPlace();
  let notes = [];
  const started = (async () => {
    const gatewayDir = path.join(place.dir, "gateway");
    const gateway = await sandboxGateway(gatewayDir, startOne, { limits: limits.internet, meter }).catch(async (error) => {
      await fs.rm(place.dir, { recursive: true, force: true }).catch(() => {});
      throw error;
    });
    try {
      const job = await runSandboxed({
        env,
        place,
        spec: bundle({ runtimeEnv: env, dirs, script, limits, readOnly, gateway: gatewayDir, env: secret?.env || [] }),
        flags: ["--host-uds=open"],
        maxSeconds,
        memory: limits.sandboxMemory,
        onOutput: (text) => output.add(mask.add(text))
      });
      return {
        ...job,
        done: job.done.finally(() => {
          notes = gateway.notes();
          return gateway.close().catch(() => {});
        })
      };
    } catch (error) {
      await gateway.close().catch(() => {});
      throw error;
    }
  })();
  const done = started
    .then(({ done: ended }) => ended, (error) => {
      output.add(mask.add(`\n${error.message}`));
      return { exitCode: 127, seconds: 0, killed: null };
    })
    .then((result) => {
      output.add(mask.flush());
      return {
        ...result,
        output: withNotes(output.text, notes),
        truncated: output.truncated,
        full: output.full === null ? null : withNotes(output.full, notes)
      };
    });
  return { done, kill: (reason) => started.then((job) => job.kill(reason), () => {}), output };
}

/**
 * An app's program (D-146) in gVisor: `command` in /work, the run's folder `work`, with each of `readOnly` (its name in
 * /work and the server's file) mounted over its place there, read-only. No network unless `internet`, then a gateway of
 * its own as a command's (D-126, D-127). Resolves to { exitCode, output, seconds, killed }, its output cut as a
 * command's is; `kill` stops it.
 */
function executeProgram({ env, work, readOnly, command, maxSeconds, limits, internet, gateway: startOne, meter }) {
  const output = outputBuffer(limits);
  const place = sandboxPlace("program");
  let notes = [];
  const started = (async () => {
    const gatewayDir = internet ? path.join(place.dir, "gateway") : "";
    const gateway = internet ? await sandboxGateway(gatewayDir, startOne, { limits: limits.internet, meter }) : null;
    try {
      const job = await runSandboxed({
        env,
        place,
        spec: bundle({
          runtimeEnv: env, dirs: {}, script: command, limits, gateway: gatewayDir, cwd: WORK,
          mounts: [
            { source: work, destination: WORK },
            ...readOnly.map((file) => ({ source: file.source, destination: `${WORK}/${file.name}`, readonly: true }))
          ]
        }),
        flags: internet ? ["--host-uds=open"] : [],
        maxSeconds,
        memory: limits.sandboxMemory,
        onOutput: (text) => output.add(text)
      });
      return {
        ...job,
        done: job.done.finally(() => {
          if (!gateway) return null;
          notes = gateway.notes();
          return gateway.close().catch(() => {});
        })
      };
    } catch (error) {
      await gateway?.close().catch(() => {});
      await fs.rm(place.dir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  })();
  const done = started
    .then(({ done: ended }) => ended, (error) => {
      output.add(`\n${error.message}`);
      return { exitCode: 127, seconds: 0, killed: null };
    })
    .then((result) => ({ ...result, output: withNotes(output.text, notes) }));
  return { done, kill: (reason) => started.then((job) => job.kill(reason), () => {}) };
}

/** A refusal of an app's program (D-146), with what kind it is: unavailable, busy, refused (the meter) or invalid. */
const programRefusal = (kind, message) => Object.assign(new Error(message), { programRefusal: kind });

/**
 * Another program in the bots' sandbox (D-49: everything runs in gVisor), with the place's
 * folders (`dirs`) and the same limits, for the office apps and voice memos. Its system is
 * read-only, so a save outside the folders and /tmp fails instead of vanishing. Returns
 * { command, args } to run, with its stdin and stdout, and stop() to call once it has ended.
 */
export async function gvisorProcess({ runtimeEnv, dirs, args, cwd, env, mounts, readOnly }) {
  await sweepSandboxes(runtimeEnv);
  const { id, dir: runDir, state } = sandboxPlace("app");
  const spec = bundle({ runtimeEnv, dirs, args, cwd, env, mounts, readOnly, limits: LIMITS, rootReadOnly: true });
  await ensureMountPoints(spec, () => fs.rm(runDir, { recursive: true, force: true }));
  await fs.mkdir(state, { recursive: true });
  await fs.writeFile(path.join(runDir, "config.json"), JSON.stringify(spec));
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
// The sandbox's own process only keeps it up (after its gateway's forwarder starts); its tmux is SESSION_TMUX, which
// attach runs in it and waits for, so a session attach answers has its tmux already.
const SESSION = "exec sleep infinity";
const SESSION_TMUX = `mkdir -p /tmp/home; touch /tmp/bot.log
tmux -f /dev/null new-session -d -s main -x 160 -y 48 "tail -n 400 -F /tmp/bot.log 2>/dev/null"
${TMUX_LOOK}
tmux select-pane -t main.0 -T "$BOT_LABEL"
tmux split-window -v -t main -l 55% -c "$PWD" "while true; do bash -l; done"
tmux select-pane -t main.1 -T "Your shell"`;

// The command itself, cut off at its time limit with everything it started; at most 1 MB of its
// output goes in the log, and the pipeline waits for that copy, so what follows in the log comes after it.
const LOGGED_RUN = '{ setsid bash -c "$s" < /dev/null 2>&1 & p=$!; ( exec > /dev/null 2>&1; sleep "$t"; kill -KILL -- -"$p" ) & k=$!;' +
  ' wait "$p"; c=$?; kill "$k" 2>/dev/null; exit "$c"; } | { tee -p >(head -c 1048576 >> /tmp/bot.log); wait $!; }';

// A bot's command inside a session: shown in the session's log as it runs, cut off at its time
// limit with everything it started, and its exit code returned. The log stays small: it starts
// again once past 1 MB, and takes at most 1 MB of one command (the bot still gets all of it).
const IN_SESSION = `w="$1"; t="$2"; s="$3"
[ "$(stat -c %s /tmp/bot.log 2>/dev/null || echo 0)" -lt 1048576 ] || : > /tmp/bot.log
printf '\\n\\033[1;36m$ %s\\033[0m\\n' "$w" >> /tmp/bot.log
${LOGGED_RUN}
c="\${PIPESTATUS[0]}"
printf '\\033[2m(exit %s)\\033[0m\\n' "$c" >> /tmp/bot.log
exit "$c"`;

/**
 * One command in a computer's session, whose gateway it shares with the person's shell there: the gateway's count and
 * notes start again for it, and again once it ends (D-127), and its output ends with the notes.
 */
function executeIn(session, { env, script, why, maxSeconds, limits }) {
  const output = outputBuffer(limits);
  const started = Date.now();
  session.gateway.begin();
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
      const notes = session.gateway.notes();
      session.gateway.begin();
      resolve({
        exitCode,
        output: withNotes(output.text, notes),
        truncated: output.truncated,
        full: output.full === null ? null : withNotes(output.full, notes),
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
  return `A command is still running in the background in this chat (run ${runId}). ` +
    "Use check_command to follow it, or wait for it to finish.";
}

/** What a command still running after its foreground time tells the bot. */
function backgroundNote(foregroundSeconds, maxSeconds) {
  return `Still running after ${foregroundSeconds} s, so it carries on in the background (up to ${Math.round(maxSeconds / 60)} minutes). ` +
    "You'll be woken in this chat when it ends; check_command shows its progress.";
}

/**
 * The bots' command line (D-21, D-49): runs in gVisor sandboxes on a chat's folders, one after
 * another per bot in a chat (its chat_bots id), with the shell_runs rows any server can read.
 * @param {object} dependencies
 * @param {import("./types.js").FileStore} dependencies.store
 * @param {import("./types.js").ShellRuns} dependencies.runs the shell_runs rows
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 * @param {typeof LIMITS} [dependencies.limits]
 * @param {string} [dependencies.server]
 * @param {Pick<import("@local/account/server/types").Meter, "startComputation">} dependencies.meter each command's
 *   computation is recorded through it a block at a time (D-73)
 * @param {Pick<import("./types.js").MediaChecks, "on" | "filesLater">} [dependencies.media] every file a command changes is
 *   checked through, with a copy that checks pictures and videos (D-90)
 * @param {typeof startGateway} [dependencies.gateway] how each command's and each session's gateway starts (D-126; tests:
 *   one with stand-ins for public addresses)
 * @param {ReturnType<typeof import("./internetUsage.js").createInternetUsage>} dependencies.internet the bots' and
 *   homes' internet use, which each gateway's meter counts in and is limited by (D-127), with its limits
 */
export function createShell({
  store,
  runs,
  env,
  meter,
  media = { on: false, filesLater: async () => {} },
  gateway = startGateway,
  internet,
  limits = {
    ...LIMITS,
    perServer: Number(env.MERCBOT_SHELL_RUNS) || LIMITS.perServer,
    appRuns: Number(env.MERCBOT_APP_RUNS) || LIMITS.appRuns,
    internet: internet.limits
  },
  server = `${os.hostname()}:${process.pid}`
}) {
  const endHandlers = new Set();
  const sessions = new Map();
  const live = new Map();
  // A bot's commands in a chat run one after another: one fired while another runs waits for it,
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
    const { chat = [], bot = [], shared = [] } = await store.list(place).catch(() => ({}));
    return [...chat, ...bot, ...shared]
      .filter((file) => Date.parse(file.modified) >= since - 10)
      .map((file) => file.path)
      .slice(0, limits.changed);
  }

  async function ended(row) {
    for (const handler of endHandlers) await Promise.resolve(handler(row)).catch((error) => console.warn("A command-run end handler failed; the others still run.", error));
  }

  /**
   * Runs `script` for a bot in a chat (`chatBotId`, its chat_bots id) on its place's folders. Waits up to
   * `foregroundSeconds`; a run still going after that carries on in the background and returns { status: "running",
   * run }. `readOnly` lists more folders the script may only read ("chat", "bot", "shared") than its place does.
   * `secret` signs the command in to GitHub (D-128): `env`, its variables; `hide`, what never shows in its output;
   * and `ended`, which withdraws it once the command ends, however it ends. Such a command always runs in a fresh
   * sandbox, never in the computer's session, where the Terminal shows what runs and the key would outlive it.
   */
  async function start({
    place, workspaceId, botId, chatBotId, userId = null, why = "", script, readOnly = [],
    foregroundSeconds = limits.foregroundSeconds, maxSeconds = limits.maxSeconds, secret = null
  }) {
    // A key is withdrawn once its command has ended, or straight away when no command starts.
    const withdraw = async () => {
      if (!secret) return;
      try {
        await secret.ended();
      } catch (error) {
        console.warn(`Withdrawing a command's GitHub key failed: ${error?.message}`);
      }
    };
    const refused = async (answer) => {
      await withdraw();
      return answer;
    };
    if (stopping) return refused({ status: "unavailable", error: "This server is shutting down; try again in a moment." });
    if (!shellAvailable(env)) return refused({ status: "unavailable", error: "The command line isn't installed on this server." });
    if (chatBotId == null || !/^\d+$/u.test(String(chatBotId))) {
      await withdraw();
      throw new Error("A command runs for a bot in a chat: chatBotId is needed.");
    }
    const key = String(chatBotId);
    while (busy.has(key)) {
      const current = busy.get(key);
      if (current.background) return refused({ status: "busy", error: busyMessage(current.run) });
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
      dirs = { ...dirs, runs: await store.runsFolder(key) };
      row = await runs.begin(workspaceId, { chatBotId: key, userId, why: String(why).slice(0, 300), script, server });
    } catch (error) {
      busy.delete(key);
      settle();
      await hold?.settle(0).catch(() => {});
      await withdraw();
      const refusal = refusalOf(error);
      if (refusal) return { status: "unavailable", error: refusal.message };
      throw error;
    }
    mine.run = String(row.id);
    const startedAt = Date.now();
    await slot();
    // While the bot's computer in the chat is awake its commands run in its session, where the
    // Terminal shows them; one with more read-only folders, or signed in to GitHub (D-128), keeps to a fresh sandbox.
    const session = !readOnly.length && !secret ? sessions.get(key) : null;
    const job = session
      ? executeIn(session, { env, script, why, maxSeconds, limits })
      : execute({ env, dirs, script, maxSeconds, limits, readOnly, gateway, meter: internet.forGateway({ workspaceId, botId }), secret });
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
      await withdraw();
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
      // With a copy that checks pictures and videos (D-90), every file it changed, however many: `changed` names the
      // newest 50.
      let everyChange = [];
      if (media.on) {
        everyChange = await store.changedSince(place, startedAt - 10).catch((error) => {
          console.warn(`Reading what run ${row.id} changed, for its check, failed: ${error?.message}`);
          return [];
        });
      }
      // The whole output, when the shown one was cut, written once as /runs/<run>.log (D-48).
      if (result.full !== null && dirs.runs) {
        await fs.writeFile(path.join(dirs.runs, `${row.id}.log`), result.full)
          .catch((error) => console.error(`Keeping run ${row.id}'s output: ${error.message}`));
      }
      // What it wrote reaches where the home's files are kept before its turn goes on (D-91), and its output too.
      await store.settle(place.homeId).catch((error) => console.warn(`Sending run ${row.id}'s files on failed: ${error?.message}`));
      await store.settleRuns(key);
      const status = ["shutdown", "paused"].includes(result.killed) ? "stopped" : result.exitCode === 0 ? "done" : "failed";
      const saved = await runs.finish(row, { status, exitCode: result.exitCode, output: result.output, changed });
      return { result, status, changed, saved, everyChange };
    });
    live.set(String(row.id), { job, finished });
    const checkLater = (paths) => {
      if (!paths.length) return;
      media.filesLater({ place, paths, workspaceId, userId, chatBotId: key })
        .catch((error) => console.warn(`Queueing run ${row.id}'s changed files for a check failed: ${error?.message}`));
    };
    // The wait's timer is cleared once the run finishes, so it doesn't hold the process for its whole length.
    let wait;
    const inTime = await Promise.race([
      finished,
      new Promise((resolve) => (wait = setTimeout(() => resolve(null), foregroundSeconds * 1000)))
    ]);
    clearTimeout(wait);
    if (inTime) {
      // As its record says: stopped when this server stopped it or its home's work was paused.
      const { result, status, changed, everyChange } = inTime;
      // Its turn queues the files it's told the run changed (D-90); the run queues the rest.
      const told = new Set(changed);
      checkLater(everyChange.filter((file) => !told.has(file)));
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
    finished.then(({ saved, everyChange }) => {
      // Its turn has ended, so it queues every file it changed itself (D-90).
      checkLater(everyChange);
      return saved && ended(saved);
    }, () => {});
    return { status: "running", run: String(row.id), note: backgroundNote(foregroundSeconds, maxSeconds) };
  }

  // Apps' programs (D-146) take turns among themselves, apart from the bots' commands, so a model training for minutes
  // never holds up a bot's command, nor a bot's long command a button.
  let programsActive = 0;
  const programsWaiting = [];
  function programSlot() {
    if (programsActive < limits.appRuns) {
      programsActive += 1;
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const entry = { resolve, timer: null };
      entry.timer = setTimeout(() => {
        programsWaiting.splice(programsWaiting.indexOf(entry), 1);
        resolve(false);
      }, limits.appWaitSeconds * 1000);
      entry.timer.unref?.();
      programsWaiting.push(entry);
    });
  }
  function programRelease() {
    const next = programsWaiting.shift();
    if (!next) {
      programsActive -= 1;
      return;
    }
    clearTimeout(next.timer);
    next.resolve(true);
  }

  /** A program's files checked: { name: text } by name, within the limits; `what` names them in a refusal. */
  function checkedFiles(given, what) {
    const entries = Object.entries(given && typeof given === "object" && !Array.isArray(given) ? given : {});
    for (const [name, text] of entries) {
      if (!programFileName(name)) throw programRefusal("invalid", `"${name}" isn't a file name a program can have: letters, digits, _ . - and up to 3 folders, like "tests/check.py"`);
      if (typeof text !== "string") throw programRefusal("invalid", `${what} ${name} isn't text`);
      if (text.length > limits.program.fileChars) throw programRefusal("invalid", `${what} ${name} is over ${limits.program.fileChars} characters`);
    }
    return entries;
  }

  /** A file the program left in its folder, by name: its path, never a link out of the folder, or null. */
  async function leftFile(work, name) {
    const file = path.join(work, name);
    const found = await fs.lstat(file).catch(() => null);
    if (!found?.isFile()) return null;
    const [real, folder] = await Promise.all([fs.realpath(file), fs.realpath(work)]);
    return real.startsWith(`${folder}${path.sep}`) ? { path: real, size: found.size } : null;
  }

  /**
   * An app's program (D-146) on the computer of the app's bot, `botId` in home `workspaceId`, for `userId`: `command`
   * (bash) run in /work, a fresh gVisor sandbox with the bots' commands' limits, its computation recorded through the
   * meter as a command's (D-73), with no network unless `internet` (then the bot's gateway, D-126, D-127). /work holds
   * `files` ({ name: text }, the script's), `inputs` ([{ name, source }], files of the server's copied in, such as a
   * record's) and, read-only over their place there, `readOnlyFiles` ({ name: text }, the app's own). Afterwards it reads
   * back `bring` (names: text files, small) and hands each file of `keep` ({ name: async (path, size) => answer }) to its
   * handler before its folder goes. Answers { exitCode, output, seconds, timedOut, stopped?, files, kept }. Refuses,
   * throwing an error with `programRefusal` ("unavailable", "busy", "refused" or "invalid"), without the sandbox, when
   * the meter won't have it, with no turn within appWaitSeconds, or what it was given isn't right.
   */
  async function runProgram({
    workspaceId, botId, userId = null, command, files = {}, readOnlyFiles = {}, inputs = [], seconds = 10, internet: online = false,
    bring = [], keep = {}
  }) {
    if (stopping) throw programRefusal("unavailable", "This server is shutting down; try again in a moment.");
    if (!shellAvailable(env)) throw programRefusal("unavailable", "This server has no computer to run programs on: gVisor and its toolbox aren't installed here.");
    const script = String(command ?? "").trim();
    if (!script || script.length > 4000) throw programRefusal("invalid", "command is the command line to run, 1 to 4,000 characters, such as \"python3 main.py\"");
    const own = checkedFiles(files, "file");
    const app = checkedFiles(readOnlyFiles, "the app's file");
    const given = [...own.map(([name]) => name), ...inputs.map((input) => input.name)];
    for (const name of inputs.map((input) => input.name)) {
      if (!programFileName(name)) throw programRefusal("invalid", `"${name}" isn't a file name a program can have`);
    }
    const clash = given.find((name) => app.some(([appName]) => appName === name));
    if (clash) throw programRefusal("invalid", `${clash} is one of the app's own files, which a run can't replace: give yours another name`);
    if (new Set(given).size !== given.length) throw programRefusal("invalid", "two of the files have the same name");
    if (given.length + app.length > limits.program.files) throw programRefusal("invalid", `at most ${limits.program.files} files a run`);
    if ([...own, ...app].reduce((sum, [, text]) => sum + text.length, 0) > limits.program.chars) {
      throw programRefusal("invalid", `the files are over ${limits.program.chars} characters in all`);
    }
    const sizes = await Promise.all(inputs.map((input) => fs.stat(input.source).then((found) => found.size)));
    if (sizes.reduce((sum, size) => sum + size, 0) > limits.program.inputBytes) throw programRefusal("invalid", `the records' files are over ${limits.program.inputBytes / 1024 / 1024} MB in all`);
    const wanted = [...new Set((Array.isArray(bring) ? bring : []).map(String))];
    const keeping = Object.entries(keep || {});
    if (wanted.length > limits.program.bring || !wanted.every(programFileName)) throw programRefusal("invalid", `bring names at most ${limits.program.bring} files the program writes, like "out.json"`);
    if (keeping.length > limits.program.keep || !keeping.every(([name]) => programFileName(name))) throw programRefusal("invalid", `keep names at most ${limits.program.keep} files the program writes`);
    const maxSeconds = Math.min(Math.max(Number(seconds) || 10, 1), limits.maxSeconds);
    let hold;
    try {
      hold = await meter.startComputation({ workspaceId, botId, ...(userId ? { userId } : {}) });
    } catch (error) {
      const refusal = refusalOf(error);
      if (refusal) throw programRefusal("refused", refusal.message);
      throw error;
    }
    if (!(await programSlot())) {
      await hold.settle(0).catch(() => {});
      throw programRefusal("busy", "The computer is busy with other apps' programs; try again in a moment.");
    }
    let settled = false;
    let folder = null;
    try {
      folder = await sharedScratch(env, "mercbot-program-");
      const work = path.join(folder, "work");
      const appFolder = path.join(folder, "app");
      const write = async (root, name, text) => {
        await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true, mode: 0o2775 });
        await fs.writeFile(path.join(root, name), text, { mode: 0o664 });
      };
      await fs.mkdir(work, { mode: 0o2775 });
      for (const [name, text] of own) await write(work, name, text);
      for (const input of inputs) {
        await fs.mkdir(path.dirname(path.join(work, input.name)), { recursive: true, mode: 0o2775 });
        await fs.copyFile(input.source, path.join(work, input.name));
      }
      // The app's own files sit in their place in /work, each a read-only mount over an empty file there.
      for (const [name, text] of app) {
        await write(appFolder, name, text);
        await write(work, name, "");
      }
      const startedAt = Date.now();
      const job = executeProgram({
        env, work, command: script, maxSeconds, limits, internet: Boolean(online), gateway,
        readOnly: app.map(([name]) => ({ name, source: path.join(appFolder, name) })),
        meter: online ? internet.forGateway({ workspaceId, botId }) : null
      });
      // Before its block runs out the next is opened; when that's refused, it stops (D-73).
      let heldUntil = startedAt + hold.blockSeconds * 1000;
      const heartbeat = setInterval(() => {
        if (Date.now() < heldUntil - 2 * limits.heartbeatSeconds * 1000) return;
        heldUntil = Infinity;
        hold.renew().then((renewed) => (renewed ? (heldUntil = Date.now() + hold.blockSeconds * 1000) : job.kill("paused")), () => job.kill("paused"));
      }, limits.heartbeatSeconds * 1000);
      heartbeat.unref();
      const result = await job.done.finally(() => clearInterval(heartbeat));
      settled = true;
      hold.settle(result.seconds).catch((error) => console.warn("Recording a program's computation failed.", error));
      const back = {};
      let brought = 0;
      for (const name of wanted) {
        const file = await leftFile(work, name);
        if (file && (brought += file.size) > limits.program.bringBytes) {
          throw programRefusal("invalid", `the files to bring back are over ${limits.program.bringBytes / 1024 / 1024} MB: keep a big one in a record's file instead`);
        }
        back[name] = file ? await fs.readFile(file.path, "utf8") : null;
      }
      const kept = {};
      for (const [name, handle] of keeping) {
        const file = await leftFile(work, name);
        if (file && file.size > limits.program.keepBytes) throw programRefusal("invalid", `${name} is over ${limits.program.keepBytes / 1024 / 1024} MB, too big to keep`);
        kept[name] = file ? await handle(file.path, file.size) : null;
      }
      return {
        exitCode: result.exitCode,
        output: result.output,
        seconds: result.seconds,
        timedOut: result.killed === "time",
        ...(result.killed ? { stopped: STOPPED[result.killed] || `It ran out of time (${maxSeconds} s).` } : {}),
        files: back,
        kept
      };
    } catch (error) {
      if (!settled) await hold.settle(0).catch(() => {});
      throw error;
    } finally {
      programRelease();
      if (folder) await fs.rm(folder, { recursive: true, force: true }).catch(() => {});
    }
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
    // Whole outputs can hold secrets, so they go after a week (D-48); looked for once an hour, with homes' old
    // internet days (D-127).
    if (Date.now() - lastOutputSweep > 3600 * 1000) {
      lastOutputSweep = Date.now();
      await removeOldOutputs().catch((error) => console.error(`Removing old command outputs: ${error.message}`));
      await internet.removeOld().catch((error) => console.error(`Removing old internet days: ${error.message}`));
    }
  }

  let lastOutputSweep = 0;
  async function removeOldOutputs({ now = Date.now() } = {}) {
    const oldest = now - limits.outputFullDays * 86400 * 1000;
    // Wherever they're kept: the files folder, or the files bucket (D-91).
    for (const output of await store.runOutputs()) {
      if (output.modified < oldest) await store.removeRunOutput(output.chatBotId, output.name);
    }
  }

  /** A run's whole output (/runs/<run>.log), when it was kept: of a run row, check()'s, or a commandOutput. */
  async function wholeOutputOf(row) {
    const chatBotId = row?.chatBotId ?? row?.chat_bot_id;
    if (!chatBotId) return null;
    const dir = await store.runsFolder(chatBotId).catch(() => null);
    return dir ? fs.readFile(path.join(dir, `${row.id}.log`), "utf8").catch(() => null) : null;
  }

  /**
   * The computer's session for a bot in a chat: started when its computer wakes, ended when it
   * sleeps. Its memory is watched like a run's; a session past the limit is ended.
   */
  async function attach({ key, place, label = "The bot's commands" }) {
    if (!shellAvailable(env)) return null;
    if (sessions.has(String(key))) return sessions.get(String(key));
    // The key is the computer's, the bot's chat_bots id: its whole outputs are at /runs, as in its runs.
    let dirs = await store.prepare(place);
    dirs = { ...dirs, runs: await store.runsFolder(key) };
    await sweepSandboxes(env);
    const { id, dir: runDir, state } = sandboxPlace("session");
    // Its gateway (D-126) serves the bot's commands in it and the person's shell, until the session ends, within the
    // commands' internet limits, counted for the bot and its home (D-127).
    const gatewayDir = path.join(runDir, "gateway");
    const sessionGateway = await sandboxGateway(gatewayDir, gateway, {
      limits: limits.internet,
      meter: internet.forGateway({ workspaceId: place.homeId, botId: place.botId })
    });
    const spec = bundle({ runtimeEnv: env, dirs, script: SESSION, limits, term: "xterm-256color", label, gateway: gatewayDir });
    // Refused, the session leaves nothing open: its gateway closes and its folder goes.
    await ensureMountPoints(spec, () => Promise.allSettled([sessionGateway.close(), fs.rm(runDir, { recursive: true, force: true })]));
    await fs.mkdir(state, { recursive: true });
    await fs.writeFile(path.join(runDir, "config.json"), JSON.stringify(spec));
    await new Promise((resolve) => {
      const child = spawn(...runsc(env, [
        "--rootless", "--network=none", "--ignore-cgroups", "--overlay2=root:memory", "--host-uds=open", ...platformFlags(env),
        "--root", state, "run", "--detach", "--bundle", runDir, id
      ]), { stdio: "ignore" });
      child.on("error", resolve);
      child.on("close", resolve);
    });
    const session = {
      key: String(key), id, state, runDir, cwd: homeFolder(dirs), running: 0, asleep: false, gateway: sessionGateway
    };
    // Its tmux, before the session is anyone's: the bot's commands and the Terminal find "main" from the start. tmux's
    // server stays once this ends. A session whose tmux didn't start ends, and the computer goes on without it.
    try {
      await run(...runsc(env, ["--root", state, "exec", "--cwd", session.cwd, id, "/bin/bash", "-c", SESSION_TMUX]), { timeout: 30000 });
    } catch (error) {
      await end(session);
      throw error;
    }
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
    await session.gateway.close().catch(() => {});
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
    runProgram,
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
export const __testables = Object.freeze({ LIMITS, IN_SESSION });
