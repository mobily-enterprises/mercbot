// Field values, checked by type before anything is written (D-35). Every write path — screens,
// the Data tab, bots, imports — goes through here via the data gate.
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { isCalculated } from "../shared/calculated.js";
import { TEXT_MAX } from "../shared/formulas.js";

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
