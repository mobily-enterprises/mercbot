import { createTool } from "@jskit-ai/agent/server";
import { definitionFrom, definitionInput } from "./viewTools.js";
import { z } from "zod";
import { SCRIPT_GUIDE, writeScript } from "./scriptWriter.js";

// The home's Builder's own apps tools (D-35, D-48), beyond the records and watches every bot has:
// it makes tables, fields, apps and scripts; its app changes are drafts a person previews and
// publishes. It tries its drafts on their practice copy (app_try, D-71), as a person would.
const FIELD_TYPES = ["text", "email", "phone", "choice", "link", "number", "money", "date", "yesno"];
// What a calculated field can't do (D-78), which the Builder tells the person whenever it adds one (owner, 2026-11-12).
const CALCULATED_LIMITS =
  "Lists can't be filtered, sorted or grouped by a calculated field, and a sum or average of one adds up at most 5,000 records: " +
  "tell the person so when you add one. If they will want to filter, sort or group by it, offer a stored field that a rule fills in on save instead.";

const fieldInput = z.object({
  key: z.string().min(1).max(64).describe("Field name: lowercase letters, digits and _ , starting with a letter"),
  label: z.string().max(120).optional().describe("What people see; defaults from the name"),
  type: z.enum(FIELD_TYPES).describe("money is stored in whole cents; date is YYYY-MM-DD; link points to a record of another table"),
  required: z.boolean().optional(),
  choices: z.array(z.string().min(1).max(80)).max(50).optional().describe("For choice fields"),
  target: z.string().max(64).optional().describe("For link fields: the table it points to"),
  formula: z
    .string()
    .max(2000)
    .optional()
    .describe(
      "Makes it a calculated field (text, number, money, date or yesno): a formula over this record's other fields by name, " +
        "e.g. \"=price * quantity\". Never stored or typed in; worked out whenever the record is read. " +
        CALCULATED_LIMITS
    )
});

/**
 * The Builder's tools, given what they share with the rest of the apps tools.
 * @param {object} shared
 * @param {import("@local/apps/server/types").Apps} shared.apps
 * @param {import("./types.js").CallOptions} shared.call the turn's call options: everything in its home
 * @param {() => Promise<{ type: string, id: string, name: string }>} shared.actor the bot, as the audit names it
 * @param {() => Promise<object>} shared.ctx the data gate's context for this bot
 * @param {import("./types.js").ToolFailure} shared.failed
 * @param {object[]} shared.after the messages the reply adds after its text (draft and removal cards)
 * @param {(prompt: string) => Promise<object>} shared.scriptModel asks for a script and its tests
 */
