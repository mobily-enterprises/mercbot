import { expandLines } from "./lines.js";

// The app guide (D-147): everything about an app, in plain labelled text, written by Mercbot the same way for every app,
// so the app's bot knows it fully. Pure: the same app gives the same text byte for byte (no AI, no clock; every object's
// keys sorted, as the database keeps them in its own order). Made once per version as it's saved or published, and read
// in the cached start of the bot's prompt (apps.js, botAgent.js), never per turn.

/** The longest guide; past it the screens' details go first, then the end is cut, saying so. */
export const GUIDE_LIMIT = 40000;
// The longest a formula or a text is quoted in the guide.
const QUOTE = 160;

const sortedKeys = (object) => Object.keys(object && typeof object === "object" ? object : {}).sort();
const said = (value) => {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return text.length > QUOTE ? `${text.slice(0, QUOTE)}…` : text;
};
const words = (key) => String(key).replace(/[_-]+/gu, " ");

/** A screen's title as people see it: its navigation label, else its key in words. */
function screenTitle(definition, key) {
  const item = (definition.navigation?.items || []).find((entry) => entry.screen === key);
  return item?.label || words(key);
}

/** The screens in a stable order: the first screen, then the navigation's, then the rest by key. */
function screenOrder(definition) {
  const keys = sortedKeys(definition.screens);
  const first = [definition.home, ...(definition.navigation?.items || []).map((item) => item.screen)].filter((key) => keys.includes(key));
  return [...new Set([...first, ...keys])];
}

/** A table by key or id, as the registry has it. */
const tableFinder = (tables) => (name) => tables.find((table) => !table.obsolete && (table.key === name || table.id === name)) || null;

/** A table named in words: "Lessons (prog_lessons)". */
const tableWords = (table, name) => (table ? `${table.label || words(table.key)} (${table.key})` : `${name}`);

/** What one query reads, in words. */
function queryLine(name, query, tableOf) {
  if (query?.script) return `- ${name}: what the script ${query.script} answers${query.input ? `, given ${said(query.input)}` : ""}`;
  const table = tableOf(query?.record || query?.from);
  const what = query?.record ? `one record of ${tableWords(table, query.record)}${query.id ? ` (the one ${said(query.id)})` : ""}` : `records of ${tableWords(table, query?.from)}`;
  const details = [
    query?.where ? `where ${said(query.where)}` : "",
    query?.groupBy ? `totals by ${[].concat(query.groupBy).join(", ")}${query.by ? ` (${query.by})` : ""}` : "",
    query?.sum ? `adding up ${[].concat(query.sum).join(", ")}` : "",
    query?.avg ? `averaging ${[].concat(query.avg).join(", ")}` : "",
    query?.grandTotal ? "with a grand total" : "",
    query?.sort ? `sorted by ${[].concat(query.sort).join(", ")}` : "",
    query?.limit ? `at most ${query.limit}` : ""
  ].filter(Boolean);
  return `- ${name}: ${what}${details.length ? `, ${details.join(", ")}` : ""}`;
}

/** What a button's steps do, in words. */
function stepsWords(steps, scriptOf) {
  return [].concat(steps || []).map((step) => {
    const [kind] = sortedKeys(step);
    const value = step?.[kind];
    if (kind === "go") return `opens the screen ${value?.screen}${value?.params ? ` with ${said(value.params)}` : ""}`;
    if (kind === "create") {
      const fields = typeof value?.values === "string" ? said(value.values) : sortedKeys(value?.values).join(", ");
      return `adds a record to ${value?.table}${fields ? ` (${fields})` : ""}`;
    }
    if (kind === "update") {
      const fields = typeof value?.set === "string" ? said(value.set) : sortedKeys(value?.set).join(", ");
      return `changes ${said(value?.record ?? "the record")}${fields ? ` (${fields})` : ""}`;
    }
    if (kind === "markObsolete") return `puts away ${said(value?.record)}`;
    if (kind === "notify") return `says ${said(value)}`;
    if (kind === "celebrate") return `celebrates with ${said(value)}`;
    if (kind === "openDialog") return `opens the dialog ${value}`;
    if (kind === "closeDialog") return `closes the dialog ${value}`;
    if (kind === "askBot") return `asks the bot ${value?.bot ?? "the main bot"} to ${said(value?.task ?? value?.prompt ?? "")}`;
    if (kind === "runScript") return `runs the script ${value?.script}${scriptOf(value?.script) ? "" : " (not saved yet)"}`;
    if (kind === "set") return `sets ${value?.state} to ${said(value?.value)}`;
    if (kind === "if") return `if ${said(value?.when)}: ${stepsWords(value?.then, scriptOf) || "nothing"}${value?.else ? `; else ${stepsWords(value.else, scriptOf)}` : ""}`;
    return kind ? `${kind}` : "";
  }).filter(Boolean).join(", then ");
}

