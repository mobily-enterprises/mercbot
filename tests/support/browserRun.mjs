// How many workers a browser run gets (playwright.config.mjs), which its whole-run bound follows. Playwright resolves
// its workers only after the config is read, so the config reads them as Playwright will: the command line's first,
// then its own.
import os from "node:os";
import process from "node:process";
import { browserTestWorkers } from "@jskit-ai/jskit-catalog/browser-tests";

/** A --workers value as Playwright reads it: a count, or a share of the CPUs ("50%"), at least one. */
function workersValue(value) {
  const text = String(value ?? "").trim();
  if (/^\d+%$/u.test(text)) return Math.max(1, Math.floor((os.cpus().length * Number.parseInt(text, 10)) / 100));
  if (/^[1-9]\d*$/u.test(text)) return Number(text);
  throw new Error(`Give --workers a number of workers or a percentage, not ${text || "nothing"}.`);
}

/**
 * The run's workers: 1 under --debug or --pause, as Playwright runs them, else the command line's --workers
 * (--workers=N, --workers N, -j N or -jN), else the config's own (JSKIT's browserTestWorkers()): 1 for Vibe64's
 * managed target, otherwise half the machine's test budget, as each worker drives a browser and its own app server.
 * @param {{ argv?: ReadonlyArray<string>, managed?: boolean, env?: Record<string, string | undefined> }} [options]
 */
export function runWorkers({ argv = process.argv, managed = false, env = process.env } = {}) {
  const args = argv.slice(2);
  if (args.some((arg) => arg === "--pause" || arg === "--debug" || arg.startsWith("--debug="))) return 1;
  for (let index = 0; index < args.length; index += 1) {
    const match = /^(?:--workers(?:=(.*))?|-j(.+)?)$/u.exec(args[index]);
    if (match) return workersValue(match[1] ?? match[2] ?? args[index + 1]);
  }
  return managed ? 1 : browserTestWorkers({ env, argv });
}
