// The database suite's run (npm run test:database): the prepared test template, each file's own
// copy of it, and the coarse bounds (testRun.mjs). Measured on a busy test machine at two files at a
// time: the slowest file up to 47 s (templateCheck.integration.js). Its files' times summed,
// measured on the test machine usone (six files at a time, 11-24): 474-567 s for 136-137 files,
// and 906-1355 s on the busier desktop at two to four at a time; the bound is five times usone's
// 550 s.
import { testRun } from "./testRun.mjs";

export const { globalSetup, globalTeardown } = testRun({ suite: "database", fileBoundSeconds: 120, summedBoundSeconds: 2750, databases: true });
