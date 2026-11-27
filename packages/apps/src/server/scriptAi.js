import { resolveAuditActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { passedOn } from "@jskit-ai/resource-runtime/server";
import { publishIn } from "@local/notices/server/publishIn";
import { isFileField } from "../shared/formulas.js";
import { personCallFor, refused } from "./scriptConnected.js";

// Bots and pictures for scripts (D-136): `ai.bots()`, `ai.work(...)` and `ai.picture(...)`, for a button's and a job's
// scripts (a screen's would spend on every view), when the app's owners and admins allowed "AI: bots and pictures"
// ("ai" in its connected apps). They only queue work as app jobs, which the bots' runner does as the run's person (as
// connected apps are used) through the home's meter: `ai_batch`, items a bot answers in one session, each answer
// written into a field of the item's record; `ai_picture`, a picture made into a record's files field. A draft's
// preview queues nothing.
export const AI_LIMITS = Object.freeze({
  items: 100,
  itemChars: 8000,
  taskChars: 2000,
  batchesAtOnce: 3,
  worksPerRun: 1,
  picturesPerRun: 5
});
const PROMPT_CHARS = 2000;
// A field an answer is written into: text.
const ANSWER_TYPES = new Set(["text", "longtext"]);

/**
 * @param {object} dependencies
 * @param {Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>} dependencies.resources
 *   AppsFeature's handles: apps and appJobs.
 * @param {import("@jskit-ai/resource-runtime/server/types").SystemContext} dependencies.systemContext
 * @param {import("./types.js").Registry} dependencies.registry
 * @param {(options: object) => Promise<Array<{ id: string, name: string, archived: boolean, main: boolean }>>}
 *   dependencies.homeBots the home's bots, which is its main one
 */
export function createScriptAi({ resources, systemContext, registry, homeBots }) {
  const { apps: appRows, appJobs } = resources;

  /** The bot a script names: "default" (or none) is the home's main bot; else one by name. Archived refuses. */
  async function botNamed(wanted, options) {
    const bots = await homeBots(options);
    const name = String(wanted || "default").trim().toLowerCase();
    const bot = name === "default" ? bots.find((entry) => entry.main) : bots.find((entry) => entry.name.toLowerCase() === name);
    if (!bot) throw refused(name === "default" ? "this home has no main bot to do the work" : `there's no bot called ${wanted} in this home`);
    if (bot.archived) throw refused(`${bot.name} is archived, so it can't take work until someone resumes it`);
    return bot;
  }

  /** A table of the home by key, with a live field the work writes into. */
  function fieldOf(tables, tableKey, fieldKey, wanted, what) {
    const table = tables.find((entry) => !entry.obsolete && entry.key === String(tableKey));
    if (!table) throw refused(`there's no table "${tableKey}"`);
    const field = table.fields.find((entry) => !entry.obsolete && entry.key === String(fieldKey));
    if (!field || !wanted(field)) throw refused(`${table.label} has no ${what} field "${fieldKey}"`);
    return { table, field };
  }

  /**
   * The host's `ai` calls for one run of `script` (its row: kind, workspaceId, runsAsUserId), for a button's or a job's
   * script: `bots`, `work` and `picture`.
   * @param {{ options: object, actor: object, via: { appId: string, script: string }, visitor?: object,
   *   practice?: { simulated: object[] } }} ctx
   * @param {{ kind: string, workspaceId: string, runsAsUserId?: string | null }} script
   */
  function forRun(ctx, script) {
    let app = null;
    let works = 0;
    let pictures = 0;
    /** The app, read once a run, refused unless its owners and admins allowed bots and pictures. */
    async function allowedApp() {
      app ||= await appRows.get(ctx.via.appId, { fields: ["id", "name", "connectedAccess"] }, passedOn(ctx.options));
      if (!(app.connectedAccess || []).includes("ai")) {
        throw refused("this app may not use bots and pictures: the home's owners and admins allow them in the app's Logic tab");
      }
      return app;
    }

    /**
     * Queues one job as the run's person, waking a runner on any server: in the run's transaction (D-140), so a run
     * that fails queues nothing.
     */
    async function queue(call, job) {
      return appJobs.withTransaction({ ...ctx.txOptions, ...passedOn(call) }, async (txOptions) => {
        const created = await appJobs.create(job, { ...txOptions, returning: "id" });
        await publishIn(txOptions, "apps-jobs", "all", {});
        return String(created);
      });
    }

    async function work(call, { bot: wantedBot, task, items, into } = {}) {
      if ((works += 1) > AI_LIMITS.worksPerRun) throw refused(`at most ${AI_LIMITS.worksPerRun} ai.work a run`);
      const text = String(task || "").trim();
      if (!text || text.length > AI_LIMITS.taskChars) throw refused(`the task is 1 to ${AI_LIMITS.taskChars} characters`);
      if (!Array.isArray(items) || !items.length || items.length > AI_LIMITS.items) {
        throw refused(`items is a list of 1 to ${AI_LIMITS.items} { record: { table, id }, text }`);
      }
      const tables = await registry.loadTables(ctx.options);
      const steps = items.map((item, index) => {
        const itemText = String(item?.text ?? "");
        if (itemText.length > AI_LIMITS.itemChars) throw refused(`item ${index + 1}'s text is over ${AI_LIMITS.itemChars} characters`);
        const { table } = fieldOf(tables, item?.record?.table, into, (field) => ANSWER_TYPES.has(field.type), "text");
        if (!item?.record?.id) throw refused(`item ${index + 1} names no record id`);
        return { table: table.key, id: String(item.record.id), text: itemText, into: String(into), done: false };
      });
      const bot = await botNamed(wantedBot, call);
      const { id: appId, name } = await allowedApp();
      const [{ busy = 0 } = {}] = await appJobs.aggregate(
        { filters: { appId, batchActive: true }, measures: { busy: { count: "*" } } },
        passedOn(call)
      );
      if (Number(busy) >= AI_LIMITS.batchesAtOnce) {
        throw refused(`this app already has ${AI_LIMITS.batchesAtOnce} batches for a bot waiting or running: try again once one is done`);
      }
      if (ctx.practice) {
        ctx.practice.simulated.push({ ai: { bot: bot.name, items: steps.length }, script: ctx.via.script });
        return { simulated: true };
      }
      const person = personOf(call);
      const batch = await queue(call, {
        kind: "ai_batch",
        appId,
        botId: bot.id,
        userId: person,
        title: `${name}: ${text.split("\n")[0]}`.slice(0, 200),
        prompt: text,
        steps
      });
      return { batch, queued: steps.length, bot: bot.name };
    }

    async function picture(call, { prompt, into } = {}) {
      if ((pictures += 1) > AI_LIMITS.picturesPerRun) throw refused(`at most ${AI_LIMITS.picturesPerRun} ai.picture a run`);
      const text = String(prompt || "").trim();
      if (!text || text.length > PROMPT_CHARS) throw refused(`the prompt is 1 to ${PROMPT_CHARS} characters`);
      const tables = await registry.loadTables(ctx.options);
      const { table, field } = fieldOf(tables, into?.table, into?.field, isFileField, "file or picture");
      if (!into?.id) throw refused("into names no record id");
      const { id: appId, name } = await allowedApp();
      if (ctx.practice) {
        ctx.practice.simulated.push({ ai: { picture: text.slice(0, 80) }, script: ctx.via.script });
        return { simulated: true };
      }
      const bot = await botNamed("default", call);
      const job = await queue(call, {
        kind: "ai_picture",
        appId,
        botId: bot.id,
        userId: personOf(call),
        title: `${name}: a picture`,
        prompt: text,
        steps: [{ table: table.key, id: String(into.id), into: field.key, done: false }]
      });
      return { picture: job };
    }

    return async (name, args) => {
      const call = personCallFor(systemContext, ctx, script, "bots and pictures");
      if (name === "bots") {
        await allowedApp();
        return (await homeBots(call)).filter((bot) => !bot.archived).map((bot) => ({ name: bot.name, isMain: bot.main }));
      }
      if (name === "work") return work(call, args[0]);
      return picture(call, args[0]);
    };
  }

  /**
   * The app's newest AI work for its Logic tab: each batch or picture with its state, how many items are done of how
   * many, and why it failed. One read, of the app's own jobs only (ix_app_jobs_app).
   */
  async function listFor(appId, options) {
    const jobs = await appJobs.queryAll(
      { filters: { appId }, sort: ["-id"], take: 20 },
      { ...passedOn(options), fields: ["id", "kind", "title", "status", "steps", "error", "createdAt", "finishedAt"] }
    );
    return jobs.map((job) => ({
      id: String(job.id),
      kind: job.kind,
      title: job.title,
      status: job.status,
      done: (job.steps || []).filter((item) => item.done).length,
      total: (job.steps || []).length,
      error: job.error || null,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt || null
    }));
  }

  return Object.freeze({
    forRun,
    listFor
  });
}

/** The person of a call, as the job keeps them: the member's, or the one a job's run is for. */
const personOf = (call) => String(resolveAuditActorId(call?.context) ?? "");
