import { passedOn } from "@jskit-ai/resource-runtime/server";
import { isFileField } from "../shared/formulas.js";
import { homeIdOf } from "./callOptions.js";
import { personOf, refused } from "./scriptConnected.js";
import { GateError } from "./validate.js";

// Programs for scripts (D-146): `computer.run({ command, files, recordFiles, seconds, bring, keep })`, for a button's and
// a job's scripts, runs a program on the computer of the app's bot (its own bot, D-144, else the home's main bot): a
// fresh gVisor sandbox of the bots' command line (the files feature's, which plugs in at start), its computation
// recorded as a command's. /work holds the script's files, records' files copied in through the gate as the run, and the
// app's own files (its definition's `computer.files`, the draft's in a preview), read-only in their place. No internet
// unless the app's definition says `computer.internet`. Members only: a public app's visitor never runs one (an app with
// a computer isn't public, check.js). Each run waits for its answer: { exitCode, output, seconds, timedOut, files, kept }.
export const COMPUTER_LIMITS = Object.freeze({
  // A button's person is waiting; a job may train a small model.
  seconds: Object.freeze({ action: 20, job: 300 }),
  perRun: 3,
  recordFiles: 3
});

/** The record a file comes from or goes to: { table, id, field } with a file or picture field, or a refusal. */
function recordPlace(value, what) {
  if (!value?.table || !value?.id || !value?.field) throw refused(`${what} is { table, id, field }: a record and its file field`);
  return { table: String(value.table), id: String(value.id), field: String(value.field) };
}

/** A file's type by its name, for a file kept on a record. */
const typeOf = (name) => (/\.json$/iu.test(name) ? "application/json" : /\.(?:txt|md|csv|py|js)$/iu.test(name) ? "text/plain" : /\.png$/iu.test(name) ? "image/png" : "application/octet-stream");

/**
 * @param {object} dependencies
 * @param {Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>} dependencies.resources
 *   AppsFeature's handles: apps and appVersions.
 * @param {import("./types.js").DataGate} dependencies.gate
 * @param {(options: object) => Promise<Array<{ id: string, name: string, archived: boolean, main: boolean }>>}
 *   dependencies.homeBots the home's bots, which is its main one
 * @param {() => ({ available: () => boolean, run: Function } | null)} dependencies.computer the files feature's programs,
 *   read at call time (null before it plugs in)
 */
export function createScriptComputer({ resources, gate, homeBots, computer }) {
  const { apps: appRows, appVersions } = resources;

  /** The app's own files and whether its programs may reach the internet: its live definition's, its draft's in a preview. */
  async function appComputer(ctx) {
    const app = await appRows.get(ctx.via.appId, { fields: ["id", "botId", "liveVersionId", "draftVersionId"] }, passedOn(ctx.options));
    const versionId = ctx.practice ? app.draftVersionId || app.liveVersionId : app.liveVersionId;
    const version = versionId ? await appVersions.get(String(versionId), { fields: ["definition"] }, passedOn(ctx.options)).catch(() => null) : null;
    const settings = version?.definition?.computer || {};
    return { botId: app.botId, files: settings.files || {}, internet: settings.internet === true };
  }

  /** The bot whose computer runs it: the app's own while it's in the home, else the home's main bot. */
  async function botFor(options, appBotId) {
    const bots = (await homeBots(options)).filter((bot) => !bot.archived);
    const bot = (appBotId && bots.find((entry) => String(entry.id) === String(appBotId))) || bots.find((entry) => entry.main);
    if (!bot) throw refused("this home has no bot whose computer can run it");
    return bot;
  }

  /**
   * The host's `computer` calls for one run of `script` (its row: kind, workspaceId, runsAsUserId), for a button's or a
   * job's script.
   * @param {{ options: object, via: { appId: string, script: string }, visitor?: object, practice?: object }} ctx
   * @param {{ kind: string, workspaceId: string, runsAsUserId?: string | null }} script
   */
  function forRun(ctx, script) {
    let runs = 0;
    let settings = null;
    async function run(request = {}) {
      if (ctx.visitor) throw refused("programs are for the home's people: a public app's visitors can't run them");
      if ((runs += 1) > COMPUTER_LIMITS.perRun) throw refused(`at most ${COMPUTER_LIMITS.perRun} computer.run a run`);
      const most = COMPUTER_LIMITS.seconds[script.kind] ?? COMPUTER_LIMITS.seconds.action;
      const seconds = request.seconds === undefined ? Math.min(10, most) : Number(request.seconds);
      if (!Number.isFinite(seconds) || seconds < 1 || seconds > most) throw refused(`seconds is 1 to ${most} for a ${script.kind === "job" ? "job" : "button"}`);
      const programs = computer();
      if (!programs?.available()) {
        throw new GateError(503, "Apps can't run programs on this server: it has no computer for them (gVisor and its toolbox aren't installed).", { code: "apps_computer_unavailable" });
      }
      const recordFiles = Object.entries(request.recordFiles || {});
      if (recordFiles.length > COMPUTER_LIMITS.recordFiles) throw refused(`at most ${COMPUTER_LIMITS.recordFiles} recordFiles a run`);
      const keeping = Object.entries(request.keep || {}).map(([name, place]) => [name, recordPlace(place, `keep's ${name}`)]);
      for (const [name, place] of keeping) {
        const { table } = await gate.tableFor(place.table, ctx.options);
        if (!table.fields.some((field) => !field.obsolete && field.key === place.field && isFileField(field))) throw refused(`${table.label} has no file field "${place.field}" to keep ${name} in`);
      }
      settings ||= await appComputer(ctx);
      const bot = await botFor(ctx.options, settings.botId);
      const inputs = [];
      for (const [name, place] of recordFiles) {
        const { table, id, field } = recordPlace(place, `recordFiles' ${name}`);
        const file = await gate.recordFile(ctx, table, id, field);
        inputs.push({ name, source: file.real });
      }
      // In a draft's preview the program runs (it changes nothing outside), but nothing is kept on a record.
      const keep = Object.fromEntries(keeping.map(([name, place]) => [name, async (source, size) => {
        if (ctx.practice) {
          ctx.practice.simulated.push({ computer: { keep: name }, script: ctx.via.script });
          return { simulated: true, size };
        }
        await gate.attachFile(ctx, place.table, place.id, place.field, { source, name, type: typeOf(name) });
        return { name, size };
      }]));
      try {
        return await programs.run({
          workspaceId: String(script.workspaceId ?? homeIdOf(ctx.options)),
          botId: bot.id,
          userId: script.kind === "job" ? script.runsAsUserId || null : personOf(ctx.options) || null,
          command: request.command,
          files: request.files || {},
          readOnlyFiles: settings.files,
          inputs,
          seconds,
          internet: settings.internet,
          bring: request.bring || [],
          keep
        });
      } catch (error) {
        if (error?.programRefusal === "unavailable") throw new GateError(503, error.message, { code: "apps_computer_unavailable" });
        if (error?.programRefusal) throw refused(error.message);
        throw error;
      }
    }
    return async (name, args) => {
      if (name !== "run") throw refused(`computer has no ${name}`);
      return run(args[0]);
    };
  }

  return Object.freeze({ forRun });
}
