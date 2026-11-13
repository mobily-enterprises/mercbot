import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import path from "node:path";
import { SIGN_IN_HOME } from "./codingSandbox.js";

/**
 * Coding tools on a bot's computer: Claude Code or Codex CLI, each signed in
 * with the person's own account, by the person, on the computer itself. Mercbot never signs a tool
 * in with a shared account and resells no credits. A tool keeps its sign-in in the computer's
 * browser profile (/profile/.coding), which is sealed and saved with the browser's own sign-ins
 * (D-19); the bot's files, its command line and the computer's browser never see it, and a coding
 * sandbox sees nothing else of the profile (D-77). `credentials` is where a signed-in tool keeps
 * its sign-in, under that folder.
 */
export const CODING_TOOLS = Object.freeze({
  "claude-code": Object.freeze({
    label: "Claude Code",
    bin: "claude",
    credentials: ".claude/.credentials.json",
    // Its first start asks the person to sign in, on the screen.
    signIn: [],
    // gVisor is the sandbox: the tool asks nobody before each step (IS_SANDBOX lets it, as root).
    run: (brief) => ["-p", brief, "--dangerously-skip-permissions"],
    env: ["IS_SANDBOX=1", "DISABLE_AUTOUPDATER=1"]
  }),
  codex: Object.freeze({
    label: "Codex",
    bin: "codex",
    credentials: ".codex/auth.json",
    // A device code: the person can sign in on their own phone or computer.
    signIn: ["login", "--device-auth"],
    run: (brief) => ["exec", "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check", brief],
    env: []
  })
});

/** Where the tools are installed (scripts/install-tools.sh), as a coding sandbox sees them. */
export const CODING_BIN = "/opt/coding/node_modules/.bin";

/** The tools' own home: their sign-in, kept in the computer's browser profile, never the bot's files. */
const TOOL_ENV = [
  `HOME=${SIGN_IN_HOME}`,
  `XDG_CONFIG_HOME=${SIGN_IN_HOME}/.config`,
  `XDG_DATA_HOME=${SIGN_IN_HOME}/.local/share`,
  `XDG_STATE_HOME=${SIGN_IN_HOME}/.local/state`,
  "NO_COLOR=1"
];

/** How much of a run's output is kept, how long a run may go on, and a sign-in's window stay open. */
const OUTPUT_CHARS = 20000;
export const CODING_LIMIT_MS = 2 * 60 * 60 * 1000;
export const SIGN_IN_LIMIT_MS = 30 * 60 * 1000;
// What of a run's output its window shows: past this the log stops, saying so (the bot still reads the end).
const LOG_BYTES = 4 * 1024 * 1024;
/**
 * How a run's window follows its log, inside the computer's sandbox: by reading it again every half
 * second. This server writes the log from outside, and gVisor tells a program inside of no change
 * made outside (inotify), so plain `tail -F` would show only what was there when it started.
 */
export const FOLLOW_LOG = Object.freeze(["/usr/bin/tail", "-n", "+1", "-F", "-s", "0.5", "---disable-inotify"]);

/** What a run that was stopped says at its end, by why it was stopped. */
const stoppedNotes = (limitMs) => Object.freeze({
  stopped: "(Stopped, as asked.)",
  time: `(Stopped after ${Math.round(limitMs / 60000)} minutes, the longest a run may go on.)`,
  memory: "(Stopped: it used more memory than a coding run may.)",
  asleep: "(Stopped: the computer went to sleep.)"
});

/** What a run whose sandbox wasn't given exactly its folder says (the reason "folders"): the tool never started. */
const NOT_STARTED = "(It didn't start: its folder changed as it was starting, so nothing ran.)";

/** The rules every brief starts with, so the tool leaves the person in charge. */
export const BRIEF_RULES =
  "You are working in this folder for the person who owns it. Change files only in this folder. Don't push, merge, publish, " +
  "or delete branches, repositories or other people's work, and don't sign in anywhere: leave your changes here for the " +
  "person to review. Finish with a short summary of what you changed, how you checked it, and anything left to do.";

