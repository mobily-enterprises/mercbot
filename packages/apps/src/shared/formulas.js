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
  const now = new Date();
  let years = now.getUTCFullYear() - date.getUTCFullYear();
  if (now.getUTCMonth() < date.getUTCMonth() || (now.getUTCMonth() === date.getUTCMonth() && now.getUTCDate() < date.getUTCDate())) {
    years -= 1;
  }
  return BigInt(Math.max(0, years));
}

function daysSince(text) {
  const date = parseDate(text);
  return date ? BigInt(Math.floor((Date.now() - date.getTime()) / 86400000)) : 0n;
}

/** Money is stored in whole cents; this shows 123456 as "1,234.56". */
function formatMoney(cents) {
  const value = Number(cents) / 100;
  return Number.isFinite(value) ? value.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
}

/** The longest text a field holds: what a person types, and what a calculated field works out (D-78). */
export const TEXT_MAX = 10000;

/** Today's date (YYYY-MM-DD, like date fields) and the current moment (ISO 8601), in UTC. */
const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString();

// Every formula runs in a copy of this environment: CEL plus our few functions. Its size is bounded and it always
// finishes, but list macros and matches can still take long on long values (calculated fields refuse them, D-78).
const baseEnvironment = new Environment({ limits: { maxAstNodes: 500, maxDepth: 40 } })
  .registerFunction("today(): string", today)
  .registerFunction("now(): string", now)
  .registerFunction("formatDate(string, string): string", formatDate)
  .registerFunction("yearsSince(string): int", yearsSince)
  .registerFunction("daysSince(string): int", daysSince)
  .registerFunction("formatMoney(double): string", formatMoney);

// Names a script function can't take: ours above and CEL's own.
export const BUILT_IN_FUNCTIONS = new Set([
  "today",
  "now",
  "formatDate",
  "yearsSince",
  "daysSince",
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
  yesno: "bool"
};

/** A table's record as formulas see it: each live field's name and CEL type, and the id. */
export function celSchema(table) {
  const schema = { id: "string" };
  for (const field of table.fields) if (!field.obsolete) schema[field.key] = CEL_TYPES[field.type] || "string";
  return schema;
}

/** A public screen's visitor, as its formulas and visitor access see them. */
export const VISITOR = { signedIn: "bool", email: "string" };