const shownWhen = (node) => (node?.showIf ? ` (shown when ${said(node.showIf)})` : "");

/** One button, in words. */
function buttonLine(button, scriptOf) {
  const confirm = button?.confirm ? `asks first (${said(button.confirm)}), then ` : "";
  return `button ${said(button?.label ?? "")}: ${confirm}${stepsWords(button?.do, scriptOf) || "does nothing"}${shownWhen(button)}`;
}

/** A form's fields, by label and key. */
const formFields = (fields) => [].concat(fields || []).map((field) => {
  const key = typeof field === "string" ? field : field?.field;
  const label = typeof field === "object" && field?.label ? `${field.label} ` : "";
  return `${label}(${key})`;
}).join(", ");

/**
 * The lines of one screen's parts, indented by depth; `brief` keeps only what acts (forms, buttons, lists) when the
 * guide is too long.
 */
function partLines(nodes, depth, { scriptOf, brief }) {
  const lines = [];
  const pad = "  ".repeat(depth);
  const add = (text) => lines.push(`${pad}- ${text}`);
  const inner = (children, deeper = 0) => lines.push(...partLines(children, depth + deeper, { scriptOf, brief }));
  for (const node of [].concat(nodes || [])) {
    const type = node && typeof node === "object" ? node.type : "";
    if (type === "row" || type === "grid") {
      inner(node.content);
    } else if (SHOWS[type]) {
      if (!brief) add(`${SHOWS[type](node)}${shownWhen(node)}`);
    } else if (ACTS[type]) {
      const [line, ...under] = [].concat(ACTS[type](node, scriptOf));
      add(line);
      lines.push(...under.map((each) => `${pad}  - ${each}`));
    } else if (type === "tabs" || type === "dialog") {
      const sections = type === "tabs" ? [].concat(node.tabs || []) : [node];
      for (const section of sections) {
        add(type === "tabs" ? `tab ${said(section?.title ?? section?.label ?? "")}` : `dialog ${said(node.title ?? node.key)} (${node.key})`);
        inner(section?.content, 1);
      }
    }
  }
  return lines;
}

// What a part that only shows says (left out of a shortened guide).
const SHOWS = {
  text: (node) => `text: ${said(node.value)}`,
  chip: (node) => `chip: ${said(node.value)}`,
  field: (node) => `${said(node.label ?? "")}: ${said(node.value)}`,
  totals: (node) => `totals ${said(node.label ?? "")} of ${said(node.rows)}`,
  chart: (node) => `${node.kind || "bar"} chart ${said(node.label ?? "")} of ${said(node.rows)}`,
  progress: (node) => `progress bar ${said(node.label ?? "")}: ${said(node.value)} of ${said(node.max ?? 100)}`
};
const columnName = (column) => (typeof column === "string" ? column : column?.label || column?.field || column?.value);
const cards = (node) => `${node.type} of ${said(node.rows)}${node.groupBy ? ` by ${node.groupBy}` : ""}${node.move ? ", cards move their records" : ""}`;
// What a part that acts or lists says, kept in a shortened guide, then the lines under it.
const ACTS = {
  button: (node, scriptOf) => buttonLine(node, scriptOf),
  input: (node) => `box ${said(node.label ?? "")} for the screen's ${node.bind}`,
  table: (node, scriptOf) => {
    const columns = [].concat(node.columns || []).map(columnName).join(", ");
    return [
      `list of ${said(node.rows)}${columns ? `, columns ${columns}` : ""}${node.search ? ", searchable" : ""}${shownWhen(node)}`,
      ...(node.onRowClick ? [`clicking a row ${stepsWords(node.onRowClick, scriptOf)}`] : []),
      ...[].concat(node.rowActions || []).map((action) => `on each row, ${buttonLine(action, scriptOf)}`)
    ];
  },
  form: (node, scriptOf) => [
    `form ${node.record ? `on ${said(node.record)}` : `adding to ${node.table}`}: ${formFields(node.fields)}${shownWhen(node)}`,
    ...[].concat(node.buttons || []).map((button) => buttonLine(button, scriptOf)),
    ...(node.onSubmit ? ["after it's added, sends what onSubmit says"] : [])
  ],
  view: (node) => `the view ${node.view}${node.copy ? " (the app's own copy)" : ""}`,
  board: cards,
  calendar: cards,
  timeline: cards
};

