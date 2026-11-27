import { Environment } from "@marcbachmann/cel-js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseDate(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(String(text || ""));
  return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
}

function formatDate(text, pattern) {
  const date = parseDate(text);
  if (!date) return "";
  return String(pattern)
    .replace("yyyy", String(date.getUTCFullYear()))
    .replace("MMM", MONTHS[date.getUTCMonth()])
    .replace(/\bd\b/u, String(date.getUTCDate()));
}

function yearsSince(text) {
  const date = parseDate(text);
  if (!date) return 0n;
  const now = parseDate(today());
  let years = now.getUTCFullYear() - date.getUTCFullYear();
  if (now.getUTCMonth() < date.getUTCMonth() || (now.getUTCMonth() === date.getUTCMonth() && now.getUTCDate() < date.getUTCDate())) {
    years -= 1;
  }
  return BigInt(Math.max(0, years));
}

function daysSince(text) {
  const date = parseDate(text);
  return date ? BigInt(Math.round((parseDate(today()).getTime() - date.getTime()) / 86400000)) : 0n;
}

const asDate = (date) => date.toISOString().slice(0, 10);

/** A date some days later (or earlier, for a negative number); "" for no date. */
function addDays(text, days) {
  const date = parseDate(text);
  if (!date) return "";
  date.setUTCDate(date.getUTCDate() + Number(days));
  return asDate(date);
}

/** A date some months later or earlier, kept within the month: 31 January plus one month is 28 or 29 February. */
function addMonths(text, months) {
  const date = parseDate(text);
  if (!date) return "";
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + Number(months));
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return asDate(date);
}

/** Whole days from the first date to the second (negative when the second comes first); 0 without both. */
function daysBetween(from, to) {
  const start = parseDate(from);
  const end = parseDate(to);
  return start && end ? BigInt(Math.round((end.getTime() - start.getTime()) / 86400000)) : 0n;
}

/** The Monday of a date's week, and the first of its month. */
function startOfWeek(text) {
  const date = parseDate(text);
  if (!date) return "";
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return asDate(date);
}
function startOfMonth(text) {
  const date = parseDate(text);
  return date ? asDate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))) : "";
}

/** Money is stored in whole cents; this shows 123456 as "1,234.56". */
function formatMoney(cents) {
  const value = Number(cents) / 100;
  return Number.isFinite(value) ? value.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
}