/**
 * The coding runs of the computers this server holds: at most one per computer, each in a gVisor
 * sandbox of its own that has only the project's folder and the tool's sign-in (D-77). A tool's
 * sign-in runs in one too, in a window on the computer's screen. A run's output is kept for the
 * bot and written to a log a window on the screen follows, so the person can watch it. When a run
 * ends, however it ends, its sandbox is gone and `ended` has been told, and the bot reports.
 * @param {object} dependencies
 * @param {(computer: object, request: { folder?: string, argv: string[], env: string[], maxSeconds: number,
 *   onOutput?: (text: string) => void, title?: string }) => Promise<{ done: Promise<{ exitCode: number, killed: string | null }>,
 *   kill: (reason: string) => Promise<void> }>} dependencies.sandbox starts the tool in a sandbox of its own: a run on
 *   `folder` (a folder of the bot's files, as the bot names it), or with `title` a sign-in in a window on the screen
 * @param {(computerId: string, title: string, argv: string[]) => string[] | null} dependencies.window
 *   the host command showing `argv`, run in the computer's sandbox, in a window on its screen
 * @param {(computerId: string, name: string) => { file: string, inside: string } | null} dependencies.shared
 *   a file of this server's that the computer's sandbox sees, at `inside`
 * @param {(computerId: string) => boolean} dependencies.installed whether the tools are on this server
 * @param {(computerId: string, run: object) => Promise<void> | void} dependencies.ended
 * @param {number} [dependencies.limitMs]
 */
