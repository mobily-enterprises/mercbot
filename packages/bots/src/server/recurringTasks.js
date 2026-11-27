import { jobSchedule } from "@local/apps/shared";
import { createCallerReaders } from "./records/recordRows.js";
import { FAILURES_BEFORE_PAUSE } from "./runLease.js";

// A home's recurring tasks in one place (D-132): every routine and watch in the chats the person can open, and every
// scheduled app job, each with its bot, where it runs, when in words, its last and next run, its state and what it cost
// in the last 30 days, as far as the person may see it. Pausing, resuming and deleting stay with each kind's own routes
// and rules; this only says which of them the person may use (`can`). Owners and admins also see how many tasks run in
// chats they can't open, and what those cost, without their names.


/** What a watch, or a job watching a table, runs on, in words: its records "are added", "change", or both. */
const changesOn = (on) => ({ create: "are added", update: "change" })[on] || "are added or change";

export { jobSchedule };

/** An app's job's name as people read it, from its key: "sync_latest_weight" is "Sync latest weight". */
export function jobName(key) {
  const words = String(key || "").replace(/[_-]+/gu, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "A job";
}

/** When a watch runs, in words. */
export function watchSchedule(watch) {
  return `When ${watch.table} records ${changesOn(watch.on)}${watch.condition ? ", if they match" : ""}`;
}

/**
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records
 * @param {ReturnType<typeof import("./chatRoutines.js").createChatRoutines>} dependencies.routines
 * @param {import("@local/apps/server/types").Apps} dependencies.apps
 * @param {import("@local/account/server/types").Meter} dependencies.meter
 * @param {(reason: string) => object} dependencies.systemContext the bots' system context
 */
export function createRecurringTasks({ records, routines, apps, meter, systemContext }) {
  const { personOf } = createCallerReaders();

  /** The cost of each task the reader may see, by "kind:id". */
  async function costsOf(homeId, reader) {
    const rows = await meter.taskCosts(String(homeId), reader);
    return new Map(rows.map((row) => [`${row.kind}:${row.id}`, row]));
  }

  /** A task's cost and runs, nothing for one that ran for nothing yet, or null when the person can't see its cost. */
  const costOf = (costs, kind, id, visible) => {
    const row = costs.get(`${kind}:${id}`);
    if (row) return { nano: row.spentNano, runs: row.runs };
    return visible ? { nano: 0, runs: 0 } : null;
  };

  /**
   * For owners and admins: how many routines and watches run in chats they can't open, and what those cost, and what
   * tasks since removed cost. Two reads of the whole home, as the system.
   */
  async function unseen(homeId, listed, costs) {
    const system = { context: systemContext("count a home's recurring tasks in chats its owners and admins can't open").forWorkspace(String(homeId)) };
    const [routineIds, watchIds] = await Promise.all([records.work.routineIdsOfHome(system), apps.watches.idsOfHome(system)]);
    const all = new Set([...routineIds.map((id) => `routine:${id}`), ...watchIds.map((id) => `watch:${id}`)]);
    const hidden = [...all].filter((key) => !listed.has(key));
    const sum = (keys) => keys.reduce((total, key) => total + (costs.get(key)?.spentNano || 0), 0);
    const removed = [...costs.keys()].filter((key) => !all.has(key));
    return { count: hidden.length, costNano: sum(hidden), removedNano: sum(removed) };
  }

  /**
   * The home's recurring tasks the person may see (D-132), each with what they may do with it.
   * @param {{ homeId: string, reader: { userId: string, manages: boolean } }} where the home, and who reads its costs
   * @param {object} options the person's call options
   */
  async function list({ homeId, reader }, options) {
    const person = personOf(options);
    const [shownRoutines, watches, scripts, faces, costs] = await Promise.all([
      routines.routinesOfHome(options),
      apps.watches.list({}, options),
      apps.scripts.overview({ kind: "job" }, options),
      records.directory.homeBotFaces(options),
      costsOf(homeId, reader)
    ]);
    const watchChats = watches.map((watch) => watch.chatId).filter(Boolean);
    const { chatOf } = await routines.places(watchChats, watches.map((watch) => watch.botId).filter(Boolean), options);
    const botOf = new Map(faces.map((bot) => [bot.id, bot]));
    const bot = (id) => {
      const face = botOf.get(String(id));
      return face ? { id: face.id, name: face.name, color: face.color, shape: face.shape, archived: face.archived } : null;
    };

    const tasks = [
      ...shownRoutines.map((routine) => {
        const failing = !routine.enabled && routine.failures >= FAILURES_BEFORE_PAUSE;
        return {
          kind: "routine",
          id: routine.id,
          name: routine.name,
          bot: bot(routine.botId),
          where: { chatId: routine.chatId, chatTitle: routine.chatTitle },
          schedule: routine.once ? `Once: ${routine.schedule}` : routine.schedule,
          nextRunAt: routine.enabled ? routine.nextRunAt : null,
          lastRunAt: routine.lastRunAt,
          state: routine.enabled ? "running" : failing ? "failing" : "paused",
          why: failing ? `Paused after ${routine.failures} failed runs in a row` : null,
          madeByYou: routine.madeBy === person,
          cost: costOf(costs, "routine", routine.id, reader.manages || routine.madeBy === person),
          // Edit and resume are its maker's, neither its chat nor its bot archived (canResume), as in its chat's details.
          can: { pause: routine.enabled, resume: !routine.enabled && routine.canResume, edit: routine.canResume, delete: true }
        };
      }),
      ...watches.filter((watch) => watch.chatId && chatOf.has(watch.chatId)).map((watch) => ({
        kind: "watch",
        id: watch.id,
        name: watch.name,
        bot: bot(watch.botId),
        where: { chatId: watch.chatId, chatTitle: chatOf.get(watch.chatId).title },
        schedule: watchSchedule(watch),
        nextRunAt: null,
        lastRunAt: watch.lastRunAt,
        state: watch.enabled ? "running" : watch.pausedByLimit ? "failing" : "paused",
        why: watch.pausedByLimit ? "Paused after firing more than 30 times in an hour" : null,
        madeByYou: watch.canResume,
        cost: costOf(costs, "watch", watch.id, reader.manages || watch.canResume),
        can: { pause: watch.enabled, resume: !watch.enabled && watch.canResume, edit: false, delete: true }
      })),
      ...scripts.map((script) => {
        const failed = script.lastRun ? !script.lastRun.ok : false;
        return {
          kind: "job",
          id: script.id,
          key: script.key,
          name: jobName(script.key),
          detail: script.summary,
          bot: null,
          where: { appSlug: script.app.slug, appName: script.app.name },
          schedule: jobSchedule(script.settings),
          nextRunAt: script.enabled ? script.nextRunAt : null,
          lastRunAt: script.lastRun?.at ?? null,
          state: !script.enabled ? "paused" : failed ? "failing" : "running",
          why: script.enabled && failed ? "Its last run failed" : null,
          madeByYou: false,
          // A script runs without AI: it costs nothing to count.
          cost: null,
          can: { pause: reader.manages && script.enabled, resume: reader.manages && !script.enabled, edit: false, delete: false }
        };
      })
    ];
    const listed = new Set(tasks.filter((task) => task.kind !== "job").map((task) => `${task.kind}:${task.id}`));
    const others = reader.manages ? await unseen(homeId, listed, costs) : null;
    // What tasks no longer listed cost: removed ones, and for a member, their own in chats they can no longer open.
    const notListedNano = others ? others.removedNano
      : [...costs.entries()].filter(([key]) => !listed.has(key)).reduce((total, [, row]) => total + row.spentNano, 0);
    return {
      tasks,
      // What the person sees costs of: the whole home's, or only the tasks that run as them.
      costScope: reader.manages ? "home" : "own",
      others: others && others.count ? { count: others.count, costNano: others.costNano } : null,
      notListedNano
    };
  }

  return Object.freeze({ list });
}
