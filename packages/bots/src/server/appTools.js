import { createTool } from "@jskit-ai/agent/server";
import { z } from "zod";
import {
  NeedsAttention,
  celSchema,
  checkCalculated,
  compileWhere,
  calculatedFormulas,
  calculatedOrder,
  dataOnly,
  fieldByNames,
  isCalculated,
  isRollup,
  planToIds,
  refersToRemovedField,
  rollupByNames,
  storedFieldIds
} from "@local/apps/shared";
import { buildBuilderTools } from "./builderTools.js";
import { buildViewTools } from "./viewTools.js";
import { buildTableTools } from "./tableTools.js";

// Apps tools (D-35). Every bot works with the home's records through the data gate, audited as
// that bot. The home's Builder also makes tables, fields and apps (builderTools.js); its app
// changes are drafts a person previews and publishes. No tool publishes, removes or deletes.
const MAX_RECORDS = 50;

// The ids a reply must have called before it may say an app, table, field or record changed.
export const APP_ACTIONS = [
  "data_create",
  "data_update",
  "data_attach_file",
  "table_ensure",
  "table_extend",
  "table_field_add",
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
  "template_update",
  "table_create",
  "field_add",
  "field_rename",
  "field_formula",
  "field_checks",
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
 * @param {string | null} turn.chatBotId the bot's seat in its chat, whose watches these are (D-112); null for a request's
 *   bot not seated in the asking chat, which has none
 * @param {string | null} turn.userId
 * @param {boolean} turn.isBuilder
 * @param {object[]} turn.after the messages the reply adds after its text (draft and removal cards)
 * @param {string[]} turn.attempted the ids of the tools the reply has called
 * @param {{ kind: string } | null} turn.via where the bot is working when not in chat (a watch run, a button's
 *   task), for the audit
 * @param {(text: string) => Promise<void>} turn.postLead a one-line note in the chat (a shared table added, D-130)
 * @param {(actionId: string, input: object) => Promise<object>} turn.attempt an action on a card the person approves
 * @param {boolean} turn.privateChat whether the turn's chat is private: its own folder's files stay in it (D13), so none
 *   goes onto a record, which the whole home reads
 * @param {(path: string) => Promise<{ real: string, folder: string }>} turn.fileAt one of the bot's files by its path
 *   (/files/...), as its file tools read it, with the folder it really is in ("chat", "bot", "shared" or "db"): refused
 *   when the bot can't read it
 * @param {(prompt: string) => Promise<object>} turn.scriptModel asks for a script and its tests: writeScriptRound with the chat
 *   model (tests pass a model stand-in)
 */
export function buildAppTools({
  apps,
  directory,
  call,
  botId,
  chatBotId,
  userId,
  isBuilder,
  after,
  attempted,
  via,
  fileAt,
  privateChat,
  postLead,
  attempt,
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
  const NO_SEAT = { error: "Watches belong to a bot in a chat, and you're working on a request from a chat you aren't in: say so in your answer." };


  /** A value as the bot reads it: a link or person by its label, a file by its path, tags as their list. */
  function botValue(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value ?? null;
    return value.path ?? value.label;
  }

  /** Records by field name, as the bot reads and writes them. */
  function byName(table, record) {
    const out = { id: record.id };
    if (record.obsolete) out.obsolete = true;
    for (const field of table.fields.filter((entry) => !entry.obsolete)) {
      const value = record[field.id];
      out[field.key] = botValue(value);
    }
    return out;
  }

  /**
   * Pauses or resumes one of this bot's watches, by name.
   * @param {string} name
   * @param {boolean} enabled
   */
  async function switchWatch(name, enabled) {
    if (!chatBotId) return NO_SEAT;
    try {
      return { status: enabled ? "resumed" : "paused", watch: await watches.setEnabled({ chatBotId: String(chatBotId), name }, enabled, call) };
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

  /**
   * The home's tables and how they're linked (D-130): what each links to, what links to it, and the one-to-one
   * extensions that hold more about its records; and the shared tables the home doesn't have yet, for table_ensure.
   */
  async function dataTables() {
    // Only the tables the person the bot works for may read (D-138).
    const gateCtx = await ctx();
    const live = (await registry.loadTables(call)).filter((table) => !table.obsolete);
    const readable = await Promise.all(live.map((table) => gate.canReach(gateCtx, table, "read")));
    const tables = live.filter((_table, index) => readable[index]);
    const links = tables.flatMap((table) => table.fields
      .filter((field) => !field.obsolete && field.type === "link")
      .map((field) => ({
        from: table.key,
        to: tables.find((entry) => entry.id === field.options.target)?.key,
        unique: field.options.unique === true
      })));
    const keys = (list) => [...new Set(list)].filter(Boolean);
    const have = new Set(tables.map((table) => table.key));
    return {
      tables: tables.map((table) => ({
        table: table.key,
        label: table.label,
        linksTo: keys(links.filter((link) => link.from === table.key && link.to !== table.key).map((link) => link.to)),
        linkedFrom: keys(links.filter((link) => link.to === table.key && link.from !== table.key && !link.unique).map((link) => link.from)),
        extendedBy: keys(links.filter((link) => link.to === table.key && link.unique).map((link) => link.from)),
        fields: table.fields
          .filter((field) => !field.obsolete)
          .map((field) => ({
            name: field.key,
            label: field.label,
            type: field.type,
            ...(field.options?.required ? { required: true } : {}),
            ...(field.options?.choices ? { choices: field.options.choices } : {}),
            ...(field.options?.target ? { linksTo: tables.find((entry) => entry.id === field.options.target)?.key } : {}),
            ...(isCalculated(field) ? calculatedInfo(table, field) : {}),
            ...(isRollup(field) ? { rollup: rollupByNames(tables, field) } : {})
          }))
      })),
      sharedTablesToAdd: apps.catalog.entries()
        .filter((entry) => !have.has(entry.key))
        .map((entry) => ({ table: entry.key, label: entry.label, about: entry.description, alsoCalled: entry.aliases }))
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
      // A calculated number sorts when it's arithmetic over number fields, worked out in the database (D-140).
      const sortField = table.fields.find((field) => !field.obsolete && field.key === sortKey);
      const sortExpr = isCalculated(sortField) && ["number", "money"].includes(sortField.type)
        ? calculatedOrder(sortField, celSchema(table), calculatedFormulas(table), keyToId)
        : null;
      if (calculatedNamed(table, [sortKey]) && !sortExpr) return { error: `"${sortKey}" is calculated, so records can't be sorted by it.` };
      let plan = null;
      if (where) {
        try {
          plan = {
            plan: planToIds(compileWhere({ ...celSchema(table), state: {}, params: {} }, `=${where}`, { calculated: calculatedFormulas(table) }), keyToId),
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
        sort: sortExpr
          ? [{ expr: sortExpr, desc: sort.startsWith("-") }]
          : sortKey && keyToId.get(sortKey) ? [{ field: keyToId.get(sortKey), desc: sort.startsWith("-") }] : [],
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
  // A file or picture goes onto a record as a copy in the home's Database files (D-130): the bot's own file stays.
  async function dataAttachFile({ table, id, field, path: wanted }) {
    const privateFile = {
      error: "That file is in this private chat, and a record's files are the whole home's. Copy it to /files/shared with transfer_file first, which asks the person, then attach the copy."
    };
    if (privateChat && /^\/files\/chat(?:\/|$)/u.test(String(wanted))) return privateFile;
    try {
      const { table: info } = await gate.tableFor(table, call);
      // Where the file really is decides, whatever its path says ("..", or a link to the chat's folder).
      const { real, folder } = await fileAt(wanted);
      if (privateChat && folder === "chat") return privateFile;
      const upload = { source: real, name: wanted.split("/").pop(), type: "application/octet-stream" };
      return { status: "attached", record: byName(info, await gate.attachFile(await ctx(), table, id, field, upload)) };
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
    if (!chatBotId) return NO_SEAT;
    try {
      // A watch runs as the person who set it up (R4), in this chat.
      const watch = await watches.create(
        { chatBotId: String(chatBotId), createdBy: userId },
        { name, table, on, condition: condition ? `=${condition.replace(/^=/u, "")}` : null, instructions },
        call
      );
      return { status: "watching", watch };
    } catch (error) {
      return failed(error);
    }
  }
  // Only this chat's watches of this bot: another chat's are that chat's business (R11).
  async function watchList() {
    return { watches: chatBotId ? await watches.list({ chatBotId: String(chatBotId) }, call) : [] };
  }
  async function watchRemove({ name }) {
    if (!chatBotId) return NO_SEAT;
    try {
      return { status: "removed", watch: await watches.remove({ chatBotId: String(chatBotId), name }, call) };
    } catch (error) {
      return failed(error);
    }
  }
  const tools = {
    dataTables: createTool(
      Object.freeze({
        id: "data_tables",
        description:
          "List this home's tables with their fields and links (what each links to, is linked from and is extended by), and the " +
          "shared tables not added yet. Use before reading or writing records, and before keeping anything new: records go in tables.",
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
        description: "Change fields of one record. Only the fields given change. A file or picture field is set with data_attach_file.",
        inputSchema: z.object({ table: z.string().min(1).max(64), id: z.string().min(1).max(64), values: z.record(z.string(), z.any()) }),
        execute: (input, options) => dataUpdate(input, options)
      })
    ),
    dataAttachFile: createTool(
      Object.freeze({
        id: "data_attach_file",
        description:
          "Put one of your files (a /files/... path) on a record's file or picture field. The record keeps its own copy in " +
          "the home's Database files (/files/db/tables/...), which nobody moves; a picture field takes PNG, JPEG, GIF or WebP.",
        inputSchema: z.object({
          table: z.string().min(1).max(64),
          id: z.string().min(1).max(64),
          field: z.string().min(1).max(64),
          path: z.string().min(1).max(1000)
        }),
        execute: (input, options) => dataAttachFile(input, options)
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

  Object.assign(tools, buildTableTools({ apps, call, actor, ctx, failed, postLead, attempt }));
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
