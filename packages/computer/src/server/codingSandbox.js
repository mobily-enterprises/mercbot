import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { folderMount, runSandboxed, sandboxPlace, sandboxSpec, toolsDir } from "@local/files/gvisor";
import { FORWARDER, PROXY_ENV, startGateway } from "./gateway.js";

/**
 * A coding sandbox's limits, like a bot's command's (shell.js in @local/files): its whole memory,
 * watched from outside, processes, open files and file size. No memory limit per process: Claude
 * Code's and Codex's runtimes reserve far more address space than they use. Its time is the caller's.
 */
export const CODING_LIMITS = Object.freeze({
  sandboxMemory: 3 * 1024 ** 3,
  processes: 512,
  openFiles: 4096,
  fileSize: 4 * 1024 ** 3,
  processMemory: 0,
  scratch: "1g"
});

/** Where a coding tool's own sign-in is, inside: its HOME. */
export const SIGN_IN_HOME = "/profile/.coding";

// How long a sandbox may take to show this server it has exactly its folders.
const CHECK_MS = 20000;

// A coding sandbox's first steps. It leaves a mark only it and this server know ($1) in each folder
// it was given and waits for this server to find each mark where that folder is (`marked`) and say
// go. Then the forwarder to its own gateway, and the tool, under a time limit of its own ($2), so a
// sandbox whose server has gone still ends. A window's terminal stays the tool's.
const START = `mark="$1" seconds="$2"; shift 2
for dir in "$PWD" "$HOME"; do : > "$dir/$mark" || { echo "This run's folders couldn't be checked; nothing ran." >&2; exit 70; }; done
for _ in $(seq 400); do [ -e /gateway/go ] && break; sleep 0.05; done
[ -e /gateway/go ] || exit 70
python3 /gateway/forward.py /gateway/gateway.sock > /dev/null 2>&1 &
for _ in $(seq 100); do [ -e /tmp/.gateway-ready ] && break; sleep 0.05; done
[ -t 0 ] && exec timeout --foreground -k 10 "$seconds" "$@"
exec timeout -k 10 "$seconds" "$@"`;

/**
 * Whether each of `dirs` (link-free real paths) is still that folder and holds `mark`: the
 * sandbox was then given exactly these folders. A folder swapped for a link as the sandbox started
 * would have been given in its place, with the mark there instead. Each folder is opened once
 * without following a link, and its own path and the mark are both read through that one handle.
 * The marks go once all are found.
 * @param {string[]} dirs
 * @param {string} mark
 */
async function marked(dirs, mark) {
  const handles = [];
  try {
    for (const dir of dirs) handles.push(await fs.open(dir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW));
    const through = handles.map((handle) => `/proc/self/fd/${handle.fd}`);
    for (const [at, dir] of through.entries()) {
      if ((await fs.readlink(dir)) !== dirs[at]) return false;
      if (!(await fs.lstat(path.join(dir, mark)).catch(() => null))?.isFile()) return false;
    }
    await Promise.all(through.map((dir) => fs.rm(path.join(dir, mark), { force: true })));
    return true;
  } catch {
    return false;
  } finally {
    await Promise.all(handles.map((handle) => handle.close().catch(() => {})));
  }
}

/**
 * A coding run, or a coding tool's sign-in, in a gVisor sandbox of its own (D-77, the owner's
 * decision of 2026-11-12). It sees the toolbox read-only, the coding tools at /opt/coding, a
 * private /tmp, the tool's sign-in at /profile/.coding (`home`) and, for a run, the project's
 * folder at its place among the bot's files (`project`), and nothing else: not the rest of the
 * computer's browser profile, its /io or other folders. Its only way out is a gateway of its own
 * (gateway.js), which reaches public addresses only: never the computer, this server or its network.
 * Resolves once it has started, to { done, kill(reason) } (`runSandboxed` in `@local/files/gvisor`);
 * one not given exactly its folders is killed with the reason "folders" before the tool starts.
 * @param {object} options
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} options.runtimeEnv the server's env
 * @param {string} options.home the sign-in's folder on this server, a link-free real path
 * @param {{ source: string, destination: string } | null} [options.project] the project's folder on
 *   this server (a link-free real path) and where the bot sees it (/files/mine/site)
 * @param {string[]} options.argv the tool's command line
 * @param {string[]} options.env the tool's own variables
 * @param {number} options.maxSeconds
 * @param {(text: string) => void} [options.onOutput]
 * @param {(argv: string[]) => string[]} [options.terminal] for a sign-in: the window on the
 *   computer's screen it runs in, given runsc's command line
 * @param {typeof CODING_LIMITS} [options.limits]
 * @param {number} [options.checkMs] how long it may take to show it has exactly its folders
 */
