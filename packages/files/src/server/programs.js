import fs from "node:fs/promises";
import path from "node:path";
import { refusalOf } from "@local/account/meter";
import { sandboxGateway, startGateway } from "./gateway.js";
import { runSandboxed, sandboxPlace, sharedScratch, shellAvailable } from "./gvisor.js";
import { commandParts } from "./shell.js";

const { LIMITS: COMMAND_LIMITS, STOPPED, bundle, outputBuffer, withNotes } = commandParts;

// Apps' programs (D-146): a script's computer.run, a program in a fresh gVisor sandbox of the bots' command line, with a
// command's limits (memory, processes, files, output) but none of the home's folders: only its own folder, /work, with
// the app's own files read-only in it. No network unless the app asks for the internet, then a gateway of its own, as a
// command's (D-126, D-127). Its computation is recorded through the meter as a command's (D-73).
const LIMITS = Object.freeze({
  // At most this many at once per server (MERCBOT_APP_RUNS), one past them waiting up to waitSeconds for a turn.
  runs: 4,
  waitSeconds: 30,
  maxSeconds: 1800,
  heartbeatSeconds: 20,
  // What one may be given and bring back.
  files: 40,
  chars: 2000000,
  fileChars: 1000000,
  inputBytes: 160 * 1024 * 1024,
  bring: 5,
  bringBytes: 2 * 1024 * 1024,
  keep: 3,
  keepBytes: 25 * 1024 * 1024
});

// Where an app's program runs (D-146): its files' folder, the sandbox's working folder.
const WORK = "/work";
// A file's name in a program's folder: words, dots, dashes and folders, never "..", nor a name starting with a dot.
const PROGRAM_FILE = /^(?!.*(?:^|\/)\.)[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}(?:\/[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}){0,3}$/u;

/** A program's file name, or null when it isn't one. */
export function programFileName(name) {
  const text = String(name ?? "");
  return PROGRAM_FILE.test(text) ? text : null;
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
          runtimeEnv: env,
          dirs: {},
          script: command,
          limits,
          gateway: gatewayDir,
          cwd: WORK,
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

/** A program's files checked: [[name, text]] of { name: text }, within the limits; `what` names them in a refusal. */
function checkedFiles(given, what) {
  const entries = Object.entries(given && typeof given === "object" && !Array.isArray(given) ? given : {});
  for (const [name, text] of entries) {
    if (!programFileName(name)) {
      throw programRefusal("invalid", `"${name}" isn't a file name a program can have: letters, digits, _ . - and up to 3 folders, like "tests/check.py"`);
    }
    if (typeof text !== "string") throw programRefusal("invalid", `${what} ${name} isn't text`);
    if (text.length > LIMITS.fileChars) throw programRefusal("invalid", `${what} ${name} is over ${LIMITS.fileChars} characters`);
  }
  return entries;
}

/** What a program is given, checked before anything starts: its files, the app's, the records' and what comes back. */
async function checkedRequest({ command, files, readOnlyFiles, inputs, bring, keep, seconds }) {
  const script = String(command ?? "").trim();
  if (!script || script.length > 4000) throw programRefusal("invalid", "command is the command line to run, 1 to 4,000 characters, such as \"python3 main.py\"");
  const own = checkedFiles(files, "file");
  const app = checkedFiles(readOnlyFiles, "the app's file");
  for (const { name } of inputs) if (!programFileName(name)) throw programRefusal("invalid", `"${name}" isn't a file name a program can have`);
  const given = [...own.map(([name]) => name), ...inputs.map((input) => input.name)];
  const clash = given.find((name) => app.some(([appName]) => appName === name));
  if (clash) throw programRefusal("invalid", `${clash} is one of the app's own files, which a run can't replace: give yours another name`);
  if (new Set(given).size !== given.length) throw programRefusal("invalid", "two of the files have the same name");
  if (given.length + app.length > LIMITS.files) throw programRefusal("invalid", `at most ${LIMITS.files} files a run`);
  if ([...own, ...app].reduce((sum, [, text]) => sum + text.length, 0) > LIMITS.chars) throw programRefusal("invalid", `the files are over ${LIMITS.chars} characters in all`);
  const sizes = await Promise.all(inputs.map((input) => fs.stat(input.source).then((found) => found.size)));
  if (sizes.reduce((sum, size) => sum + size, 0) > LIMITS.inputBytes) throw programRefusal("invalid", `the records' files are over ${LIMITS.inputBytes / 1024 / 1024} MB in all`);
  const wanted = [...new Set((Array.isArray(bring) ? bring : []).map(String))];
  const keeping = Object.entries(keep);
  if (wanted.length > LIMITS.bring || !wanted.every(programFileName)) throw programRefusal("invalid", `bring names at most ${LIMITS.bring} files the program writes, like "out.json"`);
  if (keeping.length > LIMITS.keep || !keeping.every(([name]) => programFileName(name))) throw programRefusal("invalid", `keep names at most ${LIMITS.keep} files the program writes`);
  return { script, own, app, wanted, keeping, maxSeconds: Math.min(Math.max(Number(seconds) || 10, 1), LIMITS.maxSeconds) };
}

/** The program's folder: /work with its files and the records' copied in, and the app's own files beside it in `app`. */
async function writeFolder(folder, { own, app, inputs }) {
  const work = path.join(folder, "work");
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
    await write(path.join(folder, "app"), name, text);
    await write(work, name, "");
  }
  return { work, readOnly: app.map(([name]) => ({ name, source: path.join(folder, "app", name) })) };
}

