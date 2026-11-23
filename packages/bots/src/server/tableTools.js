import { createTool } from "@jskit-ai/agent/server";
import { z } from "zod";
import { fieldInput } from "./builderTools.js";

// Shared tables for every bot (D-130): a bot keeps records in the home's tables, built on the catalog's shared ones. It
// adds a shared table the home lacks (and the tables it links to) saying so in one line, and asks the person before
// adding fields or a one-to-one extension, which change what everyone in the home sees.

const names = (labels) => (labels.length > 1 ? `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}` : labels[0] || "");

/** The gate's ctx an action runs with: the call it runs in (the turn's, or the approving person's), as the bot that asked. */
const tableCtx = (call, as) => ({ options: call, actor: as, via: { kind: "chat", botId: as.id } });

// The changes a person approves on a card (botActions.js): never by a rule, since they change the home's tables.
export const TABLE_ACTIONS = Object.freeze({
  table_extend: {
    alwaysAsks: true,
    reversible: () => true,
    describe: ({ base, key }) => `add the table "${key}", one row per record of ${base}`,
    question: ({ base, key, label, fields }) =>
      `Shall I add a "${label || key}" table that holds more about each record of ${base}` +
      `${fields.length ? `, with ${names(fields.map((field) => field.label || field.key))}` : ""}?`,
    async run({ apps, call }, args) {
      const extension = { key: args.key, label: args.label, fields: args.fields };
      const { table } = await apps.catalog.ensureExtension(tableCtx(call, args.as), args.base, extension);
      return {
        kind: "event",
        role: "bot",
        body: { text: "Added a table", name: table.label, detail: `Added the table "${table.label}", one row per record of ${args.base}.` },
        result: { table: table.key, fields: table.fields.filter((field) => !field.obsolete).map((field) => field.key) }
      };
    }
  },
  table_field_add: {
    alwaysAsks: true,
    reversible: () => true,
    describe: ({ table, field }) => `add the field "${field.key}" to ${table}`,
    question: ({ table, field }) => `Shall I add a "${field.label || field.key}" field (${field.type}) to ${table}?`,
    async run({ apps, call }, args) {
      const field = await apps.registry.addField(args.as, args.table, args.field, call);
      return {
        kind: "event",
        role: "bot",
        body: { text: "Added a field", name: field.label, detail: `Added the field "${field.label}" to ${args.table}.` },
        result: { table: args.table, field: field.key }
      };
    }
  }
});

/**
 * The shared tables' tools a bot gets in one turn.
 * @param {object} shared
 * @param {import("@local/apps/server/types").Apps} shared.apps
 * @param {import("./types.js").CallOptions} shared.call
 * @param {() => Promise<{ type: string, id: string, name: string }>} shared.actor the bot, as the audit names it
 * @param {() => Promise<object>} shared.ctx the data gate's context for this bot
 * @param {import("./types.js").ToolFailure} shared.failed
 * @param {(text: string) => Promise<void>} shared.postLead a one-line note in the chat
 * @param {(actionId: string, input: object) => Promise<object>} shared.attempt an action on a card the person approves
 */
export function buildTableTools({ apps, call, actor, ctx, failed, postLead, attempt }) {
  const { catalog, registry } = apps;

  async function tableEnsure({ table: name }) {
    const key = catalog.match(name);
    if (!key) {
      const known = catalog.entries().map((entry) => entry.key).join(", ");
      return { error: `"${name}" isn't a shared table. The shared tables are: ${known}. A table of the home's own is the Builder's to make.` };
    }
    try {
      const { table, made } = await catalog.ensureTable(await ctx(), key);
      if (made.length) {
        const labels = (await registry.loadTables(call)).filter((entry) => made.includes(entry.key) && !entry.obsolete);
        const added = labels.find((entry) => entry.key === key)?.label;
        const linked = labels.filter((entry) => entry.key !== key).map((entry) => entry.label);
        await postLead(added
          ? `Added the shared ${added} table${linked.length ? `, linked to ${names(linked)}` : ""}.`
          : `Added the shared ${names(linked)} table${linked.length > 1 ? "s" : ""}, which ${table.label} links to.`);
      }
      return {
        status: made.length ? "added" : "already here",
        table: table.key,
        made,
        fields: table.fields.filter((field) => !field.obsolete).map((field) => ({ name: field.key, type: field.type }))
      };
    } catch (error) {
      return failed(error);
    }
  }

  async function tableExtend({ base, key, label, fields = [] }) {
    try {
      // Refused now, rather than on a card the person would approve for nothing.
      const taken = catalog.match(key);
      if (taken) return { error: catalog.useInstead(taken, key) };
      return await attempt("table_extend", { base, key, label, fields, as: await actor() });
    } catch (error) {
      return failed(error);
    }
  }

  async function tableFieldAdd({ table, field }) {
    try {
      const { table: found } = await apps.gate.tableFor(table, call);
      if (found.fields.some((entry) => !entry.obsolete && entry.key === field.key)) return { error: `${found.label} already has a field "${field.key}".` };
      return await attempt("table_field_add", { table: found.key, field, as: await actor() });
    } catch (error) {
      return failed(error);
    }
  }

  return {
    tableEnsure: createTool(
      Object.freeze({
        id: "table_ensure",
        description:
          "Add one of the home's shared tables (contacts, organisations, to-dos and their lists, departments, places, events, " +
          "graphics, deals...) with the tables it links to, by its name or another word for it (\"tasks\", \"venues\"). Use it " +
          "before keeping records the home has no table for: never keep them in a spreadsheet. A table already here is reused.",
        inputSchema: z.object({ table: z.string().min(1).max(64) }),
        execute: (input, options) => tableEnsure(input, options)
      })
    ),
    tableExtend: createTool(
      Object.freeze({
        id: "table_extend",
        description:
          "Ask the person to add a one-to-one extension of a table: a new table with one row at most per record of `base`, for " +
          "details only some work needs (a contact's sales stage, a place's booking terms). Use it instead of a second copy of a shared table.",
        inputSchema: z.object({
          base: z.string().min(1).max(64).describe("The table it extends, e.g. contacts"),
          key: z.string().min(1).max(64).describe("The extension's name: lowercase letters, digits and _"),
          label: z.string().max(120).optional(),
          fields: z.array(fieldInput).max(40).optional()
        }),
        execute: (input, options) => tableExtend(input, options)
      })
    ),
    tableFieldAdd: createTool(
      Object.freeze({
        id: "table_field_add",
        description: "Ask the person to add a field to one of the home's tables, when the records you keep need one it lacks.",
        inputSchema: z.object({ table: z.string().min(1).max(64), field: fieldInput }),
        execute: (input, options) => tableFieldAdd(input, options)
      })
    )
  };
}
