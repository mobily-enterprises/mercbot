// How many workers a browser run gets (playwright.config.mjs), which its whole-run bound follows. Playwright resolves
// its workers only after the config is read, so the config reads them as Playwright will: the command line's first,
// then its own. A browser worker is a browser and a Test Preview, so a test host's runner names them, one per heavy slot
// the run holds (PLAYWRIGHT_WORKERS); its CPU budget (V64_TEST_CONCURRENCY) is the node runners' concurrency, and as
// browser workers it put 8 on a host of 8 threads, each test 6 to 7 times its time alone (26 Nov).
import os from "node:os";
import process from "node:process";
import { testConcurrency } from "@jskit-ai/jskit-catalog/test-budget";

/** A --workers value as Playwright reads it: a count, or a share of the CPUs ("50%"), at least one. */
function workersValue(value, name = "--workers") {
  const text = String(value ?? "").trim();
  if (/^\d+%$/u.test(text)) return Math.max(1, Math.floor((os.cpus().length * Number.parseInt(text, 10)) / 100));
  if (/^[1-9]\d*$/u.test(text)) return Number(text);
  throw new Error(`Give ${name} a number of workers or a percentage, not ${text || "nothing"}.`);
}

/**
 * The browser workers a test host's runner names in PLAYWRIGHT_WORKERS, one per heavy slot the run holds, or null when
 * it names none ("config" leaves them to the config).
 * @param {Record<string, string | undefined>} [env]
 */
export function runnerWorkers(env = process.env) {
  const named = String(env.PLAYWRIGHT_WORKERS ?? "").trim();
  return named && named !== "config" ? workersValue(named, "PLAYWRIGHT_WORKERS") : null;
}

/**
 * The run's workers: 1 under --debug or --pause, as Playwright runs them, else the command line's --workers
 * (--workers=N, --workers N, -j N or -jN), else the config's own: 1 for Vibe64's managed target, else the browser
 * workers a test host's runner names (runnerWorkers()), else the machine's test budget (testConcurrency()).
 * @param {{ argv?: ReadonlyArray<string>, managed?: boolean, env?: Record<string, string | undefined> }} [options]
 */
export function runWorkers({ argv = process.argv, managed = false, env = process.env } = {}) {
  const args = argv.slice(2);
  if (args.some((arg) => arg === "--pause" || arg === "--debug" || arg.startsWith("--debug="))) return 1;
  for (let index = 0; index < args.length; index += 1) {
    const match = /^(?:--workers(?:=(.*))?|-j(.+)?)$/u.exec(args[index]);
    if (match) return workersValue(match[1] ?? match[2] ?? args[index + 1]);
  }
  return managed ? 1 : runnerWorkers(env) ?? testConcurrency({ env });
}
