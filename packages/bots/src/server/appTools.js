import { createTool } from "@jskit-ai/agent/server";
import { z } from "zod";
import {
  NeedsAttention,
  celSchema,
  checkCalculated,
  compileWhere,
  dataOnly,
  fieldByNames,
  isCalculated,
  planToIds,
  refersToRemovedField,
  storedFieldIds
} from "@local/apps/shared";
import { buildBuilderTools } from "./builderTools.js";
import { buildViewTools } from "./viewTools.js";

// Apps tools (D-35). Every bot works with the home's records through the data gate, audited as
// that bot. The home's Builder also makes tables, fields and apps (builderTools.js); its app
// changes are drafts a person previews and publishes. No tool publishes, removes or deletes.
const MAX_RECORDS = 50;

// The ids a reply must have called before it may say an app, table, field or record changed.
export const APP_ACTIONS = [
  "data_create",
  "data_update",
  "data_mark_obsolete",
  "watch_create",
  "watch_pause",
  "watch_resume",
  "watch_remove",
  "app_create",
  "app_save_draft",
  // Trying a draft saves and changes records in its practice data (D-71).
  "app_try",
  "view_save",
  "template_install",
  "table_create",
  "field_add",
  "field_rename",
  "field_formula",
  "field_remove",
  "script_write",
  "script_save",
  "script_remove"
];

/**
 * The apps tools a bot gets in one turn.
 * @param {object} turn
 * @param {import("@local/apps/server/types").Apps} turn.apps
 * @param {import("./types.js").BotDirectory} turn.directory records.directory
 * @param {import("./types.js").CallOptions} turn.call the turn's call options, which every gate ctx carries (ctx.options)
 * @param {string} turn.botId
 * @param {string | null} turn.conversationId
 * @param {string | null} turn.userId
 * @param {boolean} turn.isBuilder
 * @param {object[]} turn.after the messages the reply adds after its text (draft and removal cards)
 * @param {string[]} turn.attempted the ids of the tools the reply has called
 * @param {{ kind: string } | null} turn.via where the bot is working when not in chat (a watch run, a button's
 *   task), for the audit
 * @param {(prompt: string) => Promise<object>} turn.scriptModel asks for a script and its tests: writeScriptRound with the chat
 *   model (tests pass a model stand-in)
 */