export function buildBuilderTools({ apps, call, actor, ctx, failed, after, scriptModel }) {
  const { registry, gate, apps: appStore, scripts, runtime, trial } = apps;

  /** Each screen's queries run on the saved draft, as its preview runs them (D-48), on its practice copy (D-71). */
  async function screensThatFail(slug, definition) {
    const problems = [];
    for (const [screen, body] of Object.entries(definition?.screens || {})) {
      for (const query of Object.keys(body?.data || {})) {
        try {
          const loaded = await runtime.query(await ctx(), { slug, version: "draft", screen, query });
          if (loaded?.needsAttention) problems.push(`Screen ${screen}, query ${query}: a table or field it uses doesn't exist.`);
        } catch (error) {
          problems.push(`Screen ${screen}, query ${query}: ${error?.message || error}`);
        }
      }
    }
    return problems;
  }

  async function appsOverview() {
    const { apps: list } = await appStore.list({ withPins: false, kind: "app" }, call);
    const tables = (await registry.loadTables(call)).filter((table) => !table.obsolete).map((table) => table.key);
    return {
      apps: list.map((app) => ({
        slug: app.slug,
        name: app.name,
        published: Boolean(app.liveVersionId),
        draft: Boolean(app.draftVersionId)
      })),
      tables
    };
  }
  async function appGet({ slug }) {
    try {
      const { app, version, definition } = await appStore.get(slug, { version: "draft" }, call);
      return {
        app: { slug: app.slug, name: app.name },
        version: version ? { draft: version.draft, number: version.number } : null,
        definition
      };
    } catch (error) {
      return failed(error);
    }
  }
  async function templateList() {
    return { templates: apps.templateSummaries() };
  }
  async function templateInstall({ key, sample }) {
    try {
      const { app, errors } = await apps.installTemplate(await ctx(), key, { sample: sample === true });
      if (!errors.length) {
        after.push({ kind: "app_draft", role: "bot", body: { slug: app.slug, name: app.name, summary: `From the ${app.name} template` } });
      }
      return { status: errors.length ? "installed; the draft needs fixing" : "draft saved", slug: app.slug, errors };
    } catch (error) {
      return failed(error);
    }
  }
  async function scriptList({ app }) {
    try {
      const { scripts: list } = await scripts.list(app, { runs: 5 }, call);
      return {
        scripts: list.map(({ key, kind, summary, settings, code, tests, version, runs }) => ({
          key,
          kind,
          summary,
          settings,
          code,
          tests,
          version,
          recentRuns: runs.map(({ at, ok, error, log }) => ({ at, ok, error, log }))
        }))
      };
    } catch (error) {
      return failed(error);
    }
  }
  async function scriptWrite({ app, key, kind, job, settings = {}, examples = "" }) {
    try {
      return await writeScript({
        scripts,
        registry,
        call,
        actor: await actor(),
        app,
        key,
        kind,
        settings,
        job,
        examples,
        model: scriptModel
      });
    } catch (error) {
      return failed(error);
    }
  }
  async function scriptSave({ app, ...input }) {
    try {
      const result = await scripts.save(await actor(), app, input, call);
      if (result.errors.length) {
        return { status: "not saved", errors: result.errors, failures: result.results.filter((entry) => !entry.passed) };
      }
      return { status: "saved", script: { key: result.script.key, kind: result.script.kind, version: result.script.version } };
    } catch (error) {
      return failed(error);
    }
  }
  async function scriptRemove({ app, key }) {
    try {
      return { status: "removed", ...(await scripts.remove(await actor(), app, key, call)) };
    } catch (error) {
      return failed(error);
    }
  }
  async function appCreate(input) {
    try {
      const app = await appStore.createApp(await actor(), input, call);
      return { status: "created", slug: app.slug };
    } catch (error) {
      return failed(error);
    }
  }
  async function appSaveDraft({ slug, definition: given, summary }) {
    try {
      const definition = definitionFrom(given);
      if (!definition) return { status: "not saved", errors: [{ path: "definition", message: "This isn't a JSON object. Send the definition as an object." }] };
      const result = await appStore.saveDraft(await actor(), slug, definition, summary, call);
      if (result.errors.length) return { status: "not saved", errors: result.errors.slice(0, 30) };
      const app = await appStore.find(slug, call);
      after.splice(0, after.length, ...after.filter((message) => !(message.kind === "app_draft" && message.body.slug === app.slug)));
      after.push({ kind: "app_draft", role: "bot", body: { slug: app.slug, name: app.name, summary, versionId: result.draftVersionId } });
      // The Builder checks its own work (D-48): every screen's data loads from the draft as
      // the preview will load it, and anything that doesn't comes back to be fixed.
      const problems = await screensThatFail(app.slug, definition);
      if (problems.length) {
        return {
          status: "draft saved, but some screens don't load",
          problems,
          note: "Fix these and save the draft again before telling the person it's ready."
        };
      }
      return {
        status: "draft saved",
        checked: "Every screen's data loads.",
        note:
          "Now try it with app_try: each screen, and every button or form that saves, with realistic values, then check the " +
          "record shows where it should. Fix what fails and save again. Then tell the person in one or two lines what you " +
          "tried and that it worked, and remind them to press Publish on the draft card to start using it."
      };
    } catch (error) {
      return failed(error);
    }
  }
  async function appTry({ slug, screen, press, values, row, params, state }) {
    try {
      return await trial.tryScreen(await ctx(), { slug, screen, press, values, row, params, state });
    } catch (error) {
      return failed(error);
    }
  }
  async function tableCreate(input) {
    try {
      const table = await registry.createTable(await actor(), input, call);
      return { status: "created", table: table.key, fields: table.fields.map((field) => field.key) };
    } catch (error) {
      return failed(error);
    }
  }
  async function fieldAdd({ table, ...input }) {
    try {
      const field = await registry.addField(await actor(), table, input, call);
      return { status: "added", field: field.key };
    } catch (error) {
      return failed(error);
    }
  }
  async function fieldRemove({ table, field }) {
    try {
      const { table: info } = await gate.tableFor(table, call);
      const target = info.fields.find((entry) => !entry.obsolete && entry.key === field);
      if (!target) return { error: `${info.key} has no field "${field}".` };
      if (!after.some((message) => message.kind === "field_removal" && message.body.fieldId === target.id)) {
        after.push({ kind: "field_removal", role: "bot", body: { fieldId: target.id, field: target.label, table: info.label } });
      }
      return {
        status: "waiting for the person",
        note: "Nothing has changed yet. They have a card listing what uses the field; tell them briefly."
      };
    } catch (error) {
      return failed(error);
    }
  }
  async function fieldFormula({ table, field, formula }) {
    try {
      const { table: info } = await gate.tableFor(table, call);
      const target = info.fields.find((entry) => !entry.obsolete && entry.key === field);
      if (!target) return { error: `${info.key} has no field "${field}".` };
      await registry.changeFormula(await actor(), target.id, formula, call);
      return { status: "changed", field: target.key, formula, note: "Every record shows the new value the next time it's read." };
    } catch (error) {
      return failed(error);
    }
  }
  async function fieldRename({ table, field, key, label }) {
    try {
      const { table: info } = await gate.tableFor(table, call);
      const target = info.fields.find((entry) => !entry.obsolete && entry.key === field);
      if (!target) return { error: `${info.key} has no field "${field}".` };
      const renamed = await registry.renameField(await actor(), target.id, {
        ...(key ? { key } : {}),
        ...(label ? { label } : {})
      }, call);
      return { status: "renamed", field: renamed.key, label: renamed.label };
    } catch (error) {
      return failed(error);
    }
  }

  return Object.freeze({
    appsOverview: createTool(
      Object.freeze({
        id: "apps_overview",
        description:
          "Builder: list this home's apps (slug, name, published or not, draft) and tables. Read the Building apps skill before making or changing an app.",
        inputSchema: z.object({}),
        execute: (input, options) => appsOverview(input, options)
      })
    ),
    appGet: createTool(
      Object.freeze({
        id: "app_get",
        description: "Builder: an app's definition by names (the draft if there is one, otherwise the live version).",
        inputSchema: z.object({ slug: z.string().min(1).max(64) }),
        execute: (input, options) => appGet(input, options)
      })
    ),
    templateList: createTool(
      Object.freeze({
        id: "template_list",
        description:
          "List the ready-made app templates (CRM, Stock, Leave requests, Hiring pipeline, Contact form, Bookings) with what each contains.",
        inputSchema: z.object({}),
        execute: (input, options) => templateList(input, options)
      })
    ),
    templateInstall: createTool(
      Object.freeze({
        id: "template_install",
        description:
          "Install a ready-made app as a draft: its tables are reused when this home already has them (only missing fields are added) or made new. Optionally add its sample records. Then adapt it with app_get and app_save_draft; the person previews and publishes.",
        inputSchema: z.object({ key: z.string().min(1).max(40), sample: z.boolean().optional() }),
        execute: (input, options) => templateInstall(input, options)
      })
    ),
    scriptList: createTool(
      Object.freeze({
        id: "script_list",
        description: "Builder: an app's scripts (key, kind, summary, settings, code, tests) and their recent runs and errors.",
        inputSchema: z.object({ app: z.string().min(1).max(64) }),
        execute: (input, options) => scriptList(input, options)
      })
    ),
    scriptWrite: createTool(
      Object.freeze({
        id: "script_write",
        description:
          `Builder: have a script written for an app, for logic formulas can't express. Describe the job precisely (inputs, what ` +
          `to read or change, what to return, edge cases); a small coding loop writes the code and its tests, runs them and fixes ` +
          `failures, up to 5 rounds, and saves it only when every test passes. Kinds: action (a button: { runScript: { script, ` +
          `input } }), source (a screen query: { script, input }), rule (on a table, before records are saved: settings { table, ` +
          `on? }), function (callable in the app's formulas: settings { params }), job (settings { every: hour|day|week, at: ` +
          `"HH:MM", day?: 0-6, timeZone } or { watch: { table, on: create|update|any, condition? } }). Then use it in the app with ` +
          `app_save_draft.
${SCRIPT_GUIDE}`,
        inputSchema: z.object({
          app: z.string().min(1).max(64).describe("The app's slug"),
          key: z
            .string()
            .regex(/^[a-z][a-z0-9_]{0,63}$/u)
            .describe("The script's name, e.g. score_leads"),
          kind: z.enum(["action", "source", "rule", "function", "job"]),
          job: z.string().min(10).max(4000).describe("What it must do, precisely"),
          settings: z.record(z.string(), z.any()).optional(),
          examples: z.string().max(4000).optional().describe("Example inputs and the results expected")
        }),
        execute: (input, options) => scriptWrite(input, options)
      })
    ),
    scriptSave: createTool(
      Object.freeze({
        id: "script_save",
        description:
          "Builder: save a script you wrote yourself (small changes to an existing one, after script_list). It's saved only when every test passes; otherwise the failures come back. Same kinds, settings and rules as script_write.",
        inputSchema: z.object({
          app: z.string().min(1).max(64),
          key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u),
          kind: z.enum(["action", "source", "rule", "function", "job"]),
          summary: z.string().min(1).max(300).describe("What it does, in a sentence people read"),
          code: z.string().min(1).max(20000),
          tests: z.array(z.record(z.string(), z.any())).min(1).max(20),
          settings: z.record(z.string(), z.any()).optional()
        }),
        execute: (input, options) => scriptSave(input, options)
      })
    ),
    scriptRemove: createTool(
      Object.freeze({
        id: "script_remove",
        description:
          "Builder: remove a script the app no longer needs (take it out of the app's screens first with app_save_draft). Only when the person agrees.",
        inputSchema: z.object({ app: z.string().min(1).max(64), key: z.string().min(1).max(64) }),
        execute: (input, options) => scriptRemove(input, options)
      })
    ),
    appCreate: createTool(
      Object.freeze({
        id: "app_create",
        description: "Builder: create a new, empty app. Then save its first draft with app_save_draft.",
        inputSchema: z.object({
          name: z.string().min(1).max(80),
          icon: z
            .enum([
              "search",
              "edit",
              "back",
              "save",
              "add",
              "open",
              "check",
              "close",
              "person",
              "mail",
              "phone",
              "calendar",
              "chart",
              "star"
            ])
            .optional(),
          color: z
            .string()
            .regex(/^#[0-9a-fA-F]{6}$/u)
            .optional()
        }),
        execute: (input, options) => appCreate(input, options)
      })
    ),
    appSaveDraft: createTool(
      Object.freeze({
        id: "app_save_draft",
        description:
          "Builder: save a whole app definition as its draft (it replaces the previous draft). If errors come back, fix every one and save again. The person previews the draft and publishes it; never say it's live. Public screens need public.tables to list what visitors may reach, per table: can (list, get, create, update, delete), rows (all, own or a formula), owner, read and write (field names); see Public apps in your skill.",
        inputSchema: z.object({
          slug: z.string().min(1).max(64),
          definition: definitionInput("An object: the whole app, with home, navigation and screens"),
          summary: z.string().min(1).max(300).describe("What changed, in plain words, e.g. Added a phone column to Contacts")
        }),
        execute: (input, options) => appSaveDraft(input, options)
      })
    ),
    appTry: createTool(
      Object.freeze({
        id: "app_try",
        description:
          "Builder: try a screen of an app's saved draft as a person would, on its practice data (a copy of the home's newest " +
          "records that the draft's preview shows; the live app and its records never change). It answers what the screen " +
          "shows (texts, the first rows of each table, forms, totals, buttons with their press paths) and any query or formula " +
          "that fails. With press (a button's label or press path) it first presses that button, or submits that form with " +
          "values by field name (row: the record id a table's row button needs), and answers what it saved or changed, " +
          "record by record, any error or refusal, what would have been sent (a bot's task, a web call), and the screen it " +
          "ended on. What you save here shows in the person's preview until they press Reset or publish, so use realistic " +
          "values a person would enter, never test or placeholder text.",
        inputSchema: z.object({
          slug: z.string().min(1).max(64),
          screen: z.string().max(64).optional().describe("The screen's key; the app's home screen when left out"),
          press: z.string().max(200).optional().describe("A button's label, or its press path from an earlier answer"),
          values: z.record(z.string(), z.any()).optional().describe("A form's values by field name, e.g. { name: \"Ada Lovelace\" }"),
          row: z.string().max(64).optional().describe("The record id a table row's button or row click needs"),
          params: z.record(z.string(), z.string()).optional().describe("The screen's parameters, e.g. { id: \"12\" }"),
          state: z.record(z.string(), z.any()).optional().describe("The screen's state values, e.g. a search box's text")
        }),
        execute: (input, options) => appTry(input, options)
      })
    ),
    tableCreate: createTool(
      Object.freeze({
        id: "table_create",
        description:
          "Builder: create a table with its fields. Tables and fields are shared by every app and bot of this home and are never deleted.",
        inputSchema: z.object({
          key: z.string().min(1).max(64),
          label: z.string().max(120).optional(),
          fields: z.array(fieldInput).min(1).max(60)
        }),
        execute: (input, options) => tableCreate(input, options)
      })
    ),
    fieldAdd: createTool(
      Object.freeze({
        id: "field_add",
        description: "Builder: add a field to an existing table, stored or calculated (with a formula). Apps don't change until they use it.",
        inputSchema: fieldInput.extend({ table: z.string().min(1).max(64) }),
        execute: (input, options) => fieldAdd(input, options)
      })
    ),
    fieldRemove: createTool(
      Object.freeze({
        id: "field_remove",
        description:
          "Builder: ask the person to remove a field. They get a card showing every app that uses it and decide; nothing changes until they confirm. The data is always kept.",
        inputSchema: z.object({ table: z.string().min(1).max(64), field: z.string().min(1).max(64) }),
        execute: (input, options) => fieldRemove(input, options)
      })
    ),
    fieldFormula: createTool(
      Object.freeze({
        id: "field_formula",
        description:
          "Builder: change a calculated field's formula (by field names, e.g. \"=price * quantity\"). Every record shows the new value at once. " +
          "It stays calculated: lists still can't be filtered, sorted or grouped by it; if the person now wants that, offer a stored field that a rule fills in on save instead.",
        inputSchema: z.object({
          table: z.string().min(1).max(64),
          field: z.string().min(1).max(64),
          formula: z.string().min(2).max(2000)
        }),
        execute: (input, options) => fieldFormula(input, options)
      })
    ),
    fieldRename: createTool(
      Object.freeze({
        id: "field_rename",
        description: "Builder: rename a field (its name, its label, or both). Every app follows automatically.",
        inputSchema: z.object({
          table: z.string().min(1).max(64),
          field: z.string().min(1).max(64),
          key: z.string().max(64).optional(),
          label: z.string().max(120).optional()
        }),
        execute: (input, options) => fieldRename(input, options)
      })
    )
  });
}
