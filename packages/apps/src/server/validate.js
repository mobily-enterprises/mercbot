// Field values, checked by type before anything is written (D-35). Every write path — screens,
// the Data tab, bots, imports — goes through here via the data gate.
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { isCalculated } from "../shared/calculated.js";
import { LONGTEXT_MAX, TEXT_MAX } from "../shared/formulas.js";

/** A refusal of a value, a record or an app action, which the apps routes answer with its status, message and code. */
export class GateError extends AppError {
  /**
   * @param {number} status The HTTP status the route answers with.
   * @param {string} message The sentence the person sees.
   * @param {{ code: string, params?: object }} options The refusal's own code, and the values its sentence names.
   */
  constructor(status, message, options) {
    super(status, message, options);
    this.name = "GateError";
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/u;
const URL_START = /^https?:\/\/[^\s/$.?#][^\s]*$/iu;
/** A tag is at most this long, and a tags field holds at most this many. */
export const TAG_MAX = 80;
export const TAGS_MAX = 50;
/**
 * A record's file as the data gate stores it after writing it to Database files (attachFile): only the gate makes
 * one, marked so, since a value someone sends could name any path.
 */
export const STORED_FILE = Symbol("stored record file");
const empty = (value) => value === null || value === undefined || value === "";

function validDate(text) {
  const match = DATE.exec(text);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return (
    date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3])
  );
}

/** Returns the stored value (null for empty) or throws a GateError naming the field. */
function cleanValue(field, value) {
  /**
   * Refuses the value, naming its field first.
   * @param {string} message What is wrong with it.
   * @param {string} code The refusal's own code.
   * @param {object} [params] The values the sentence names besides the field.
   */
  const fail = (message, code, params) => {
    throw new GateError(400, `${field.label}: ${message}`, { code, params: { field: field.label, ...params } });
  };
  if (empty(value)) return null;
  switch (field.type) {
    case "text":
    case "phone": {
      const text = String(value);
      if (text.length > TEXT_MAX) fail(`at most ${TEXT_MAX} characters.`, "apps_value_too_long", { max: TEXT_MAX });
      return text;
    }
    case "email": {
      const text = String(value).trim();
      if (!EMAIL.test(text)) fail("not a valid email address.", "apps_value_email_invalid");
      return text;
    }
    case "choice": {
      const text = String(value);
      if (!field.options?.choices?.includes(text)) {
        const choices = (field.options?.choices || []).join(", ");
        fail(`must be one of: ${choices}.`, "apps_value_choice_unknown", { choices });
      }
      return text;
    }
    case "number": {
      const number = typeof value === "number" ? value : Number(String(value).trim());
      if (!Number.isFinite(number)) fail("must be a number.", "apps_value_number_invalid");
      return number;
    }
    case "money": {
      const cents = typeof value === "number" ? value : Number(String(value).trim());
      if (!Number.isSafeInteger(cents)) fail("must be a whole number of cents.", "apps_value_cents_invalid");
      return cents;
    }
    case "date": {
      const text = String(value).trim();
      if (!validDate(text)) fail("must be a date like 2026-10-28.", "apps_value_date_invalid");
      return text;
    }
    case "yesno":
      if (typeof value === "boolean") return value;
      if (value === "true" || value === "false") return value === "true";
      return fail("must be yes or no.", "apps_value_yesno_invalid");
    case "link":
      return String(typeof value === "object" ? value.id : value);
    case "person": {
      // A member of the home, by their user id ({ id } as a record reads it back); the gate checks they're in the home.
      const id = String(typeof value === "object" ? value.id : value).trim();
      if (!/^\d{1,20}$/u.test(id)) fail("must be someone in this home.", "apps_value_person_invalid");
      return id;
    }
    case "url": {
      const text = String(value).trim();
      if (text.length > TEXT_MAX || !URL_START.test(text)) fail("must be a web address starting with https://.", "apps_value_url_invalid");
      return text;
    }
    case "longtext": {
      const text = String(value);
      if (text.length > LONGTEXT_MAX) fail(`at most ${LONGTEXT_MAX} characters.`, "apps_value_too_long", { max: LONGTEXT_MAX });
      return text;
    }
    case "tags": {
      // A list of tags, or "a, b" as a sheet or a person types it: trimmed, each once, in the order given.
      const given = Array.isArray(value) ? value : String(value).split(",");
      const tags = [...new Set(given.map((tag) => String(tag ?? "").trim()).filter(Boolean))];
      if (tags.length > TAGS_MAX) fail(`at most ${TAGS_MAX} tags.`, "apps_value_tags_too_many", { max: TAGS_MAX });
      const long = tags.find((tag) => tag.length > TAG_MAX);
      if (long) fail(`a tag is at most ${TAG_MAX} characters.`, "apps_value_tag_too_long", { max: TAG_MAX });
      const allowed = field.options?.choices;
      const unknown = allowed?.length ? tags.filter((tag) => !allowed.includes(tag)) : [];
      if (unknown.length) {
        fail(`must be among: ${allowed.join(", ")}.`, "apps_value_tag_unknown", { choices: allowed.join(", "), tags: unknown.join(", ") });
      }
      return tags.length ? tags : null;
    }
    case "file":
    case "image": {
      // Set only by attachFile, which writes the file to Database files first; anything else sent here is refused.
      if (!value[STORED_FILE]) fail("add a file by uploading it, or a bot passing one it has.", "apps_value_file_from_upload");
      const { path, name, size, type } = value;
      return { path: String(path), name: String(name), size: Number(size), type: String(type || "") };
    }
    case "datetime": {
      // A moment, with its zone: kept as the same instant in UTC.
      const text = String(value instanceof Date ? value.toISOString() : value).trim();
      // The calendar day as written must exist (Date would roll 30 February over into March).
      const moment = DATETIME.test(text) && validDate(text.slice(0, 10)) ? new Date(text) : null;
      if (!moment || Number.isNaN(moment.getTime())) fail("must be a date and time like 2026-11-24T09:30:00Z.", "apps_value_datetime_invalid");
      return moment.toISOString();
    }
    default:
      // The registry only stores known types, so this is a broken table, not a refusal.
      throw new Error(`${field.label} has an unknown type "${field.type}".`);
  }
}

/**
 * Maps input keyed by field id or key to cleaned values keyed by field id. `creating` also
 * enforces required fields that weren't given.
 */
export function cleanRecord(table, input = {}, { creating = false } = {}) {
  const byId = new Map(table.fields.map((field) => [field.id, field]));
  const byKey = new Map(table.fields.filter((field) => !field.obsolete).map((field) => [field.key, field]));
  const values = {};
  for (const [name, value] of Object.entries(input)) {
    if (name === "id") continue;
    const field = byId.get(name) || byKey.get(name);
    if (!field) {
      throw new GateError(400, `${table.label} has no field "${name}".`, {
        code: "apps_record_field_unknown",
        params: { table: table.label, field: name }
      });
    }
    if (field.obsolete) {
      throw new GateError(400, `${field.label} has been removed and can't be changed.`, {
        code: "apps_field_removed",
        params: { field: field.label }
      });
    }
    if (isCalculated(field)) {
      throw new GateError(400, `${field.label} is calculated from the record's other fields, so it can't be set.`, {
        code: "apps_field_calculated",
        params: { field: field.label }
      });
    }
    const cleaned = cleanValue(field, value);
    if (cleaned === null && field.options?.required) {
      throw new GateError(400, `${field.label} is required.`, { code: "apps_field_required", params: { field: field.label } });
    }
    values[field.id] = cleaned;
  }
  if (creating) {
    for (const field of table.fields) {
      if (!field.obsolete && field.options?.required && (values[field.id] === undefined || values[field.id] === null)) {
        throw new GateError(400, `${field.label} is required.`, { code: "apps_field_required", params: { field: field.label } });
      }
    }
  }
  return values;
}