export function createCodingRuns({ sandbox, window, shared, installed, ended, limitMs = CODING_LIMIT_MS }) {
  const stopped = stoppedNotes(limitMs);
  /** What the bot is told about a run: the end of its output is the tool's own words, never instructions. */
  const describe = (run) =>
    run
      ? {
          id: run.id,
          tool: run.tool,
          label: CODING_TOOLS[run.tool].label,
          folder: run.folder,
          status: run.status,
          startedAt: run.startedAt,
          ...(run.endedAt ? { endedAt: run.endedAt, exitCode: run.exitCode } : {}),
          output: run.output.slice(-4000)
        }
      : null;

  /** The tools, whether each is signed in on this computer, and its run. */
  function status(computer) {
    const ready = installed(computer.computerId);
    return {
      tools: Object.entries(CODING_TOOLS).map(([id, tool]) => ({
        id,
        label: tool.label,
        installed: ready,
        signedIn: Boolean(computer.profile) && existsSync(path.join(computer.profile, ".coding", tool.credentials))
      })),
      run: describe(computer.coding)
    };
  }

  const running = (computer) => computer.coding?.status === "running";

  /** Shows `argv`, run in the computer's sandbox, in a window on its screen; false when it can't. */
  function showWindow(computer, title, argv) {
    const shown = window(computer.computerId, title, argv);
    if (!shown) return false;
    const [program, ...args] = shown;
    const child = spawn(program, args, { stdio: "ignore" });
    child.once("error", () => {});
    computer.opened = [...(computer.opened || []).filter((open) => open.exitCode === null), child];
    return true;
  }

  /**
   * Opens the tool's sign-in, in a sandbox of its own, in a window on the computer's screen, for the
   * person to finish there. One at a time per computer; it closes after `SIGN_IN_LIMIT_MS`.
   */
  async function signIn(computer, toolId) {
    const tool = CODING_TOOLS[toolId];
    if (!tool) throw new Error(`There's no coding tool called ${toolId}.`);
    if (!installed(computer.computerId)) throw new Error("The coding tools aren't installed on this server.");
    if (computer.signingIn) return status(computer);
    const opening = sandbox(computer, {
      title: `Sign in to ${tool.label}`,
      argv: [`${CODING_BIN}/${tool.bin}`, ...tool.signIn],
      env: [...TOOL_ENV, ...tool.env],
      maxSeconds: SIGN_IN_LIMIT_MS / 1000
    });
    computer.signingIn = opening;
    let job;
    try {
      job = await opening;
    } catch (error) {
      computer.signingIn = null;
      throw error;
    }
    computer.signingIn = job;
    job.done.finally(() => {
      if (computer.signingIn === job) computer.signingIn = null;
    });
    return status(computer);
  }

  /**
   * Starts the tool on the brief in `folder` (a folder of the bot's files, such as
   * /files/mine/website), once it's signed in and nothing else runs there.
   */
  async function start(computer, { tool: toolId, folder, brief }) {
    const tool = CODING_TOOLS[toolId];
    if (!tool) throw new Error(`There's no coding tool called ${toolId}.`);
    const entry = status(computer).tools.find((found) => found.id === toolId);
    if (!entry.installed) throw new Error("The coding tools aren't installed on this server.");
    if (!entry.signedIn) {
      throw Object.assign(new Error(`${tool.label} isn't signed in on this computer.`), { code: "not_signed_in" });
    }
    if (running(computer)) throw Object.assign(new Error(`${CODING_TOOLS[computer.coding.tool].label} is already working here.`), { code: "busy" });
    const before = computer.coding;
    const id = String((computer.codingRuns = (computer.codingRuns || 0) + 1));
    let settle;
    const run = {
      id,
      tool: toolId,
      folder,
      status: "running",
      startedAt: new Date().toISOString(),
      output: "",
      job: null,
      stopping: null,
      finished: new Promise((resolve) => (settle = resolve))
    };
    // Taken before the sandbox starts, so a second start meanwhile is refused.
    computer.coding = run;
    // The output goes to the bot and to a log the window on the screen follows. The computer's
    // sandbox can write where the log goes, so the log is a new file there, never one it made or a
    // link it left (O_EXCL), named so it can't be guessed.
    const log = shared(computer.computerId, `coding-${id}-${randomBytes(8).toString("hex")}.log`);
    const shown = log ? createWriteStream(log.file, { flags: "wx" }).on("error", () => {}) : null;
    let logged = 0;
    const show = (text) => {
      if (!shown || logged >= LOG_BYTES) return;
      logged += Buffer.byteLength(text);
      shown.write(logged < LOG_BYTES ? text : `${text}\n(The rest isn't shown here; the bot reads how it ends.)\n`);
    };
    const keep = (text) => {
      run.output = (run.output + text).slice(-OUTPUT_CHARS);
      show(text);
    };
    try {
      run.job = await sandbox(computer, {
        folder,
        argv: [`${CODING_BIN}/${tool.bin}`, ...tool.run(`${BRIEF_RULES}\n\n${brief}`)],
        env: [...TOOL_ENV, ...tool.env],
        maxSeconds: limitMs / 1000,
        onOutput: keep
      });
    } catch (error) {
      computer.coding = before;
      shown?.end();
      settle();
      throw error;
    }
    // Stopped while its sandbox was starting: it stops now.
    if (run.stopping) run.job.kill(run.stopping);
    run.job.done.then(async ({ exitCode, killed }) => {
      run.job = null;
      run.endedAt = new Date().toISOString();
      run.exitCode = exitCode;
      const stoppedNote = killed ? stopped[killed] : "";
      run.status = exitCode === 0 && !killed ? "done" : stoppedNote ? "stopped" : "failed";
      const note = stoppedNote || (killed === "folders" ? NOT_STARTED : "");
      if (note) {
        run.output = `${run.output}\n${note}`.slice(-OUTPUT_CHARS);
        show(`\n${note}\n`);
      }
      shown?.end();
      try {
        await ended(computer.computerId, describe(run));
      } catch (error) {
        console.warn(`A coding run's ending on computer ${computer.computerId} wasn't passed on: ${error.message}`);
      }
    }).finally(settle);
    // The person watches it on the screen; without a window it still runs.
    if (log) showWindow(computer, `${tool.label} at work`, [...FOLLOW_LOG, log.inside]);
    return status(computer);
  }

  /**
   * Stops the computer's run, if one is going, and its sign-in window (`why`: "stopped" when asked
   * to, "asleep" when the computer goes to sleep). Resolves once the run has ended, its sandbox is
   * gone and its ending has been passed on.
   */
  async function stop(computer, why = "stopped") {
    const run = computer.coding;
    if (run?.status === "running") {
      run.stopping ??= why;
      await run.job?.kill(why);
      await run.finished;
    }
    if (why === "asleep" && computer.signingIn) {
      const signingIn = await Promise.resolve(computer.signingIn).catch(() => null);
      await signingIn?.kill(why);
      await signingIn?.done;
    }
    return status(computer);
  }

  /**
   * One request from the bot on an awake computer (the computers' `code` operation): `status`
   * (each tool, whether it's signed in, and the run), `signIn`, `start` a run on a brief in a folder,
   * or `stop` it.
   * @param {object} computer
   * @param {{ action: "status" | "signIn" | "start" | "stop", tool?: string, folder?: string, brief?: string }} request
   */
  function handle(computer, request) {
    if (request.action === "signIn") return signIn(computer, String(request.tool));
    if (request.action === "start") {
      return start(computer, { tool: String(request.tool), folder: String(request.folder), brief: String(request.brief) });
    }
    if (request.action === "stop") return stop(computer);
    return status(computer);
  }

  return Object.freeze({
    handle,
    status,
    signIn,
    start,
    stop,
    running
  });
}
