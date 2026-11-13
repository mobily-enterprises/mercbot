import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

// Everything bots run is in gVisor (D-47, D-49). This is one gVisor sandbox's part: where gVisor
// and the toolbox are, how runsc runs (as the sandbox user when there is one), a sandbox's OCI
// spec and its folders, and running one to its end with its memory watched from outside, so that
// it's gone however it ends. The command line (shell.js), the office apps (officeApps.js), the
// computers' desktop and coding runs (@local/computer) are each made of these.

/**
 * Where scripts/install-tools.sh puts gVisor, the toolbox and the apps.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 */
export function toolsDir(env) {
  return path.resolve(env.MERCBOT_TOOLS_DIR || ".tools");
}

const runscPath = (env) => env.MERCBOT_RUNSC || path.join(toolsDir(env), "bin", "runsc");

/**
 * Who the sandboxes run as (D-49). With MERCBOT_SANDBOX_USER set (scripts/setup-sandbox-user.sh,
 * run once as root), every gVisor sandbox runs as that powerless user through one sudo rule, so a
 * program that got out of gVisor still couldn't read this server's settings, keys or database
 * password. That user and the server share a group, and both write group-writable files (umask
 * 002), so each can change what the other made in the folders.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 */
export function sandboxUser(env) {
  return String(env.MERCBOT_SANDBOX_USER || "").trim();
}

/**
 * `[command, args]` that run runsc with `args`, as the sandbox user when there is one.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 * @param {string[]} args
 */
export function runsc(env, args) {
  const user = sandboxUser(env);
  return user ? ["sudo", ["-n", "-u", user, "--", runscPath(env), ...args]] : [runscPath(env), args];
}

/**
 * A scratch folder of this server's that the sandbox may also write in.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 * @param {string} prefix
 */
export async function sharedScratch(env, prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  if (sandboxUser(env)) await fs.chmod(dir, 0o2770);
  return dir;
}
const rootfs = (env) => path.join(toolsDir(env), "toolbox", "rootfs");

/**
 * gVisor's platform: its default (systrap), or KVM when MERCBOT_GVISOR_PLATFORM=kvm. KVM is only
 * faster on a machine with hardware virtualisation of its own (bare metal); inside a virtual
 * machine (nested KVM) it measured slower on everything that matters (D-49), so it's turned on per
 * server after measuring with scripts/measure-browser-speed.mjs.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 */
export function platformFlags(env) {
  const chosen = String(env.MERCBOT_GVISOR_PLATFORM || "").trim();
  return chosen ? [`--platform=${chosen}`] : [];
}

/**
 * Whether gVisor and the toolbox are installed.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 */
export function shellAvailable(env) {
  return existsSync(runscPath(env)) && existsSync(path.join(rootfs(env), "etc", "mercbot-toolbox"));
}

/**
 * A folder of the server's shown in a sandbox at `destination`. Folders hold files, never programs:
 * nothing there can be started (scripts still run through bash, python3 or node) unless `exec`.
 * @param {string} source
 * @param {string} destination
 * @param {{ readonly?: boolean, exec?: boolean }} [options]
 */
export function folderMount(source, destination, { readonly = false, exec = false } = {}) {
  return {
    destination,
    type: "bind",
    source,
    options: ["rbind", readonly ? "ro" : "rw", ...(exec ? [] : ["noexec", "nosuid", "nodev"])]
  };
}

/**
 * The OCI bundle of a gVisor sandbox: the toolbox as its system (read-only with `rootReadOnly`,
 * otherwise its changes vanish with the sandbox), a private /tmp of `limits.scratch`, no
 * capabilities and no new privileges, namespaces of its own (processes, network, IPC, host name,
 * mounts), the `limits` on processes, open files, file size and, unless it's 0, each process's
 * memory, and only the `mounts` given. `env` is the whole environment: never the server's.
 * @param {object} options
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} options.runtimeEnv the server's env, for the tools folder and the sandbox user
 * @param {string[]} options.args
 * @param {string} options.cwd
 * @param {string[]} options.env
 * @param {{ processes: number, openFiles: number, fileSize: number, processMemory: number, scratch: string }} options.limits
 * @param {object[]} [options.mounts]
 * @param {boolean} [options.rootReadOnly]
 * @param {string} [options.hostname]
 * @param {boolean} [options.terminal] the program gets the terminal runsc runs in (a window on a computer's screen)
 */
export function sandboxSpec({ runtimeEnv, args, cwd, env, limits, mounts = [], rootReadOnly = false, hostname = "bot", terminal = false }) {
  const limit = (type, value) => ({ type, hard: value, soft: value });
  return {
    ociVersion: "1.0.0",
    process: {
      ...(terminal ? { terminal: true } : {}),
      user: { uid: 0, gid: 0, ...(sandboxUser(runtimeEnv) ? { umask: 0o002 } : {}) },
      args,
      env,
      cwd,
      noNewPrivileges: true,
      capabilities: { bounding: [], effective: [], inheritable: [], permitted: [], ambient: [] },
      rlimits: [
        limit("RLIMIT_NPROC", limits.processes),
        limit("RLIMIT_NOFILE", limits.openFiles),
        limit("RLIMIT_FSIZE", limits.fileSize),
        ...(limits.processMemory ? [limit("RLIMIT_AS", limits.processMemory)] : []),
        limit("RLIMIT_CORE", 0)
      ]
    },
    root: { path: rootfs(runtimeEnv), readonly: rootReadOnly },
    hostname,
    mounts: [
      { destination: "/proc", type: "proc", source: "proc" },
      { destination: "/dev", type: "tmpfs", source: "tmpfs" },
      { destination: "/sys", type: "sysfs", source: "sysfs", options: ["nosuid", "noexec", "nodev", "ro"] },
      { destination: "/tmp", type: "tmpfs", source: "tmpfs", options: [`size=${limits.scratch}`, "mode=1777"] },
      ...mounts
    ],
    linux: { namespaces: [{ type: "pid" }, { type: "network" }, { type: "ipc" }, { type: "uts" }, { type: "mount" }] }
  };
}

