import { createTool } from "@jskit-ai/agent/server";
import { definitionFrom, definitionInput } from "./viewTools.js";
import { z } from "zod";
import { FIELD_TYPES } from "@local/apps/server/registry";
import { APP_ICON_NAMES } from "@local/apps/shared";
import { SCRIPT_GUIDE, writeScript } from "./scriptWriter.js";

// The home's Builder's own apps tools (D-35, D-48), beyond the records and watches every bot has:
// it makes tables, fields, apps and scripts; its app changes are drafts a person previews and
// publishes. It tries its drafts on their practice copy (app_try, D-71), as a person would.

// What a calculated field can't do (D-78), which the Builder tells the person whenever it adds one (owner, 2026-11-12).
const CALCULATED_LIMITS =
  "Lists can filter and sort by a calculated field only when it's a number or amount worked out by arithmetic over number fields, " +
  "never group by one, and a sum or average of one adds up at most 5,000 records: tell the person so when you add one. If they will want " +
  "to filter, sort or group by one that can't, offer a stored field that a rule fills in on save instead.";

const fieldChecksInput = {
  min: z.union([z.number(), z.string().max(10)]).nullable().optional().describe("Number, money (in cents) or date fields: the smallest value allowed (a date as YYYY-MM-DD)"),
  max: z.union([z.number(), z.string().max(10)]).nullable().optional().describe("Number, money (in cents) or date fields: the largest value allowed"),
  pattern: z.string().max(200).nullable().optional().describe("Text or phone fields: a regular expression the whole value must match, e.g. \"[0-9]{4}\" for a 4-digit postcode; never a repeat of a repeating group"),
  patternMessage: z.string().max(120).nullable().optional().describe("What the pattern wants, in words, as people see it: \"a 4-digit postcode\""),
  unique: z.boolean().nullable().optional().describe("Text, email, phone, web address or number fields: no two records may share a value (text ignores case); for link fields: at most one record links to each target (a one-to-one extension of that table)")
};

export const fieldInput = z.object({
  key: z.string().min(1).max(64).describe("Field name: lowercase letters, digits and _ , starting with a letter"),
  label: z.string().max(120).optional().describe("What people see; defaults from the name"),
  type: z.enum(FIELD_TYPES).describe(
    "money is stored in whole cents; date is YYYY-MM-DD; datetime is a moment like 2026-11-24T09:30:00Z; link points to a " +
      "record of another table; person is someone in this home; tags is a list of short words; longtext is long notes; url a web address; " +
      "file holds a document and image a picture, each put on a record with data_attach_file"
  ),
  required: z.boolean().optional(),
  choices: z.array(z.string().min(1).max(80)).max(50).optional().describe("For choice fields; for tags fields, the only tags allowed (optional)"),
  target: z.string().max(64).optional().describe("For link fields: the table it points to"),
  ...fieldChecksInput,
  formula: z
    .string()
    .max(2000)
    .optional()
    .describe(
      "Makes it a calculated field (text, number, money, date or yesno): a formula over this record's other fields by name, " +
        "e.g. \"=price * quantity\". Never stored or typed in; worked out whenever the record is read. " +
        CALCULATED_LIMITS
    ),
  rollup: z
    .object({
      from: z.string().min(1).max(64).describe("The table whose records it adds up"),
      link: z.string().min(1).max(64).describe("That table's link field pointing to this table"),
      measure: z.enum(["sum", "count", "min", "max"]),
      field: z.string().max(64).optional().describe("For sum, min and max: the number or money field of that table to add up"),
      where: z.string().max(2000).optional().describe("Only the records this formula over that table's fields keeps, e.g. \"=status != 'done'\"")
    })
    .optional()
    .describe(
      "Makes it a roll-up (number or money; field_add only, once the other table links here): the sum, count, smallest or largest of " +
        "the linked records, e.g. an invoice's total of its lines' amounts, or an event's count of sign-ups. Stored and kept up to date " +
        "by itself, so lists filter and sort by it; nobody types it in. A sum, min or max of money is money."
    )
});

