import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { platformFlags, runsc, sandboxUser } from "@local/files/gvisor";
import { FORWARDER, PROXY_ENV, startGateway } from "./gateway.js";
import { quote } from "./shellQuote.js";

const run = promisify(execFile);
const STAGEHAND_EXTENSION = path.join(path.dirname(fileURLToPath(import.meta.resolve("@browserbasehq/stagehand"))), "extension");
const tools = (env) => path.resolve(env.MERCBOT_TOOLS_DIR || ".tools");
const runscPath = (env) => env.MERCBOT_RUNSC || path.join(tools(env), "bin", "runsc");
const rootfs = (env) => path.join(tools(env), "toolbox", "rootfs");
// The browser's remote-control port inside the sandbox, where it has a network of its own, so the
// same number serves every computer and never takes a port of this server.
const CHROME_DEBUG_PORT = 9222;

// Sandboxes outlive the server that started them, so those of a server that's gone (it crashed,
// or a restart came first) are removed once, when this server first starts one. Their folders
// are named after their server's process: mbd-<pid>-<random>.
let swept = false;
async function sweep(env) {
  if (swept) return;
  swept = true;
  const alive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error.code === "EPERM";
    }
  };
  for (const name of await readdir(os.tmpdir()).catch(() => [])) {
    const pid = Number(/^mbd-(\d+)-/u.exec(name)?.[1]);
    if (!pid || alive(pid)) continue;
    const dir = path.join(os.tmpdir(), name);
    for (const id of await readdir(path.join(dir, "state")).catch(() => [])) {
      await run(...runsc(env, ["--root", path.join(dir, "state"), "delete", "-force", id]), { timeout: 30000 }).catch(() => {});
    }
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Whether this server can run computers' apps in gVisor: gVisor and a toolbox with Chrome.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 */
export function desktopSandboxAvailable(env) {
  return existsSync(runscPath(env)) && existsSync(path.join(rootfs(env), "opt", "chrome", "chrome"));
}

/**
 * One computer's apps in gVisor (D-47, branch computer-gvisor): Chrome and the Craft apps share a
 * sandbox with the computer's display, Chrome's profile and the conversation's folders, and no
 * network but the gateway. The browser listens for remote control on `debugPort` inside the
 * sandbox, offered here as the Unix socket `cdpSocket` (D-68): a published server may listen on
 * no TCP port but its own. Returns { display, chrome (a script to use as the browser's program),
 * debugPort, cdpSocket, exec(argv) (a script line running a program in it), shared(name) (a file of
 * this server's it sees in /io), stop() }.
 * `runtimeEnv` is the server's env; `env` adds variables inside the sandbox.
 */
export async function startDesktopSandbox({ runtimeEnv, computerId, display, profile, folders, env: extraEnv = [] }) {
  await sweep(runtimeEnv);
  const id = `mb-desktop-${computerId}-${randomBytes(4).toString("hex")}`;
  const dir = path.join(os.tmpdir(), `mbd-${process.pid}-${randomBytes(4).toString("hex")}`);
  const io = path.join(dir, "io");
  const state = path.join(dir, "state");
  await mkdir(io, { recursive: true });
  await mkdir(state, { recursive: true });
  await writeFile(path.join(io, "forward.py"), FORWARDER);
  // A profile last used by another Chrome (another sandbox, or before a restart) still has its
  // locks, which would make this one refuse to start.
  for (const name of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
    await rm(path.join(profile, name), { force: true }).catch(() => {});
  }
  const gateway = await startGateway({ socketPath: path.join(io, "gateway.sock") });

  const bind = (source, destination, { readonly = false, exec = true } = {}) => ({
    destination,
    type: "bind",
    source,
    options: ["rbind", readonly ? "ro" : "rw", ...(exec ? [] : ["noexec", "nosuid", "nodev"])]
  });
  const apps = path.join(tools(runtimeEnv), "apps");
  const home = folders ? "/files/mine" : "/tmp";
  const env = [
    "PATH=/usr/local/bin:/usr/bin:/bin",
    `HOME=${home}`, `DISPLAY=:${display}`, "LANG=C.UTF-8", "LC_ALL=C.UTF-8",
    "XDG_CACHE_HOME=/tmp/.cache", `XDG_CONFIG_HOME=${folders ? "/files/mine/.apps" : "/tmp/.config"}`,
    ...PROXY_ENV,
    "VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json", "__EGL_VENDOR_LIBRARY_FILENAMES=/usr/share/glvnd/egl_vendor.d/50_mesa.json",
    ...extraEnv
  ];
  const spec = {
    ociVersion: "1.0.0",
    process: {
      user: { uid: 0, gid: 0, ...(sandboxUser(runtimeEnv) ? { umask: 0o002 } : {}) },
      args: ["/usr/bin/python3", "/io/forward.py", "/io/gateway.sock", String(CHROME_DEBUG_PORT)],
      env,
      cwd: "/",
      noNewPrivileges: true,
      capabilities: { bounding: [], effective: [], inheritable: [], permitted: [], ambient: [] },
      rlimits: [{ type: "RLIMIT_NOFILE", hard: 8192, soft: 8192 }, { type: "RLIMIT_CORE", hard: 0, soft: 0 }]
    },
    root: { path: rootfs(runtimeEnv), readonly: false },
    hostname: "computer",
    mounts: [
      { destination: "/proc", type: "proc", source: "proc" },
      { destination: "/dev", type: "tmpfs", source: "tmpfs" },
      { destination: "/dev/shm", type: "tmpfs", source: "shm", options: ["size=1g", "mode=1777"] },
      { destination: "/sys", type: "sysfs", source: "sysfs", options: ["nosuid", "noexec", "nodev", "ro"] },
      { destination: "/tmp", type: "tmpfs", source: "tmpfs", options: ["size=2g", "mode=1777"] },
      bind("/tmp/.X11-unix", "/tmp/.X11-unix", { readonly: true }),
      bind(io, "/io"),
      bind(profile, "/profile"),
      ...(existsSync(STAGEHAND_EXTENSION) ? [bind(STAGEHAND_EXTENSION, "/opt/stagehand-extension", { readonly: true })] : []),
      ...(folders ? [
        bind(folders.mine, "/files/mine", { exec: false }),
        ...(folders.bot ? [bind(folders.bot, "/files/bot", { exec: false })] : []),
        bind(folders.shared, "/files/shared", { exec: false })
      ] : []),
      ...(existsSync(apps) ? [bind(apps, "/opt/apps", { readonly: true })] : [])
    ],
    linux: { namespaces: [{ type: "pid" }, { type: "network" }, { type: "ipc" }, { type: "uts" }, { type: "mount" }] }
  };
  await writeFile(path.join(dir, "config.json"), JSON.stringify(spec));
  const [runscCommand, runscArgs] = runsc(runtimeEnv, ["--root", state]);
  const inSandbox = [runscCommand, ...runscArgs];
  await new Promise((resolve) => {
    const child = spawn(...runsc(runtimeEnv, [
      "--rootless", "--network=none", "--ignore-cgroups", "--overlay2=root:memory", "--host-uds=all", ...platformFlags(runtimeEnv),
      "--root", state, "run", "--detach", "--bundle", dir, id
    ]), { stdio: "ignore" });
    child.on("error", resolve);
    child.on("close", resolve);
  });

  // The browser's program: Chrome in the sandbox, its profile as /profile, through the gateway.
  // Chrome's own sandbox is off; gVisor is the sandbox. Loopback stays direct: inside the sandbox
  // it reaches only the sandbox (Chrome's own remote-control port, which Stagehand's extension uses).
  // Stagehand's extension is loaded at start from a neutral path; Stagehand finds it loaded and
  // doesn't ask for its own copy by this server's path.
  const chrome = path.join(dir, "chrome.sh");
  await writeFile(chrome, `#!/bin/sh
for arg do
  shift
  case "$arg" in
    --user-data-dir=*) set -- "$@" "--user-data-dir=/profile" ;;
    *) set -- "$@" "$arg" ;;
  esac
done
exec ${[
    ...inSandbox, "exec", "--cwd", home, id, "/bin/sh", "-c", 'exec /opt/chrome/chrome "$@" >> /tmp/chrome.log 2>&1', "chrome",
    "--no-sandbox", "--test-type", "--disable-infobars", "--hide-crash-restore-bubble", "--disable-dev-shm-usage",
    "--proxy-server=http://127.0.0.1:3128", "--load-extension=/opt/stagehand-extension"
  ].map(quote).join(" ")} "$@"
`);
  await chmod(chrome, 0o755);

  return {
    id,
    display,
    chrome,
    debugPort: CHROME_DEBUG_PORT,
    // The forwarder in the sandbox listens on it (--host-uds=all), here and nowhere else.
    cdpSocket: path.join(io, "cdp.sock"),
    gateway,
    // A command line that runs `argv` in the sandbox, for the dock and opening files.
    exec: (argv, cwd = home) => [...inSandbox, "exec", "--cwd", cwd, id, ...argv],
    // A file this server writes for the sandbox to show, such as a coding run's log (codingRuns.js):
    // where it is here, and at /io inside.
    shared: (name) => ({ file: path.join(io, name), inside: `/io/${name}` }),
    async stop() {
      await run(...runsc(runtimeEnv, ["--root", state, "delete", "-force", id]), { timeout: 30000 }).catch(() => {});
      await gateway.close().catch(() => {});
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  };
}