/** One screen: its title and key, how it opens, what it reads and what it shows. */
function screenSection(definition, key, { tableOf, scriptOf, brief }) {
  const screen = expandLines(definition.screens[key]) || {};
  const params = sortedKeys(screen.params);
  const lines = [`### ${screenTitle(definition, key)} (screen ${key})${screen.public === true ? ", public: visitors open it" : ""}`];
  if (params.length) lines.push(`Opened with: ${params.join(", ")}`);
  const state = sortedKeys(screen.state);
  if (state.length && !brief) lines.push(`Its own values: ${state.join(", ")}`);
  const data = sortedKeys(screen.data);
  if (data.length) lines.push("Reads:", ...data.map((name) => queryLine(name, screen.data[name], tableOf)));
  const shown = partLines(screen.content, 0, { scriptOf, brief });
  if (shown.length) lines.push("Shows:", ...shown);
  return lines.join("\n");
}

/** One field of a table, in words: its label, key, type and what it holds. */
function fieldLine(field, tableOf, fieldOf) {
  const options = field.options || {};
  const bits = [field.type];
  if (options.required) bits.push("required");
  if (options.owner) bits.push("whose record it is: each person sees only their own");
  if (options.choices?.length) bits.push(`one of ${options.choices.join(", ")}`);
  if (field.type === "link") bits.push(`links to ${tableWords(tableOf(options.target), options.target)}${options.unique ? ", one record each" : ""}`);
  if (options.formula) bits.push(`calculated: ${said(options.formula)}`);
  if (options.rollup) {
    const { measure, from, link, field: added, where } = options.rollup;
    const source = tableOf(from);
    const of = added ? ` of ${fieldOf(source, added)?.key ?? added}` : "";
    // Its filter keeps its fields by id: they're named here.
    const filter = where ? String(where).replace(/\bf_[0-9a-z]{16}\b/gu, (id) => fieldOf(source, id)?.key ?? id) : "";
    bits.push(`roll-up: the ${measure}${of} of ${tableWords(source, from)} by ${fieldOf(source, link)?.key ?? link}${filter ? ` where ${said(filter)}` : ""}`);
  }
  for (const check of ["min", "max", "pattern"]) if (options[check] !== undefined) bits.push(`${check} ${said(options[check])}`);
  if (options.unique && field.type !== "link") bits.push("unique");
  return `- ${field.label || words(field.key)} (${field.key}): ${bits.join(", ")}`;
}

/** The tables an app uses: those its screens and scripts name, with the tables they link to, by key. */
function tablesUsed(definition, scripts, tableOf) {
  const names = new Set();
  const walk = (value) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== "object") return;
    for (const key of ["from", "record", "table"]) if (typeof value[key] === "string" && tableOf(value[key])) names.add(tableOf(value[key]).key);
    Object.values(value).forEach(walk);
  };
  walk(definition.screens);
  for (const script of scripts) {
    for (const name of [script.settings?.table, script.settings?.watch?.table]) if (tableOf(name)) names.add(tableOf(name).key);
  }
  for (const name of [...names]) {
    for (const field of tableOf(name).fields.filter((entry) => !entry.obsolete && entry.type === "link")) {
      const target = tableOf(field.options?.target);
      if (target) names.add(target.key);
    }
  }
  return [...names].sort().map(tableOf);
}

