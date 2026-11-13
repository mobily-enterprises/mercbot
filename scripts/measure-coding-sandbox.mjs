// Development only (D-77): what a coding run's own gVisor sandbox weighs on this machine. Starts
// idle sandboxes (the "tool" waits) and times each from the call to the tool's first line, then reads
// the memory of the sandbox's processes (runsc's own, the gofer, the sentry and the stubs its programs
// run in, whose memory is a file they share: so PSS, each shared page counted once) and gVisor's own
// count (sandboxMemory, what the 3 GB limit reads), first idle and then with Claude Code's and Codex's
// own processes started. No account and no AI: each tool is started on a stand-in address
// inside the sandbox that accepts its request and never answers, so it stays waiting.
// Usage: MERCBOT_TOOLS_DIR=/opt/mercbot-tools node scripts/measure-coding-sandbox.mjs
import { mkdir, mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { startCodingSandbox } from "../packages/computer/src/server/codingSandbox.js";
import { sandboxMemory } from "../packages/files/src/server/gvisor.js";

const ROUNDS = Number(process.env.ROUNDS) || 5;
const MiB = 1024 * 1024;
// Accepts connections on 127.0.0.1:8099 and never answers: the tools' AI address here.
const SILENT = "python3 -c 'import socket, time; s = socket.socket(); s.bind((\"127.0.0.1\", 8099)); s.listen(16); time.sleep(3600)' &";
const TOOLS = {
  idle: "echo up; exec sleep 600",
  "claude-code": `${SILENT} echo up; ANTHROPIC_BASE_URL=http://127.0.0.1:8099 ANTHROPIC_API_KEY=stand-in CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 ` +
    "IS_SANDBOX=1 DISABLE_AUTOUPDATER=1 exec /opt/coding/node_modules/.bin/claude -p 'Say hello.' --dangerously-skip-permissions",
  codex: `${SILENT} echo up; OPENAI_BASE_URL=http://127.0.0.1:8099/v1 OPENAI_API_KEY=stand-in CODEX_API_KEY=stand-in ` +
    "exec /opt/coding/node_modules/.bin/codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check 'Say hello.'"
};
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/**
 * This process's sandboxes' processes and their children: { pid, name, rss, pss, anon, file, shmem }
 * (kB → bytes). PSS by kind: `shmem` is gVisor's memory file (the programs' memory and files kept in
 * memory), `anon` its processes' own, `file` the host's cached files they map (the tools' programs
 * among them), shared with every sandbox running the same and given back when memory is short.
 */
async function sandboxProcesses() {
  const pids = (await readdir("/proc")).filter((name) => /^\d+$/u.test(name));
  const parents = new Map();
  const ours = [];
  for (const pid of pids) {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => "");
    parents.set(pid, stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
    const cmdline = await readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => "");
    if (cmdline.includes(`${process.pid}-mb-coding-`)) ours.push(pid);
  }
  const members = new Set(ours);
  for (let grew = true; grew;) {
    grew = false;
    for (const [pid, parent] of parents) {
      if (members.has(parent) && !members.has(pid)) {
        members.add(pid);
        grew = true;
      }
    }
  }
  const found = [];
  for (const pid of members) {
    const rollup = await readFile(`/proc/${pid}/smaps_rollup`, "utf8").catch(() => "");
    const kb = (field) => Number(new RegExp(`^${field}:\\s+(\\d+) kB`, "mu").exec(rollup)?.[1] || 0) * 1024;
    const args = (await readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => "")).split("\0");
    const name = !ours.includes(pid) ? "stub" : args.includes("boot") ? "sentry" : args.includes("gofer") ? "gofer" : args.includes("run") ? "runsc run" : args[0];
    found.push({ pid: Number(pid), name, rss: kb("Rss"), pss: kb("Pss"), anon: kb("Pss_Anon"), file: kb("Pss_File"), shmem: kb("Pss_Shmem") });
  }
  return found;
}

/** The running sandbox of this process's (one at a time here): { id, state }. */
async function sandboxPlace() {
  const root = path.join(os.tmpdir(), "mercbot-shell");
  const name = (await readdir(root)).find((entry) => entry.startsWith(`${process.pid}-mb-coding-`));
  return name && { id: name.slice(`${process.pid}-`.length), state: path.join(root, name, "state") };
}

async function measure(tool, dirs) {
  let output = "";
  let up;
  const isUp = new Promise((resolve) => (up = resolve));
  const started = performance.now();
  const job = await startCodingSandbox({
    runtimeEnv: process.env,
    home: dirs.home,
    project: { source: dirs.project, destination: "/files/mine/project" },
    argv: ["/bin/bash", "-c", TOOLS[tool]],
    env: ["HOME=/profile/.coding", "XDG_CONFIG_HOME=/profile/.coding/.config", "NO_COLOR=1"],
    maxSeconds: 120,
    onOutput: (text) => {
      output += text;
      if (/^up$/mu.test(output)) up(performance.now() - started);
    }
  });
  const startMs = await Promise.race([isUp, job.done.then(() => null)]);
  // The memory once it has settled: the most seen over a few seconds.
  let peak = [];
  let counted = 0;
  const place = await sandboxPlace();
  for (let sample = 0; sample < (tool === "idle" ? 3 : 10); sample += 1) {
    await delay(1000);
    const now = await sandboxProcesses();
    if (now.reduce((sum, p) => sum + p.pss, 0) > peak.reduce((sum, p) => sum + p.pss, 0)) peak = now;
    counted = Math.max(counted, (place && await sandboxMemory(process.env, place)) || 0);
  }
  await job.kill("stopped");
  const ended = await job.done;
  return { startMs, processes: peak, counted, output: output.slice(-600), killed: ended.killed };
}

const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "mb-measure-coding-")));
const dirs = { project: path.join(root, "project"), home: path.join(root, "coding") };
await mkdir(dirs.project);
await mkdir(dirs.home);
try {
  const starts = [];
  let idle = null;
  for (let round = 0; round < ROUNDS; round += 1) {
    idle = await measure("idle", dirs);
    starts.push(idle.startMs);
  }
  const report = { rounds: ROUNDS, startMs: { median: Math.round(median(starts)), min: Math.round(Math.min(...starts)), max: Math.round(Math.max(...starts)) } };
  const describe = (measured) => {
    const byName = {};
    for (const p of measured.processes) {
      byName[p.name] ||= { count: 0, pss: 0 };
      byName[p.name].count += 1;
      byName[p.name].pss += p.pss;
    }
    const total = (field) => Math.round(measured.processes.reduce((sum, p) => sum + p[field], 0) / MiB);
    return {
      totalPssMiB: total("pss"),
      pssByKindMiB: { memoryFile: total("shmem"), own: total("anon"), hostFiles: total("file") },
      gvisorCountMiB: Math.round(measured.counted / MiB),
      byProcess: Object.entries(byName).map(([name, { count, pss }]) => `${name} ×${count} pss ${Math.round(pss / MiB)} MiB`)
    };
  };
  report.idle = describe(idle);
  for (const tool of ["claude-code", "codex"]) {
    const measured = await measure(tool, dirs);
    report[tool] = { ...describe(measured), outputEnd: measured.output };
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