/** A file the program left in its folder, by name: its path, never a link out of the folder, or null. */
async function leftFile(work, name) {
  const file = path.join(work, name);
  const found = await fs.lstat(file).catch(() => null);
  if (!found?.isFile()) return null;
  const [real, folder] = await Promise.all([fs.realpath(file), fs.realpath(work)]);
  return real.startsWith(`${folder}${path.sep}`) ? { path: real, size: found.size } : null;
}

/** What the program brings back ({ name: text or null }) and what its `keep` handlers made of the files they keep. */
async function readBack(work, wanted, keeping) {
  const files = {};
  let brought = 0;
  for (const name of wanted) {
    const file = await leftFile(work, name);
    if (file && (brought += file.size) > LIMITS.bringBytes) {
      throw programRefusal("invalid", `the files to bring back are over ${LIMITS.bringBytes / 1024 / 1024} MB: keep a big one in a record's file instead`);
    }
    files[name] = file ? await fs.readFile(file.path, "utf8") : null;
  }
  const kept = {};
  for (const [name, handle] of keeping) {
    const file = await leftFile(work, name);
    if (file && file.size > LIMITS.keepBytes) throw programRefusal("invalid", `${name} is over ${LIMITS.keepBytes / 1024 / 1024} MB, too big to keep`);
    kept[name] = file ? await handle(file.path, file.size) : null;
  }
  return { files, kept };
}

/**
 * Apps' programs on this server (D-146): `run` one, `available()` whether this server has the sandbox, and `drain()` on
 * shutdown, which stops those running.
 * @param {object} dependencies
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 * @param {Pick<import("@local/account/server/types").Meter, "startComputation">} dependencies.meter
 * @param {import("./types.js").InternetUsage} dependencies.internet the gateway's meter
 *   and limits, for a program allowed the internet
 * @param {typeof startGateway} [dependencies.gateway]
 */
