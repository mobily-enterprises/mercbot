import { celSchema } from "./formulas.js";

// What a create form sends once its button has added the record (D-137): `onSubmit`, a list of
//   { "email": { "to": "=record.email", "subject": "Thanks for signing up", "text": "=\"See you on \" + record.day" } }
//   { "notify": { "to": "owners", "text": "=\"New sign-up: \" + record.name" } }
// whose formulas see the record as it was saved (`record`, by field names) besides the screen's values. It goes only when
// the app's owners and admins switched that kind of sending on, within its daily limits (appSending.js).
const SUBMIT_SENDS = { email: ["to", "subject", "text"], notify: ["to", "text"] };

/**
 * The save check of a create form's `onSubmit` at `path`: `table` is the form's table (null for an edit form, which has
 * none); `variables` what its formulas see besides `record`.
 */
export function checkOnSubmit(path, list, table, { report, formula, variables }) {
  if (!table) return report(path, "only a form that adds a record (table) sends on submit.");
  if (!Array.isArray(list) || list.length > 3) return report(path, 'is a list of up to 3 sends: { "email": { to, subject, text } } or { "notify": { to, text } }.');
  const scope = { ...variables, record: celSchema(table) };
  list.forEach((entry, index) => {
    const kinds = Object.keys(entry || {});
    const kind = kinds[0];
    if (kinds.length !== 1 || !SUBMIT_SENDS[kind]) return report(`${path}[${index}]`, 'is { "email": { to, subject, text } } or { "notify": { to, text } }.');
    for (const key of Object.keys(entry[kind] || {})) {
      if (!SUBMIT_SENDS[kind].includes(key)) report(`${path}[${index}].${kind}.${key}`, `${kind} has only ${SUBMIT_SENDS[kind].join(", ")}.`);
    }
    for (const key of SUBMIT_SENDS[kind]) {
      const value = entry[kind]?.[key];
      if (value === undefined || value === "") report(`${path}[${index}].${kind}.${key}`, `${kind} needs ${key}.`);
      else if (!(kind === "notify" && key === "to" && value === "owners")) formula(`${path}[${index}].${kind}.${key}`, value, scope, "string");
    }
  });
}