/**
 * What a sandbox holds in memory, in bytes, as gVisor counts it: its programs', its files kept in
 * memory and its own. gVisor's process's resident memory doesn't show the programs': they're in a
 * memory file it maps only for them. null once the sandbox has gone.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 * @param {{ id: string, state: string }} place
 */
export async function sandboxMemory(env, { id, state }) {
  const stats = await run(...runsc(env, ["--root", state, "events", "-stats", id]), { timeout: 10000 })
    .then((result) => JSON.parse(result.stdout))
    .catch(() => null);
  const used = stats?.data?.memory?.usage?.usage;
  return Number.isFinite(used) ? used : null;
}

/**
 * Where a new sandbox lives: its id and a folder named after this server's process, so a server
 * that starts after this one has gone removes what it left (sweepSandboxes). `kind` names it.
 * @param {string} [kind]
 */
export function sandboxPlace(kind = "") {
  const id = `mb-${kind ? `${kind}-` : ""}${randomUUID()}`;
  const dir = path.join(os.tmpdir(), "mercbot-shell", `${process.pid}-${id}`);
  return { id, dir, state: path.join(dir, "state") };
}

/**
 * Runs the sandbox `spec` describes (sandboxSpec) in `place` (sandboxPlace) to its end, rootless,
 * with no network but what `flags` add and the toolbox's changes in memory. Its output goes to
 * `onOutput`; its whole memory is watched from outside (sandboxMemory) and it's killed past
 * `memory` bytes, or `maxSeconds`. However it ends, the sandbox and its folder go.
 * `wrap` turns runsc's command line into the one started instead, such as a window on a computer's
 * screen that runs it. Resolves once it's started, to { done, kill(reason), stdin }: `done`
 * resolves to { exitCode, seconds, killed } and never rejects.
 * @param {object} options
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} options.env the server's env
 * @param {{ id: string, dir: string, state: string }} options.place
 * @param {object} options.spec
 * @param {string[]} [options.flags]
 * @param {number} options.maxSeconds
 * @param {number} options.memory
 * @param {(text: string) => void} [options.onOutput]
 * @param {(argv: string[]) => string[]} [options.wrap]
 * @param {boolean} [options.input] keep the sandbox's stdin open, as `stdin`
 */
export async function runSandboxed({ env, place, spec, flags = [], maxSeconds, memory, onOutput = () => {}, wrap, input = false }) {
  const started = Date.now();
  await sweepSandboxes(env);
  const runscIn = (...args) => run(...runsc(env, ["--root", place.state, ...args]), { timeout: 30000 }).catch(() => null);
  const remove = async () => {
    await runscIn("delete", "-force", place.id);
    await fs.rm(place.dir, { recursive: true, force: true }).catch(() => {});
  };
  try {
    await fs.mkdir(place.state, { recursive: true });
    await fs.writeFile(path.join(place.dir, "config.json"), JSON.stringify(spec));
  } catch (error) {
    await remove();
    throw error;
  }
  const [command, args] = runsc(env, [
    "--rootless", "--network=none", "--ignore-cgroups", "--overlay2=root:memory", ...flags, ...platformFlags(env),
    "--root", place.state, "run", "--bundle", place.dir, place.id
  ]);
  const [program, ...programArgs] = (wrap || ((argv) => argv))(["nice", "-n", "10", command, ...args]);
  const child = spawn(program, programArgs, { stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] });
  let killed = null;
  const kill = async (reason) => {
    if (killed) return;
    killed = reason;
    await runscIn("kill", place.id, "KILL");
    child.kill("SIGKILL");
  };
  child.stdin?.on("error", () => {});
  child.stdout.setEncoding("utf8").on("data", onOutput);
  child.stderr.setEncoding("utf8").on("data", onOutput);
  const timer = setTimeout(() => kill("time"), maxSeconds * 1000);
  const watchdog = setInterval(async () => {
    if ((await sandboxMemory(env, place)) > memory) kill("memory");
  }, 1000);
  const done = new Promise((resolve) => {
    child.on("error", (error) => {
      onOutput(`\n${error.message}`);
      resolve(127);
    });
    child.on("close", (code) => resolve(code ?? 137));
  }).then(async (exitCode) => {
    clearTimeout(timer);
    clearInterval(watchdog);
    await remove();
    return { exitCode, seconds: Math.round((Date.now() - started) / 100) / 10, killed };
  });
  return { done, kill, stdin: child.stdin };
}

// Sandboxes outlive the server that started them; those of a server that's gone are removed once,
// when this server first starts a sandbox. Their folders begin with their server's process id.
let swept = false;
export async function sweepSandboxes(env) {
  if (swept) return;
  swept = true;
  const parent = path.join(os.tmpdir(), "mercbot-shell");
  const alive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error.code === "EPERM";
    }
  };
  for (const name of await fs.readdir(parent).catch(() => [])) {
    const pid = Number(/^(\d+)-mb-/u.exec(name)?.[1]);
    if (!pid || alive(pid)) continue;
    const dir = path.join(parent, name);
    const id = name.slice(String(pid).length + 1);
    await run(...runsc(env, ["--root", path.join(dir, "state"), "delete", "-force", id]), { timeout: 30000 }).catch(() => {});
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

