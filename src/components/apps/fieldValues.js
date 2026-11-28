// The new field types as the forms hold them while someone types (D-130): a person as their id, picked from the home's
// people; tags as a list of words; a date and time in the reader's own zone, as a datetime-local input takes it.
// Each form converts its other types itself; these are the same in both.

const pad = (number) => String(number).padStart(2, "0");

/**
 * A stored datetime (an ISO instant) as a datetime-local input's value, in this browser's zone, or "": its seconds and
 * milliseconds too when it has them, so a form sends back the same instant when nobody touched it.
 */
export function localDateTime(value) {
  const moment = value ? new Date(value) : null;
  if (!moment || Number.isNaN(moment.getTime())) return "";
  const minutes = `${moment.getFullYear()}-${pad(moment.getMonth() + 1)}-${pad(moment.getDate())}T${pad(moment.getHours())}:${pad(moment.getMinutes())}`;
  const seconds = moment.getSeconds() || moment.getMilliseconds() ? `:${pad(moment.getSeconds())}` : "";
  const milliseconds = moment.getMilliseconds() ? `.${String(moment.getMilliseconds()).padStart(3, "0")}` : "";
  return `${minutes}${seconds}${milliseconds}`;
}

/** Whether a field is one of the types these conversions handle. */
export const SHARED_TYPES = new Set(["person", "tags", "datetime", "url", "longtext"]);

/**
 * The people a person field picks from: the home's, and the one the record holds when they've left the home (shown as
 * the record reads them, "Former member"), so the field shows them rather than their id.
 */
export function personChoices(people, value) {
  if (!value || typeof value !== "object" || people.some((person) => person.id === value.id)) return people;
  return [...people, { id: value.id, name: value.label }];
}

/** A stored value of one of those types as the form holds it. */
export function inputOf(field, value) {
  if (field.type === "person") return value && typeof value === "object" ? value.id : (value ?? null);
  if (field.type === "tags") return Array.isArray(value) ? [...value] : [];
  if (field.type === "datetime") return localDateTime(value);
  return value ?? "";
}

/** What the form holds for one of those types, as the server takes it; empty is null. */
export function storedOf(field, value) {
  if (field.type === "tags") return Array.isArray(value) && value.length ? value.map(String) : null;
  if (field.type === "datetime") {
    const moment = value ? new Date(value) : null;
    return moment && !Number.isNaN(moment.getTime()) ? moment.toISOString() : null;
  }
  return value === "" || value === undefined ? null : value;
}

/** What both forms take as an email address. */
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

/** The input type of a text-like field, by its type. */
export const TEXT_INPUT = Object.freeze({ email: "email", date: "date", number: "number", money: "number", phone: "tel", url: "url", datetime: "datetime-local" });

/**
 * A form's values when its record is read again, as a live screen does when a job or someone else changes it (D-144):
 * on the same record, each field the person typed in (`touched`) keeps what they typed while it still differs from the
 * record, and every other field shows the record's new value (`toInput`, the form's own conversion); another record
 * starts afresh. Answers the values and the fields still typed in.
 */
export function refreshedDraft(fields, draft, touched, previous, next, toInput) {
  const same = Boolean(previous && next) && String(previous.id) === String(next.id);
  const kept = new Set(fields
    .filter((field) => same && touched.has(field.key) && String(draft[field.key] ?? "") !== String(toInput(field, next[field.key]) ?? ""))
    .map((field) => field.key));
  return {
    draft: Object.fromEntries(fields.map((field) => [field.key, kept.has(field.key) ? draft[field.key] : toInput(field, next?.[field.key])])),
    touched: kept
  };
}