export function createPrograms({ env, meter, internet, gateway = startGateway }) {
  const limits = { ...COMMAND_LIMITS, internet: internet.limits };
  const most = Number(env.MERCBOT_APP_RUNS) || LIMITS.runs;
  const live = new Set();
  let stopping = false;
  // Programs take turns among themselves, apart from the bots' commands, so a model training for minutes never holds up
  // a bot's command, nor a bot's long command a button.
  let active = 0;
  const waiting = [];
  function turn() {
    if (active < most) {
      active += 1;
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const entry = { resolve, timer: null };
      entry.timer = setTimeout(() => {
        waiting.splice(waiting.indexOf(entry), 1);
        resolve(false);
      }, LIMITS.waitSeconds * 1000);
      entry.timer.unref();
      waiting.push(entry);
    });
  }
  function done() {
    const next = waiting.shift();
    if (!next) {
      active -= 1;
      return;
    }
    clearTimeout(next.timer);
    next.resolve(true);
  }

  /** The meter's first block, or the refusal the script sees. */
  async function startComputation(workspaceId, botId, userId) {
    try {
      return await meter.startComputation({ workspaceId, botId, ...(userId ? { userId } : {}) });
    } catch (error) {
      const refusal = refusalOf(error);
      if (refusal) throw programRefusal("refused", refusal.message);
      throw error;
    }
  }

  /** Runs the sandbox, renewing the meter's block before it runs out; stopped when that's refused (D-73). */
  async function execute(hold, request) {
    const job = executeProgram({ env, limits, gateway, ...request });
    live.add(job);
    let heldUntil = Date.now() + hold.blockSeconds * 1000;
    const heartbeat = setInterval(() => {
      if (Date.now() < heldUntil - 2 * LIMITS.heartbeatSeconds * 1000) return;
      heldUntil = Infinity;
      hold.renew().then((renewed) => (renewed ? (heldUntil = Date.now() + hold.blockSeconds * 1000) : job.kill("paused")), () => job.kill("paused"));
    }, LIMITS.heartbeatSeconds * 1000);
    heartbeat.unref();
    try {
      return await job.done;
    } finally {
      clearInterval(heartbeat);
      live.delete(job);
    }
  }

  /**
   * An app's program on the computer of the app's bot, `botId` in home `workspaceId`, for `userId`: `command` (bash)
   * run in /work, which holds `files` ({ name: text }, the script's), `inputs` ([{ name, source }], files of the server's
   * copied in, such as a record's) and, read-only over their place there, `readOnlyFiles` ({ name: text }, the app's
   * own). No network unless `internet`. Afterwards it reads back `bring` (names: text files, small) and hands each file
   * of `keep` ({ name: async (path, size) => answer }) to its handler before its folder goes. Answers { exitCode,
   * output, seconds, timedOut, stopped?, files, kept }. Refuses, throwing an error with `programRefusal`
   * ("unavailable", "busy", "refused" or "invalid"), without the sandbox, when the meter won't have it, with no turn
   * within waitSeconds, or when what it was given isn't right.
   */
  async function run({
    workspaceId, botId, userId = null, command, files = {}, readOnlyFiles = {}, inputs = [], seconds = 10,
    internet: reachesInternet = false, bring = [], keep = {}
  }) {
    if (stopping) throw programRefusal("unavailable", "This server is shutting down; try again in a moment.");
    if (!shellAvailable(env)) throw programRefusal("unavailable", "This server has no computer to run programs on: gVisor and its toolbox aren't installed here.");
    const checked = await checkedRequest({ command, files, readOnlyFiles, inputs, bring, keep, seconds });
    const hold = await startComputation(workspaceId, botId, userId);
    if (!(await turn())) {
      await hold.settle(0).catch(() => {});
      throw programRefusal("busy", "The computer is busy with other apps' programs; try again in a moment.");
    }
    let settled = false;
    let folder = null;
    try {
      folder = await sharedScratch(env, "mercbot-program-");
      const { work, readOnly } = await writeFolder(folder, { own: checked.own, app: checked.app, inputs });
      const result = await execute(hold, {
        work,
        readOnly,
        command: checked.script,
        maxSeconds: checked.maxSeconds,
        internet: Boolean(reachesInternet),
        meter: reachesInternet ? internet.forGateway({ workspaceId, botId }) : null
      });
      settled = true;
      hold.settle(result.seconds).catch((error) => console.warn("Recording a program's computation failed.", error));
      const back = await readBack(work, checked.wanted, checked.keeping);
      return {
        exitCode: result.exitCode,
        output: result.output,
        seconds: result.seconds,
        timedOut: result.killed === "time",
        ...(result.killed ? { stopped: STOPPED[result.killed] || `It ran out of time (${checked.maxSeconds} s).` } : {}),
        ...back
      };
    } catch (error) {
      if (!settled) await hold.settle(0).catch(() => {});
      throw error;
    } finally {
      done();
      if (folder) await fs.rm(folder, { recursive: true, force: true }).catch(() => {});
    }
  }

  /** Shutting down (D-19): no new programs; running ones are stopped, and their scripts told. */
  async function drain() {
    stopping = true;
    await Promise.all([...live].map((job) => job.kill("shutdown")));
  }

  /** Whether this server has the sandbox: gVisor and its toolbox. */
  function available() {
    return shellAvailable(env);
  }

  return Object.freeze({
    available,
    run,
    drain
  });
}
