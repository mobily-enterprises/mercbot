import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { appendFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FOLLOW_LOG } from "../../packages/computer/src/server/codingRuns.js";
import { CODING_LIMITS, __testables, startCodingSandbox } from "../../packages/computer/src/server/codingSandbox.js";
import { folderMount, runSandboxed, sandboxPlace, sandboxSpec, shellAvailable, toolsDir } from "../../packages/files/src/server/gvisor.js";

const { marked } = __testables;

// A coding run's own sandbox (D-77, the owner's decision of 2026-11-12), in real gVisor: only the
// project's folder and the tool's sign-in, no other folder, nothing of the computer, and the
// internet only through its own gateway. The stand-in tool is a bash script that tries each thing
// a coding tool talked into it might try. Runs where gVisor, the toolbox and the coding tools are
// installed (MERCBOT_TOOLS_DIR; on the desktop test host, /opt/mercbot-tools).
const available = shellAvailable(process.env) && existsSync(path.join(toolsDir(process.env), "coding"));
const skip = available ? false : "gVisor, the toolbox and the coding tools aren't installed (npm run tools:install)";

/** A project, a computer's browser profile with its sign-in and a site's cookies, and another folder. */
async function folders(context) {
  // Link-free, as the folders a coding sandbox is given always are.
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "mb-coding-sandbox-")));
  context.after(() => rm(root, { recursive: true, force: true }));
  const project = path.join(root, "project");
  const profile = path.join(root, "profile");
  await mkdir(project);
  await mkdir(path.join(profile, ".coding"), { recursive: true });
  await mkdir(path.join(profile, "Default"));
  await mkdir(path.join(root, "other"));
  await writeFile(path.join(project, "README.md"), "The project's own readme\n");
  await writeFile(path.join(profile, ".coding", "auth.json"), "the person's coding sign-in\n");
  await writeFile(path.join(profile, "Default", "Cookies"), "the person's signed-in sites\n");
  await writeFile(path.join(root, "other", "secret.txt"), "another folder\n");
  return { root, project, home: path.join(profile, ".coding") };
}

/** Runs `script` as the tool in a coding sandbox, to its end: { exitCode, killed, output }. */
async function inSandbox({ project, home }, script, options = {}) {
  let output = "";
  const job = await startCodingSandbox({
    runtimeEnv: process.env,
    home,
    project: project === null ? null : { source: project, destination: "/files/mine/site" },
    argv: ["/bin/bash", "-c", script],
    env: ["HOME=/profile/.coding"],
    maxSeconds: 60,
    onOutput: (text) => (output += text),
    ...options
  });
  const result = await (options.whileRunning ? options.whileRunning(job) : job.done);
  return { ...result, output };
}

/** What a coding run left of its sandboxes on this server: nothing, once each has ended. */
const leftovers = async () => (await readdir(path.join(os.tmpdir(), "mercbot-shell")).catch(() => []))
  .filter((name) => name.startsWith(`${process.pid}-mb-coding-`));

test("the folder check: a mark is found only where the folder really is", async (context) => {
  const { root, project } = await folders(context);
  await writeFile(path.join(project, ".mercbot-x"), "");
  assert.equal(await marked([project], ".mercbot-x"), true);
  assert.equal(existsSync(path.join(project, ".mercbot-x")), false, "the mark goes once found");
  assert.equal(await marked([project], ".mercbot-x"), false, "nor is a missing one found");
  // The folder swapped for a link, as a bot's command could do while a run starts: the mount would
  // have gone where the link leads, with the mark there.
  await writeFile(path.join(root, "other", ".mercbot-y"), "");
  await rm(project, { recursive: true });
  await symlink(path.join(root, "other"), project);
  assert.equal(await marked([project], ".mercbot-y"), false);
  // A folder above it swapped for a link: the path still opens as a folder, but another one.
  const above = path.join(root, "above");
  await mkdir(path.join(above, "site"), { recursive: true });
  await mkdir(path.join(root, "elsewhere", "site"), { recursive: true });
  await writeFile(path.join(root, "elsewhere", "site", ".mercbot-z"), "");
  await rm(above, { recursive: true });
  await symlink(path.join(root, "elsewhere"), above);
  assert.equal(await marked([path.join(above, "site")], ".mercbot-z"), false);
});

