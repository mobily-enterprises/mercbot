// The database suite's run (npm run test:database): the prepared test template, each file's own
// copy of it, and the coarse bounds (testRun.mjs). Measured on a busy test machine at two files at a
// time: the slowest file 8–22 s (viewsRealUse.integration.js, account-persistence.integration.js),
// the suite 61–100 s.
import { testRun } from "./testRun.mjs";

export const { globalSetup, globalTeardown } = testRun({ suite: "database", fileBoundSeconds: 120, suiteBoundSeconds: 500, databases: true });
