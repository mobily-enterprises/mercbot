// The new field types as the forms hold them while someone types (D-130): a person as their id, picked from the home's
// people; tags as a list of words; a date and time in the reader's own zone, as a datetime-local input takes it.
// Each form converts its other types itself; these are the same in both.

const pad = (number) => String(number).padStart(2, "0");

/** A stored datetime (an ISO instant) as a datetime-local input's value, in this browser's zone, or "". */
export function localDateTime(value) {
  const moment = value ? new Date(value) : null;
  if (!moment || Number.isNaN(moment.getTime())) return "";
  return `${moment.getFullYear()}-${pad(moment.getMonth() + 1)}-${pad(moment.getDate())}T${pad(moment.getHours())}:${pad(moment.getMinutes())}`;
}

/** Whether a field is one of the types these conversions handle. */
export const SHARED_TYPES = new Set(["person", "tags", "datetime", "url", "longtext"]);

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

/** The input type of a text-like field, by its type. */
export const TEXT_INPUT = Object.freeze({ email: "email", date: "date", number: "number", money: "number", phone: "tel", url: "url", datetime: "datetime-local" });
