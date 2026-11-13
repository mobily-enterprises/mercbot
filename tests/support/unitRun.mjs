// The unit suite's run (npm test) and its coarse bounds (testRun.mjs). Measured on a busy test
// machine at two files at a time: the slowest file (viteStartup.test.js, a cold Vite start) 3–10 s;
// the suite 8–31 s. The server smoke test runs in the database suite: a server reads its database
// as it starts.
import { testRun } from "./testRun.mjs";

const run = testRun({ suite: "unit", fileBoundSeconds: 40, suiteBoundSeconds: 150 });
export const { globalSetup } = run;

/**
 * How many of the Mercbot team's bot templates are "Not tested yet" for how bots behave now (D-79), as a warning: the
 * real check needs real AI, which a test run doesn't have, so it never fails the run.
 */
async function templatesWarning() {
  const { behaviourFingerprint, readResults, untestedCount } = await import("../../packages/bots/src/server/templateResults.js");
  const { GALLERY } = await import("../../packages/bots/src/server/templates.js");
  const behaviour = behaviourFingerprint();
  const { total, untested, failed } = untestedCount(GALLERY, readResults(), behaviour);
  if (!untested) return null;
  return `Warning: ${untested} of the Mercbot team's ${total} bot templates are Not tested yet for how bots behave now ` +
    `(fingerprint ${behaviour})${failed ? `, ${failed} of them failing their newest check` : ""}. After changing bot ` +
    "behaviour, run npm run check:templates before publishing (D-79).";
}

export async function globalTeardown() {
  try {
    await run.globalTeardown();
  } finally {
    const warning = await templatesWarning();
    if (warning) console.warn(warning);
  }
}