/** A period's group as people read it (D-140): a week "Week of 23 Nov 2026", a month "Nov 2026", a year "2026". */
export function periodLabel(by, key) {
  const date = parseDate(key);
  if (!date) return key === null || key === undefined || key === "" ? "(none)" : String(key);
  const day = `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
  if (by === "year") return String(date.getUTCFullYear());
  if (by === "month") return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
  return by === "week" ? `Week of ${day}` : day;
}

/** The longest text a field holds: what a person types, and what a calculated field works out (D-78). */
export const TEXT_MAX = 10000;
/** Long notes (`longtext` fields) hold more than a text field. */
export const LONGTEXT_MAX = 20000;
/** Whether a field holds a record's file or picture (D-130): `{ path, name, size, type }`, which only an upload sets. */
export const isFileField = (field) => field?.type === "file" || field?.type === "image";

// The home's time zone, which "today" is in: the server answers it for the home a call works in (homeZone.js), a page
// for the home it shows (useTimeZone). UTC until one is set.
let zoneOf = () => "UTC";
/** Where formulas learn the home's time zone: a function answering its IANA name, such as "Australia/Perth". */
export function useTimeZoneSource(source) {
  zoneOf = source;
}

/** Whether a time zone is one the system knows ("Europe/Rome", "UTC"). */
export function isTimeZone(zone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: String(zone) });
    return Boolean(zone);
  } catch {
    return false;
  }
}

/** Today's date (YYYY-MM-DD, like date fields) in the home's time zone, and the current moment (ISO 8601). */
const today = () => {
  const zone = zoneOf() || "UTC";
  return new Intl.DateTimeFormat("en-CA", { timeZone: isTimeZone(zone) ? zone : "UTC", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date());
};
const now = () => new Date().toISOString();

// Every formula runs in a copy of this environment: CEL plus our few functions. Its size is bounded and it always
// finishes, but list macros and matches can still take long on long values (calculated fields refuse them, D-78).
const baseEnvironment = new Environment({ limits: { maxAstNodes: 500, maxDepth: 40 } })
  .registerFunction("today(): string", today)
  .registerFunction("now(): string", now)
  .registerFunction("formatDate(string, string): string", formatDate)
  .registerFunction("yearsSince(string): int", yearsSince)
  .registerFunction("daysSince(string): int", daysSince)
  .registerFunction("addDays(string, int): string", addDays)
  .registerFunction("addDays(string, double): string", (text, days) => addDays(text, Math.trunc(days)))
  .registerFunction("addMonths(string, int): string", addMonths)
  .registerFunction("addMonths(string, double): string", (text, months) => addMonths(text, Math.trunc(months)))
  .registerFunction("daysBetween(string, string): int", daysBetween)
  .registerFunction("startOfWeek(string): string", startOfWeek)
  .registerFunction("startOfMonth(string): string", startOfMonth)
  .registerFunction("formatMoney(double): string", formatMoney);

// Names a script function can't take: ours above and CEL's own.
export const BUILT_IN_FUNCTIONS = new Set([
  "today",
  "now",
  "formatDate",
  "yearsSince",
  "daysSince",
  "addDays",
  "addMonths",
  "daysBetween",
  "startOfWeek",
  "startOfMonth",
  "formatMoney",
  "size",
  "has",
  "int",
  "uint",
  "double",
  "string",
  "bytes",
  "bool",
  "dyn",
  "type",
  "duration",
  "timestamp",
  "matches",
  "contains",
  "startsWith",
  "endsWith",
  "lowerAscii",
  "upperAscii",
  "trim",
  "split",
  "join",
  "all",
  "exists",
  "exists_one",
  "map",
  "filter",
  "in"
]);

/** Formula values (CEL ints, maps) as plain JSON, as scripts take them. */
export function jsonValue(value) {
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Map) return Object.fromEntries([...value].map(([key, item]) => [key, jsonValue(item)]));
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item)]));
  return value === undefined ? null : value;
}

const environments = new Map();

/**
 * variables: { name: schemaObject | typeString }. functions (an app's script functions, D-35):
 * { id, list: [{ name, arity, call(...args) }] }; `id` changes whenever any of them does.
 */
export function environmentFor(variables, functions = null) {
  const key = `${JSON.stringify(variables)}\u0000${functions?.id ?? ""}`;
  if (!environments.has(key)) {
    if (environments.size > 2000) environments.clear();
    const environment = baseEnvironment.clone();
    for (const [name, type] of Object.entries(variables)) {
      if (typeof type === "string") {
        environment.registerVariable(name, type);
      } else {
        environment.registerVariable({ name, schema: type });
      }
    }
    for (const fn of functions?.list || []) {
      environment.registerFunction(`${fn.name}(${Array.from({ length: fn.arity }, () => "dyn").join(", ")}): dyn`, (...args) =>
        fn.call(...args.map(jsonValue)));
    }
    environments.set(key, environment);
  }
  return environments.get(key);
}

export const isFormula = (value) => typeof value === "string" && value.startsWith("=");

const parsed = new Map();

export function evaluateFormula(variables, source, context, functions = null) {
  const environment = environmentFor(variables, functions);
  const cacheKey = `${JSON.stringify(variables)}\u0000${functions?.id ?? ""}\u0000${source}`;
  if (!parsed.has(cacheKey)) {
    if (parsed.size > 20000) parsed.clear();
    parsed.set(cacheKey, environment.parse(source.slice(1)));
  }
  return parsed.get(cacheKey)(context);
}

export function checkFormula(variables, source, functions = null) {
  const result = environmentFor(variables, functions).check(source.slice(1));
  return result.valid ? { type: result.type } : { error: String(result.error?.message || result.error).split("\n")[0] };
}

// CEL ints are BigInts; pages show plain values.
export { formatDate, formatMoney };

export function plainValue(value) {
  if (typeof value === "bigint") return Number(value);
  return value;
}

/**
 * A field's value as formulas see it: empty values typed (0, false or ""), numbers as numbers,
 * links as the linked record's id. Server and screens build formula records with this.
 */
export function formulaValue(field, value) {
  if (field.type === "tags") return Array.isArray(value) ? value.map(String) : [];
  // A file as formulas see it: its name ("" for none); its path is for screens, not formulas.
  if (isFileField(field)) return value?.name ? String(value.name) : "";
  const plain = value && typeof value === "object" ? value.id : value;
  if (plain === null || plain === undefined) return ["number", "money"].includes(field.type) ? 0 : field.type === "yesno" ? false : "";
  return ["number", "money"].includes(field.type) ? Number(plain) : plain;
}

/**
 * How a plain field value is shown, by type: screens show it so, and so does a Builder trying a
 * draft (trial.js).
 */
export function showValue(field, value) {
  if (value === null || value === undefined || value === "") return "—";
  if (!field) return String(value);
  if (field.type === "person") {
    if (typeof value !== "object") return value; // history and audit keep the member's id
    return value.label ?? "—";
  }
  if (field.type === "tags") return Array.isArray(value) && value.length ? value.join(", ") : "—";
  if (isFileField(field)) return value?.name ?? "—";
  // A moment, in the reader's own time zone (a server shows its own).
  if (field.type === "datetime") {
    const moment = new Date(value);
    return Number.isNaN(moment.getTime()) ? String(value) : moment.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  }
  if (field.type === "link") {
    if (typeof value !== "object") return `#${value}`; // history and audit keep the linked record's id
    // A visitor gets no label for a record they may not read (D-66).
    if (value.label === null || value.label === undefined) return "—";
    return value.obsolete ? `${value.label} (obsolete)` : value.label;
  }
  if (field.type === "money") return formatMoney(value);
  if (field.type === "date") return formatDate(value, "d MMM yyyy");
  if (field.type === "yesno") return value ? "Yes" : "No";
  return String(value);
}