export function buildAppTools({
  apps,
  directory,
  call,
  botId,
  conversationId,
  userId,
  isBuilder,
  after,
  attempted,
  via,
  scriptModel
}) {
  const { registry, gate, watches } = apps;
  let actorCache = null;
  async function actor() {
    actorCache ??= await directory.findBot(String(botId), call)
      .then((bot) => ({ type: "bot", id: String(botId), name: bot?.name || "A bot" }));
    return actorCache;
  }
  const ctx = async () => ({ options: call, actor: await actor(), via: via || { kind: "chat", botId: String(botId) } });
  const failed = (error) => ({ error: error?.message || String(error) });


  /** Records by field name, as the bot reads and writes them. */
  function byName(table, record) {
    const out = { id: record.id };
    if (record.obsolete) out.obsolete = true;
    for (const field of table.fields.filter((entry) => !entry.obsolete)) {
      const value = record[field.id];
      out[field.key] = value && typeof value === "object" ? value.label : (value ?? null);
    }
    return out;
  }

  /**
   * Pauses or resumes one of this bot's watches, by name.
   * @param {string} name
   * @param {boolean} enabled
   */
  async function switchWatch(name, enabled) {
    try {
      return { status: enabled ? "resumed" : "paused", watch: await watches.setEnabled({ botId: String(botId), name }, enabled, call) };
    } catch (error) {
      return failed(error);
    }
  }
  async function watchPause({ name }) {
    return switchWatch(name, false);
  }
  async function watchResume({ name }) {
    return switchWatch(name, true);
  }

  async function dataTables() {
    const tables = (await registry.loadTables(call)).filter((table) => !table.obsolete);
    return {
      tables: tables.map((table) => ({
        table: table.key,
        label: table.label,
        fields: table.fields
          .filter((field) => !field.obsolete)
          .map((field) => ({
            name: field.key,
            label: field.label,
            type: field.type,
            ...(field.options?.required ? { required: true } : {}),
            ...(field.options?.choices ? { choices: field.options.choices } : {}),
            ...(field.options?.target ? { linksTo: tables.find((entry) => entry.id === field.options.target)?.key } : {}),
            ...(isCalculated(field) ? calculatedInfo(table, field) : {})
          }))
      }))
    };
  }
  /** A calculated field as data_tables lists it (D-78): its formula by names, and what is wrong with it, if anything. */
  function calculatedInfo(table, field) {
    const named = fieldByNames(table, field);
    // A field it used that was removed stays in it by id, and it shows "—" until its formula changes.
    const error = refersToRemovedField(named.options.formula)
      ? "it uses a field that was removed, so it shows \"—\": change its formula with field_formula."
      : checkCalculated(table, named).error;
    return { calculated: named.options.formula, ...(error ? { needsAttention: error } : {}) };
  }

  /** A calculated field (D-78) among the given names, which a filter or sort can't use: the database doesn't hold it. */
  const calculatedNamed = (table, names) =>
    names.find((name) => isCalculated(table.fields.find((field) => !field.obsolete && field.key === name)));

  async function dataQuery({ table: name, where, sort, limit }) {
    try {
      const context = await ctx();
      const { table } = await gate.tableFor(name, call);
      const keyToId = storedFieldIds(table);
      const sortKey = sort?.replace(/^-/u, "");
      if (calculatedNamed(table, [sortKey])) return { error: `"${sortKey}" is calculated, so records can't be sorted by it.` };
      let plan = null;
      if (where) {
        try {
          plan = {
            plan: planToIds(compileWhere({ ...celSchema(table), state: {}, params: {} }, `=${where}`), keyToId),
            variables: { state: {}, params: {} },
            values: { state: {}, params: {} }
          };
        } catch (error) {
          if (!(error instanceof NeedsAttention)) return { error: error.message };
          const calculated = calculatedNamed(table, [...where.matchAll(/[a-z][a-z0-9_]*/gu)].map(([word]) => word));
          return {
            error: calculated
              ? `"${calculated}" is calculated, so it can't be filtered on: filter on the fields it's worked out from.`
              : "The formula uses a field that doesn't exist."
          };
        }
      }
      const result = await gate.read(context, table.id, {
        where: plan,
        sort: sortKey && keyToId.get(sortKey) ? [{ field: keyToId.get(sortKey), desc: sort.startsWith("-") }] : [],
        page: { size: limit || 20 }
      });
      return { table: table.key, total: result.total, records: dataOnly(result.records.map((record) => byName(table, record))) };
    } catch (error) {
      return failed(error);
    }
  }
  async function dataCreate({ table, values }) {
    try {
      const { table: info } = await gate.tableFor(table, call);
      return { status: "added", record: byName(info, await gate.create(await ctx(), table, values)) };
    } catch (error) {
      return failed(error);
    }
  }
  async function dataUpdate({ table, id, values }) {
    try {
      const { table: info } = await gate.tableFor(table, call);
      return { status: "changed", record: byName(info, await gate.update(await ctx(), table, id, values)) };
    } catch (error) {
      return failed(error);
    }
  }
  async function dataMarkObsolete({ table, id }) {
    try {
      await gate.markObsolete(await ctx(), table, id);
      return { status: "marked obsolete" };
    } catch (error) {
      return failed(error);
    }
  }
  async function watchCreate({ name, table, on, condition, instructions }) {
    try {
      const watch = await watches.create(
        { botId, conversationId, createdBy: userId },
        { name, table, on, condition: condition ? `=${condition.replace(/^=/u, "")}` : null, instructions },
        call
      );
      return { status: "watching", watch };
    } catch (error) {
      return failed(error);
    }
  }
  async function watchList() {
    return { watches: await watches.list({ botId }, call) };
  }
  async function watchRemove({ name }) {
    try {
      return { status: "removed", watch: await watches.remove({ botId: String(botId), name }, call) };
    } catch (error) {
      return failed(error);
    }
  }
  const tools = {
    dataTables: createTool(
      Object.freeze({
        id: "data_tables",
        description: "List this home's tables with their fields (name, type, choices, links). Use before reading or writing records.",
        inputSchema: z.object({}),
        execute: (input, options) => dataTables(input, options)
      })
    ),
    dataQuery: createTool(
      Object.freeze({
        id: "data_query",
        description:
          `Read records of a table, newest page first. Optional where is a formula over field names, e.g. status == "Won" && ` +
          `amount >= 100000.0 (money in cents). At most ${MAX_RECORDS} records.`,
        inputSchema: z.object({
          table: z.string().min(1).max(64),
          where: z.string().max(1000).optional(),
          sort: z.string().max(65).optional().describe("A field name, with - in front for descending"),
          limit: z.number().int().min(1).max(MAX_RECORDS).optional()
        }),
        execute: (input, options) => dataQuery(input, options)
      })
    ),
    dataCreate: createTool(
      Object.freeze({
        id: "data_create",
        description: "Add a record to a table. values are by field name; link fields take the linked record's id; money is in whole cents.",
        inputSchema: z.object({ table: z.string().min(1).max(64), values: z.record(z.string(), z.any()) }),
        execute: (input, options) => dataCreate(input, options)
      })
    ),
    dataUpdate: createTool(
      Object.freeze({
        id: "data_update",
        description: "Change fields of one record. Only the fields given change.",
        inputSchema: z.object({ table: z.string().min(1).max(64), id: z.string().min(1).max(64), values: z.record(z.string(), z.any()) }),
        execute: (input, options) => dataUpdate(input, options)
      })
    ),
    dataMarkObsolete: createTool(
      Object.freeze({
        id: "data_mark_obsolete",
        description: "Mark a record obsolete: it's hidden but kept, and can be restored. Records are never deleted.",
        inputSchema: z.object({ table: z.string().min(1).max(64), id: z.string().min(1).max(64) }),
        execute: (input, options) => dataMarkObsolete(input, options)
      })
    ),
    // Watches: this bot acts by itself when records change, and writes in this chat.
    watchCreate: createTool(
      Object.freeze({
        id: "watch_create",
        description:
          "Watch a table: when records are added (on: create), changed (update) or either (any), and the optional condition holds, you get a run with the changes and do the instructions, writing in this chat. The condition is a formula over row (the record now), before (its values before a change) and changed (names of the changed fields), e.g. row.stage == \"Won\" && \"stage\" in changed. Values typed by public visitors arrive as untrusted text.",
        inputSchema: z.object({
          name: z.string().min(1).max(120),
          table: z.string().min(1).max(64),
          on: z.enum(["create", "update", "any"]),
          condition: z.string().max(1000).optional().describe("A formula without the leading ="),
          instructions: z.string().min(1).max(4000)
        }),
        execute: (input, options) => watchCreate(input, options)
      })
    ),
    watchList: createTool(
      Object.freeze({
        id: "watch_list",
        description: "List your watches in this home.",
        inputSchema: z.object({}),
        execute: (input, options) => watchList(input, options)
      })
    ),
    watchPause: createTool(
      Object.freeze({
        id: "watch_pause",
        description: "Pause one of your watches by name.",
        inputSchema: z.object({ name: z.string().min(1).max(120) }),
        execute: (input, options) => watchPause(input, options)
      })
    ),
    watchResume: createTool(
      Object.freeze({
        id: "watch_resume",
        description: "Resume a paused watch by name; it only sees changes from now on.",
        inputSchema: z.object({ name: z.string().min(1).max(120) }),
        execute: (input, options) => watchResume(input, options)
      })
    ),
    watchRemove: createTool(
      Object.freeze({
        id: "watch_remove",
        description: "Remove one of your watches by name. Its records stay; only the watch goes.",
        inputSchema: z.object({ name: z.string().min(1).max(120) }),
        execute: (input, options) => watchRemove(input, options)
      })
    )
  };

  Object.assign(tools, buildViewTools({ views: apps.views, call, botId, userId, isBuilder, ctx, failed, after }));
  if (isBuilder) Object.assign(tools, buildBuilderTools({ apps, call, actor, ctx, failed, after, scriptModel }));
  return tracked(tools);

  /** Each mutating tool notes that it ran, for the reply check in botsService. */
  function tracked(all) {
    for (const tool of Object.values(all)) {
      if (!APP_ACTIONS.includes(tool.id)) continue;
      const run = tool.execute;
      tool.execute = (...args) => {
        attempted.push(tool.id);
        return run(...args);
      };
    }
    return all;
  }
}
