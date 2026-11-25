// The browser suite's watch on each Test Preview it started (tests/e2e/globalSetup.mjs). A Test Preview that stops
// after it started and before the teardown stops it (it crashed, or something killed it) would otherwise leave only
// its specs' refused connections: the teardown removes the run's folder, its log with it. So it says so in the suite's
// output, and its log is kept.
import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

/** How much of a stopped Test Preview's log its report shows: enough for a crash's stack. */
const LOG_END_LINES = 40;

/**
 * Watches a started Test Preview until it stops. Stopped while `stopping()` is false, it reports, once, its pid, its
 * exit code or signal, where its log is kept (`kept`, a copy outside the run's folder) and its log's last lines.
 * @param {import("node:child_process").ChildProcess} server
 * @param {{ name: string, log: string, kept: string, stopping: () => boolean, report?: (text: string) => void }} watch
 * @returns {Promise<void>} settled once it stopped and anything it had to say is said, which the teardown awaits before
 *   it removes the run's folder
 */
export function watchTestPreview(server, { name, log, kept, stopping, report = (text) => console.error(text) }) {
  const pid = server.pid;
  return new Promise((resolve) => {
    server.once("exit", (code, signal) => {
      if (stopping()) return resolve();
      const how = signal ? `signal ${signal}` : `exit ${code}`;
      (async () => {
        const where = await mkdir(path.dirname(kept), { recursive: true }).then(() => copyFile(log, kept)).then(
          () => `its log is kept at ${kept}`,
          (error) => `its log couldn't be kept (${error.message})`
        );
        const text = await readFile(kept, "utf8").catch(() => readFile(log, "utf8")).catch(() => "");
        const end = text.trimEnd().split("\n").slice(-LOG_END_LINES).join("\n");
        report(`${name} (pid ${pid}) stopped during the run (${how}); ${where}. The end of its log:\n${end}`);
      })().finally(resolve);
    });
  });
}