export async function startCodingSandbox({
  runtimeEnv, home, project = null, argv, env, maxSeconds, onOutput, terminal, limits = CODING_LIMITS, checkMs = CHECK_MS
}) {
  const place = sandboxPlace("coding");
  const gatewayDir = path.join(place.dir, "gateway");
  // What it has at /profile and /files: empty folders of its own, read-only, holding only where its
  // two folders are shown. gVisor makes a folder's place in the system it's given if it's missing,
  // and the toolbox is every sandbox's, so a project's name never goes there.
  const outline = (inside) => path.join(place.dir, "outline", inside);
  let gateway = null;
  try {
    await fs.mkdir(gatewayDir, { recursive: true });
    await fs.mkdir(outline(SIGN_IN_HOME), { recursive: true });
    if (project) await fs.mkdir(outline(project.destination), { recursive: true });
    await fs.writeFile(path.join(gatewayDir, "forward.py"), FORWARDER);
    gateway = await startGateway({ socketPath: path.join(gatewayDir, "gateway.sock") });
  } catch (error) {
    await gateway?.close().catch(() => {});
    await fs.rm(place.dir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  const mark = `.mercbot-${randomBytes(16).toString("hex")}`;
  const spec = sandboxSpec({
    runtimeEnv,
    args: ["/bin/bash", "-c", START, "coding", mark, String(maxSeconds + 30), ...argv],
    cwd: project?.destination || SIGN_IN_HOME,
    env: [
      "PATH=/usr/local/bin:/usr/bin:/bin", "LANG=C.UTF-8", "LC_ALL=C.UTF-8", "TMPDIR=/tmp", "XDG_CACHE_HOME=/tmp/.cache",
      `TERM=${terminal ? "xterm-256color" : "dumb"}`, ...PROXY_ENV, ...env
    ],
    limits,
    rootReadOnly: true,
    hostname: "coding",
    terminal: Boolean(terminal),
    mounts: [
      folderMount(path.join(toolsDir(runtimeEnv), "coding"), "/opt/coding", { readonly: true, exec: true }),
      folderMount(gatewayDir, "/gateway"),
      folderMount(outline("/profile"), "/profile", { readonly: true }),
      folderMount(home, SIGN_IN_HOME),
      ...(project ? [folderMount(outline("/files"), "/files", { readonly: true }), folderMount(project.source, project.destination)] : [])
    ]
  });
  let job;
  try {
    job = await runSandboxed({
      env: runtimeEnv, place, spec, flags: ["--host-uds=open"], maxSeconds, memory: limits.sandboxMemory, onOutput, wrap: terminal
    });
  } catch (error) {
    await gateway.close().catch(() => {});
    throw error;
  }
  let ended = false;
  const done = job.done.finally(() => {
    ended = true;
    return gateway.close().catch(() => {});
  });
  (async () => {
    const dirs = [home, ...(project ? [project.source] : [])];
    for (const deadline = Date.now() + checkMs; !ended && Date.now() < deadline; await delay(50)) {
      if (await marked(dirs, mark)) {
        await fs.writeFile(path.join(gatewayDir, "go"), "");
        return;
      }
    }
    if (!ended) await job.kill("folders");
  })().catch(() => job.kill("folders"));
  return { done, kill: job.kill };
}

/** Pure helpers and data the tests reach directly (rule 64). */
export const __testables = Object.freeze({ marked });