/** One table: its name, whose its records are, and each live field. */
function tableSection(table, tableOf) {
  const fieldOf = (source, idOrKey) => source?.fields.find((field) => field.id === idOrKey || field.key === idOrKey) || null;
  const live = table.fields.filter((field) => !field.obsolete);
  const personal = live.some((field) => field.options?.owner);
  const kept = personal ? ", each person's own: everyone sees and changes only their own records" : table.access ? ", private: only some people may see it" : "";
  return [`### ${tableWords(table)}${kept}`, ...live.map((field) => fieldLine(field, tableOf, fieldOf))].join("\n");
}

/** When a script runs, in words. */
function scriptWhen(script) {
  const settings = script.settings || {};
  if (script.kind === "action") return "a button runs it";
  if (script.kind === "source") return "a screen reads what it answers";
  if (script.kind === "function") return `formulas call it${settings.params?.length ? ` with ${settings.params.join(", ")}` : ""}`;
  if (script.kind === "rule") return `before ${[].concat(settings.on || ["any change"]).join(" and ")} of ${settings.table} records are saved`;
  if (settings.watch) {
    const on = [].concat(settings.watch.on || "any").join(" and ");
    return `when ${settings.watch.table} records change (${on})${settings.watch.condition ? `, if ${said(settings.watch.condition)}` : ""}`;
  }
  return settings.every ? `every ${said(settings.every)}${settings.at ? ` at ${settings.at}` : ""}${settings.timeZone ? ` (${settings.timeZone})` : ""}` : "on a schedule";
}

/**
 * The guide of one app version. `app` is { name, description, definition (by names, as the Builder writes it), tables
 * (the home's, as the registry has them), scripts ([{ key, kind, summary, settings }], the version's) }.
 * @returns {string}
 */
export function appGuide({ name = "", description = "", definition, tables = [], scripts = [] }) {
  const app = definition && typeof definition === "object" ? definition : {};
  const tableOf = tableFinder(tables);
  const ordered = [...scripts].sort((a, b) => String(a.key).localeCompare(String(b.key)));
  const scriptOf = (key) => ordered.find((script) => script.key === key) || null;
  const keys = app.screens ? screenOrder(app) : [];
  const head = [
    `# The app guide of "${name}"`,
    "Written by Mercbot from the app itself: its screens, tables and scripts as they are in this version.",
    ...(description ? [`What it's for: ${description}`] : []),
    ...(keys.length ? [`It opens on ${screenTitle(app, app.home)} (screen ${app.home}).`] : []),
    ...(app.navigation?.items?.length
      ? [`Its navigation (${app.navigation.style || "rail"}): ${app.navigation.items.map((item) => `${item.label} (${item.screen})`).join(", ")}.`]
      : [])
  ].join("\n");
  const rest = (brief) => [
    keys.length ? ["## Screens", ...keys.map((key) => screenSection(app, key, { tableOf, scriptOf, brief }))].join("\n\n") : "",
    ...(app.public?.home ? [`## What visitors reach\nA public app: visitors start on the screen ${app.public.home} and reach only its public screens.`] : []),
    ["## Tables", ...tablesUsed(app, ordered, tableOf).map((table) => tableSection(table, tableOf))].join("\n\n"),
    ordered.length ? ["## Scripts", ...ordered.map((script) => `- ${script.key} (${script.kind}, ${scriptWhen(script)}): ${said(script.summary || "")}`)].join("\n") : ""
  ].filter(Boolean).join("\n\n");
  let text = `${head}\n\n${rest(false)}`;
  if (text.length > GUIDE_LIMIT) text = `${head}\n(The screens are shortened: only what acts on them is listed, as the whole guide is long.)\n\n${rest(true)}`;
  const cut = "\n(The rest of this guide is left out: it's longer than Mercbot keeps.)";
  return text.length > GUIDE_LIMIT ? `${text.slice(0, GUIDE_LIMIT - cut.length)}${cut}` : text;
}