/**
 * A record as a screen got it (by field name, links as { id, label }) as formulas see it, without
 * removed fields; no record gives every field's empty value, as a new form's does. Screens build
 * their formula records so, and so does a Builder trying a draft (trial.js).
 */
export function formulaRecord(table, record) {
  if (!table) return {};
  const out = { id: String(record?.id ?? "") };
  for (const field of table.fields) if (!field.obsolete) out[field.key] = formulaValue(field, record?.[field.key]);
  return out;
}

/** A setting that is a plain field reference, such as "=row.email": it shows by the field's type. */
export const FIELD_REFERENCE = /^=(?:row|form|data\.\w+)\.(\w+)$/u;
// A part pointing at a field that has been removed still holds the field's id; screens skip it.
const REMOVED_FIELD = /\bf_[0-9a-z]{16}\b/u;
export const refersToRemovedField = (setting) => typeof setting === "string" && REMOVED_FIELD.test(setting);

/** A formula that reads nothing but our functions, like "=today()": the same for whoever runs it. */
export const isFixedFormula = (value) => isFormula(value) && !checkFormula({}, value).error;

const CEL_TYPES = {
  text: "string",
  email: "string",
  phone: "string",
  choice: "string",
  date: "string",
  link: "string",
  number: "double",
  money: "double",
  yesno: "bool",
  person: "string",
  url: "string",
  longtext: "string",
  tags: "list<string>",
  datetime: "string",
  file: "string",
  image: "string"
};

/** A table's record as formulas see it: each live field's name and CEL type, and the id. */
export function celSchema(table) {
  const schema = { id: "string" };
  for (const field of table.fields) if (!field.obsolete) schema[field.key] = CEL_TYPES[field.type] || "string";
  return schema;
}

/** A public screen's visitor, as its formulas and visitor access see them. */
export const VISITOR = { signedIn: "bool", email: "string" };
/** The member using a screen of their home's app, as its formulas see them: `assignee == me.id` is "mine". */
export const ME = { id: "string", name: "string" };
