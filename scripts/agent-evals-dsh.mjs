// Reference results for the shared agent cases (D-48): each case runs through DeepSeek Harness,
// installed outside the app in DSH_DIR (default /tmp/dsh-eval) and run on Node 24, against the same
// model and endpoint as our bots. Usage:
//   node scripts/agent-evals-dsh.mjs [--runs 3] [--only case1,case2] [--label name]
// Needs AI_PREMIUM_API_KEY (Together, D-72) in the environment. Writes traces and summary.md to artifacts/agent-evals/.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const runs = Number(option("runs", 3));
const only = option("only", "")?.split(",").filter(Boolean) || [];
const label = option("label", `dsh-${new Date().toISOString().slice(0, 16).replace(/[:T]/gu, "")}`);
const DSH_DIR = process.env.DSH_DIR || "/tmp/dsh-eval";
const CASES = path.resolve("tests/agent-evals/shared");
const OUT = path.resolve("artifacts/agent-evals", label);
if (!process.env.AI_PREMIUM_API_KEY) throw new Error("AI_PREMIUM_API_KEY is needed.");
mkdirSync(OUT, { recursive: true });

function runCase(name, attempt) {
  const dir = path.join(CASES, name);
  const ws = mkdtempSync(path.join(os.tmpdir(), `eval-${name}-`));
  const judgeDir = mkdtempSync(path.join(os.tmpdir(), `judge-${name}-`));
  if (existsSync(path.join(dir, "files"))) cpSync(path.join(dir, "files"), ws, { recursive: true });
  // Fixture test files are stored as *.fixture so the app's own test run skips them.
  for (const file of readdirSync(ws, { recursive: true }).filter((entry) => entry.endsWith(".fixture"))) renameSync(path.join(ws, file), path.join(ws, file.slice(0, -".fixture".length)));
  if (existsSync(path.join(dir, "hidden"))) cpSync(path.join(dir, "hidden"), judgeDir, { recursive: true });
  if (existsSync(path.join(dir, "setup.py"))) spawnSync("python3", [path.join(dir, "setup.py"), ws, judgeDir], { stdio: "inherit" });
  const prompt = readFileSync(path.join(dir, "prompt.md"), "utf8");
  const started = Date.now();
  const run = spawnSync("npx", ["-y", "-p", "node@24", "node", path.join(DSH_DIR, "node_modules/@deepseek-ai/dsh/lib/bin.js"),
    "--profile", "headless", "--patch", path.join(DSH_DIR, "together.yml"), "--json", "-"], {
    cwd: ws, input: prompt, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 30 * 60 * 1000,
    // DeepSeek Harness reads Together's key under its own name (together.yml).
    env: { ...process.env, TOGETHER_API_KEY: process.env.AI_PREMIUM_API_KEY, DSH_HOME: path.join(DSH_DIR, "home") }
  });
  const seconds = Math.round((Date.now() - started) / 1000);
  writeFileSync(path.join(OUT, `${name}-${attempt}.events.jsonl`), run.stdout || "");
  writeFileSync(path.join(OUT, `${name}-${attempt}.stderr.txt`), run.stderr || "");
  // The judge's files join the workspace only now, so the agent never saw them.
  for (const file of readdirSync(dir).filter((entry) => entry.startsWith("judge"))) cpSync(path.join(dir, file), path.join(ws, file));
  cpSync(judgeDir, ws, { recursive: true });
  const judgeFile = readdirSync(dir).find((entry) => entry.startsWith("judge"));
  const judge = judgeFile.endsWith(".py")
    ? spawnSync("python3", [judgeFile], { cwd: ws, encoding: "utf8", timeout: 120000 })
    : spawnSync("node", ["--test", judgeFile], { cwd: ws, encoding: "utf8", timeout: 120000 });
  const events = (run.stdout || "").split("\n").filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  const toolCalls = events.filter((event) => event.type === "tool_call").length;
  const steps = events.filter((event) => event.type === "status" && event.phase === "step_start").length;
  return {
    name, attempt, pass: judge.status === 0, seconds, exit: run.status, steps, toolCalls,
    judge: `${judge.stdout || ""}${judge.stderr || ""}`.slice(-600), workspace: ws
  };
}

const names = readdirSync(CASES).filter((entry) => !only.length || only.includes(entry));
const results = [];
for (const name of names) {
  for (let attempt = 1; attempt <= runs; attempt += 1) {
    const result = runCase(name, attempt);
    results.push(result);
    console.log(`${name} #${attempt}: ${result.pass ? "PASS" : "FAIL"} in ${result.seconds}s, ${result.steps} steps, ${result.toolCalls} tool calls`);
    writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
  }
}
const lines = ["| case | passed | median s | median steps | median tool calls |", "|---|---|---|---|---|"];
const median = (list) => list.sort((a, b) => a - b)[Math.floor(list.length / 2)];
for (const name of names) {
  const mine = results.filter((result) => result.name === name);
  lines.push(`| ${name} | ${mine.filter((result) => result.pass).length}/${mine.length} | ${median(mine.map((result) => result.seconds))} | ${median(mine.map((result) => result.steps))} | ${median(mine.map((result) => result.toolCalls))} |`);
}
writeFileSync(path.join(OUT, "summary.md"), `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