/** The refusal of a private chat's file for an app's tile, which the whole home sees. */
const PRIVATE_PICTURE =
  "That file is in this private chat, and an app's tile is the whole home's: draw the picture with make_picture here, or copy the file to /files/shared with transfer_file first, which asks the person.";

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
 * @param {(path: string) => Promise<{ real: string, folder: string }>} shared.fileAt one of the bot's files by its path
 * @param {boolean} shared.privateChat whether the turn's chat is private
 */
export function buildBuilderTools({ apps, call, actor, ctx, failed, after, scriptModel, fileAt, privateChat }) {
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
  // Apps made from templates, kept up to date with them (D-130): which have an update, and one brought up to date as a
  // draft the person previews and publishes, with the screens it had, to carry the person's own changes over.
  async function templateCheck() {
    try {
      return { apps: await apps.templateStatus(call) };
    } catch (error) {
      return failed(error);
    }
  }
  async function templateUpdate({ app: slug }) {
    try {
      const { app, errors, previous } = await apps.updateFromTemplate(await ctx(), slug);
      if (!errors.length) {
        after.push({ kind: "app_draft", role: "bot", body: { slug: app.slug, name: app.name, summary: `Updated from the ${app.name} template` } });
      }
      return {
        status: errors.length ? "updated; the draft needs fixing" : "draft saved",
        slug: app.slug,
        errors,
        previousScreens: previous,
        note:
          "The draft is now the template's latest version. Compare it with previousScreens: anything the person changed " +
          "themselves (a field, a screen, a column, wording) is carried over into the draft with app_get and app_save_draft, " +
          "then tell the person what changed and that it's live once they publish."
      };
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
  /**
   * An app's picture and colour (D-141): a set picture, or a picture the bot drew (make_picture's path) kept as the app's
   * own. In a private chat only the bot's own pictures (/files/chat/Pictures) go on a tile, which is the whole home's.
   */
  async function appSetIcon({ app, icon, color, picture }) {
    try {
      if (!picture) return { status: "changed", ...(await apps.icons.set(await actor(), app, { icon, color }, call)) };
      const own = /^\/files\/chat\/Pictures\/[^/]+$/u.test(String(picture));
      if (privateChat && /^\/files\/chat(?:\/|$)/u.test(String(picture)) && !own) return { error: PRIVATE_PICTURE };
      const { real, folder } = await fileAt(picture);
      if (privateChat && folder === "chat" && !own) return { error: PRIVATE_PICTURE };
      if (color) await apps.icons.set(await actor(), app, { color }, call);
      return { status: "changed", ...(await apps.icons.putPicture(await actor(), app, { source: real, name: picture.split("/").pop() }, call)) };
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
    // What the shared tables have is never made twice (D-130): the bot uses the shared one and builds on it.
    const shared = apps.catalog.match(input.key) || apps.catalog.match(input.label);
    if (shared) return { error: apps.catalog.useInstead(shared, input.label || input.key) };
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
  /** A table's field by its name, and the table, as the field tools change it; or the error they answer. */
  async function liveField(table, field) {
    const { table: info } = await gate.tableFor(table, call);
    const target = info.fields.find((entry) => !entry.obsolete && entry.key === field);
    return target ? { info, target } : { error: `${info.key} has no field "${field}".` };
  }
  async function fieldRemove({ table, field }) {
    try {
      const { info, target, error } = await liveField(table, field);
      if (error) return { error };
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
      const { target, error } = await liveField(table, field);
      if (error) return { error };
      await registry.changeFormula(await actor(), target.id, formula, call);
      return { status: "changed", field: target.key, formula, note: "Every record shows the new value the next time it's read." };
    } catch (error) {
      return failed(error);
    }
  }
  async function fieldChecks({ table, field, ...checks }) {
    try {
      const { target, error } = await liveField(table, field);
      if (error) return { error };
      const changed = await registry.changeChecks(await actor(), target.id, checks, call);
      return { status: "changed", field: changed.key, checks: changed.options, note: "Records already saved keep their values; each is checked when it's next saved." };
    } catch (error) {
      return failed(error);
    }
  }
  async function fieldRename({ table, field, key, label }) {
    try {
      const { target, error } = await liveField(table, field);
      if (error) return { error };
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
    templateCheck: createTool(
      Object.freeze({
        id: "template_check",
        description:
          "Check this home's apps made from ready-made templates: for each, its template and whether an update is ready (the " +
          "template has improved since), it's up to date, or you can't tell (an older app, matched by its name: confirm with the person).",
        inputSchema: z.object({}),
        execute: (input, options) => templateCheck(input, options)
      })
    ),
    templateUpdate: createTool(
      Object.freeze({
        id: "template_update",
        description:
          "Bring an app made from a template up to the template's latest version, as a draft: tables gain what it needs (nothing " +
          "removed), the draft takes the template's screens, and the live app is unchanged until the person publishes. Then carry " +
          "over anything the person had changed themselves, from previousScreens, with app_get and app_save_draft.",
        inputSchema: z.object({ app: z.string().min(1).max(64) }),
        execute: (input, options) => templateUpdate(input, options)
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
          `failures, up to 5 rounds, and saves it only when every test passes, into the app's draft (the draft's preview runs it; ` +
          `it goes live when the person publishes). Kinds: action (a button: { runScript: { script, ` +
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
          "Builder: save a script you wrote yourself (small changes to an existing one, after script_list). It's saved only when every test passes; otherwise the failures come back. Same kinds, settings and rules as script_write. Like every script, it goes into the app's draft: try it there, and it goes live when the person publishes.",
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
          icon: z.enum(APP_ICON_NAMES).optional().describe("A picture that fits what the app does, from the app icons in your skill"),
          color: z
            .string()
            .regex(/^#[0-9a-fA-F]{6}$/u)
            .optional()
        }),
        execute: (input, options) => appCreate(input, options)
      })
    ),
    appSetIcon: createTool(
      Object.freeze({
        id: "app_set_icon",
        description: "Builder: give an app or a view a picture that fits what it does (one of the app icons, or a picture you drew with make_picture first, by its path) and a colour for its tile. People can also change both in the app's details.",
        inputSchema: z.object({
          app: z.string().min(1).max(64).describe("The app's or view's slug"),
          icon: z.enum(APP_ICON_NAMES).optional().describe("A picture from the app icons in your skill"),
          color: z.string().regex(/^#[0-9a-fA-F]{6}$/u).optional().describe("The tile's colour, #RRGGBB; white must read on it"),
          picture: z.string().min(8).max(500).optional().describe("A picture you drew with make_picture (its path), kept as the app's own picture on its tile in place of the set one")
        }),
        execute: (input, options) => appSetIcon(input, options)
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
          "It stays calculated: lists filter and sort by it only while it's arithmetic over number fields, and never group by it; if the person now wants that, offer a stored field that a rule fills in on save instead.",
        inputSchema: z.object({
          table: z.string().min(1).max(64),
          field: z.string().min(1).max(64),
          formula: z.string().min(2).max(2000)
        }),
        execute: (input, options) => fieldFormula(input, options)
      })
    ),
    fieldChecks: createTool(
      Object.freeze({
        id: "field_checks",
        description:
          "Builder: change an existing field's checks: required, min, max, pattern (with patternMessage) and unique. Give only what changes; " +
          "null or false removes one. Every way records are saved keeps to them (forms, the Data tab, imports, bots, scripts). Unique is refused " +
          "while two records share a value: tell the person which, so they can change them.",
        inputSchema: z.object({
          table: z.string().min(1).max(64),
          field: z.string().min(1).max(64),
          required: z.boolean().nullable().optional(),
          ...fieldChecksInput
        }),
        execute: (input, options) => fieldChecks(input, options)
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