test("a coding run's sandbox sees only its project and the tool's sign-in, and nothing of the computer or this server", { skip }, async (context) => {
  const dirs = await folders(context);
  // This server's own loopback, and its address on its network.
  const server = net.createServer((socket) => socket.end("this server's secret\n"));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const lan = Object.values(os.networkInterfaces()).flat().find((entry) => entry?.family === "IPv4" && !entry.internal)?.address;
  const { exitCode, killed, output } = await inSandbox(dirs, `
cat README.md; echo "made inside" > made.txt && echo "wrote=yes"
echo "cwd=$PWD home=$HOME"
echo "profile=$(ls -A /profile | tr '\\n' ' ')"
cat /profile/Default/Cookies 2>&1 | head -1
echo "sign-in=$(cat /profile/.coding/auth.json)"; echo "refreshed" > /profile/.coding/auth.json
echo "files=$(ls -A /files) $(ls -A /files/mine)"
touch /files/mine/elsewhere 2>&1 | head -1
echo "io=$(ls -A /io 2>/dev/null | wc -l)"
echo "opt=$(for at in /opt/*/; do [ -n "$(ls -A "$at")" ] && basename "$at"; done | tr '\\n' ' ')"
touch /usr/x 2>&1 | head -1
python3 - "${port}" "${lan || ""}" <<'PY'
import socket, sys
port, lan = int(sys.argv[1]), sys.argv[2]
def direct(host, port):
    try:
        socket.create_connection((host, port), 3).close()
        return "connected"
    except OSError as error:
        return error.strerror or type(error).__name__
def proxied(target):
    s = socket.create_connection(("127.0.0.1", 3128), 3)
    s.sendall(("CONNECT %s HTTP/1.1\\r\\nHost: %s\\r\\n\\r\\n" % (target, target)).encode())
    return s.recv(200).decode().split("\\r\\n")[0]
for name, host, at in [("browser", "127.0.0.1", 9222), ("server", "127.0.0.1", port), ("metadata", "169.254.169.254", 80)] + ([("lan", lan, port)] if lan else []):
    print("%s-direct=%s" % (name, direct(host, at)))
    print("%s-gateway=%s" % (name, proxied("%s:%d" % (host, at))))
PY
`);
  assert.equal(exitCode, 0, output);
  assert.equal(killed, null);
  // The project, read and written.
  assert.match(output, /^The project's own readme\nwrote=yes\ncwd=\/files\/mine\/site home=\/profile\/\.coding\n/u);
  assert.equal(await readFile(path.join(dirs.project, "made.txt"), "utf8"), "made inside\n");
  // The tool's sign-in, read and kept; nothing else of the browser profile; no other folder.
  assert.match(output, /^profile=\.coding $/mu);
  assert.match(output, /^cat: \/profile\/Default\/Cookies: No such file or directory$/mu);
  assert.match(output, /^sign-in=the person's coding sign-in$/mu);
  assert.equal(await readFile(path.join(dirs.home, "auth.json"), "utf8"), "refreshed\n");
  assert.match(output, /^files=mine site$/mu, "of the bot's files, only the project");
  assert.match(output, /^touch: cannot touch '\/files\/mine\/elsewhere': Read-only file system$/mu, "and it writes nowhere else");
  // Where the project is shown was made in the sandbox's own folder, not in the toolbox every sandbox shares.
  assert.equal(existsSync(path.join(toolsDir(process.env), "toolbox", "rootfs", "files", "mine", "site")), false);
  // Nothing of the computer: nothing at /io (its gateway and its browser's control socket). Where
  // other sandboxes' folders go may be there, empty, in a toolbox made by hand (docs/deployment.md).
  assert.match(output, /^io=0$/mu);
  assert.match(output, /^opt=.*\bcoding\b/mu, "the coding tools");
  assert.doesNotMatch(output, /^opt=.*\b(apps|piper|stagehand-extension)\b/mu, "and no other program of this server's");
  assert.match(output, /^touch: cannot touch '\/usr\/x': (Read-only file system|Permission denied)$/mu, "the toolbox is read-only");
  // The browser's control port, this server, cloud metadata and this server's network: refused
  // directly (the sandbox has no network) and by its gateway.
  for (const name of ["browser", "server", "metadata", ...(output.includes("lan-direct") ? ["lan"] : [])]) {
    assert.match(output, new RegExp(`^${name}-direct=(Connection refused|Network is unreachable)$`, "mu"), name);
    assert.match(output, new RegExp(`^${name}-gateway=HTTP/1\\.1 403 Forbidden$`, "mu"), name);
  }
  assert.doesNotMatch(output, /this server's secret|signed-in sites|another folder/u);
  assert.deepEqual(await leftovers(), [], "the sandbox is gone");
});

test("a coding sandbox stops at its memory, its time and when stopped, and leaves nothing behind", { skip }, async (context) => {
  const dirs = await folders(context);
  const memory = await inSandbox(dirs, "python3 -c 'x = bytearray(600 * 1024 ** 2); import time; time.sleep(30)'", {
    limits: { ...CODING_LIMITS, sandboxMemory: 300 * 1024 ** 2 }
  });
  assert.equal(memory.killed, "memory");

  const late = await inSandbox(dirs, "sleep 30", { maxSeconds: 2 });
  assert.equal(late.killed, "time");

  const stopped = await inSandbox(dirs, "echo started; sleep 30", {
    whileRunning: async (job) => {
      await job.kill("stopped");
      return job.done;
    }
  });
  assert.equal(stopped.killed, "stopped");
  assert.deepEqual(await leftovers(), []);
});

test("a coding sandbox not given exactly its folders never starts the tool", { skip }, async (context) => {
  const dirs = await folders(context);
  // The project given as a link: the sandbox's mount follows it, so its mark isn't where the folder is.
  const link = path.join(dirs.root, "link");
  await symlink(path.join(dirs.root, "other"), link);
  const result = await inSandbox({ ...dirs, project: link }, "echo ran > ran.txt", { checkMs: 1500 });
  assert.equal(result.killed, "folders");
  assert.equal(existsSync(path.join(dirs.root, "other", "ran.txt")), false, "the tool never ran");
  assert.deepEqual(await leftovers(), []);
});

test("a tool's sign-in runs in a sandbox of its own, on a terminal, with no project", { skip }, async (context) => {
  const dirs = await folders(context);
  // `script` gives runsc a terminal, as the window on a computer's screen does; the tool's own is
  // its controlling terminal (/dev/tty), which a sign-in's prompts read.
  const result = await inSandbox({ ...dirs, project: null }, "[ -t 0 ] && { : < /dev/tty; } 2>/dev/null && echo on-a-terminal; pwd; echo \"files=$(find /files -mindepth 1 -not -type d 2>/dev/null | wc -l)\"", {
    terminal: (argv) => ["script", "-qec", argv.map((part) => `'${part.replaceAll("'", "'\\''")}'`).join(" "), "/dev/null"]
  });
  assert.equal(result.exitCode, 0, result.output);
  assert.match(result.output, /on-a-terminal\r?\n\/profile\/\.coding\r?\nfiles=0\r?\n/u, "none of the bot's files");
});

test("a run's window follows the log this server writes into a sandbox from outside", { skip }, async (context) => {
  // As a run's window does in the computer's sandbox: the log is in a folder the sandbox is given,
  // and what this server adds once the window has started shows too.
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), "mb-follow-")));
  context.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, "run.log"), "first\n");
  let output = "";
  let added = false;
  let shown;
  const second = new Promise((resolve) => (shown = resolve));
  const job = await runSandboxed({
    env: process.env,
    place: sandboxPlace("follow"),
    spec: sandboxSpec({
      runtimeEnv: process.env,
      args: [...FOLLOW_LOG, "/io/run.log"],
      cwd: "/",
      env: ["PATH=/usr/bin:/bin"],
      limits: { processes: 64, openFiles: 256, fileSize: 1024 ** 2, processMemory: 0, scratch: "16m" },
      rootReadOnly: true,
      mounts: [folderMount(dir, "/io", { readonly: true })]
    }),
    maxSeconds: 10,
    memory: 1024 ** 3,
    onOutput: (text) => {
      output += text;
      if (!added && output.includes("first\n")) {
        added = true;
        appendFile(path.join(dir, "run.log"), "second\n").catch(() => {});
      }
      if (output.includes("second\n")) shown();
    }
  });
  await Promise.race([second, job.done]);
  await job.kill("stopped");
  await job.done;
  assert.equal(output, "first\nsecond\n");
});

