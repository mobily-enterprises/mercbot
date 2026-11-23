import { isCalculated } from "../shared/calculated.js";
import { GateError } from "./validate.js";

/**
 * A spreadsheet cell as the gate expects it: money is written in units (12.50 → 1250 cents),
 * yes/no accepts yes, no, true, false, 1 and 0, a date may carry a time, a link is the linked
 * record's title (as exported) or its id, a person is a member's name (as exported) or id, and a date and time
 * without a zone is read as UTC.
 */
export function fromSheet(table, row, titles, members = new Map()) {
  const input = {};
  for (const [fieldId, cell] of Object.entries(row || {})) {
    const field = table.fields.find((entry) => entry.id === fieldId);
    const text = String(cell ?? "").trim();
    // A calculated column of an exported sheet is worked out again from the others, never imported.
    if (!field || !text || isCalculated(field)) continue;
    if (field.type === "money") {
      const plain = text.replace(/[\s,]/gu, "").replace(/^[^\d.-]{1,3}/u, ""); // "$1,250.50" → "1250.50"
      if (!/^-?\d*\.?\d+$/u.test(plain)) {
        throw new GateError(400, `${field.label}: must be an amount like 12.50.`, {
          code: "apps_value_amount_invalid",
          params: { field: field.label }
        });
      }
      input[fieldId] = Math.round(Number(plain) * 100);
    } else if (field.type === "yesno") {
      const word = text.toLowerCase();
      input[fieldId] = ["yes", "y", "true", "1"].includes(word) ? true : ["no", "n", "false", "0"].includes(word) ? false : text;
    } else if (field.type === "date") {
      input[fieldId] = /^\d{4}-\d{2}-\d{2}T/u.test(text) ? text.slice(0, 10) : text;
    } else if (field.type === "person") {
      const ids = /^\d+$/u.test(text) ? [text] : members.get(text.toLowerCase()) || [];
      if (ids.length > 1) {
        throw new GateError(400, `${field.label}: ${ids.length} people in this home are called "${text}".`, {
          code: "apps_person_value_ambiguous",
          params: { field: field.label, count: ids.length, text }
        });
      }
      input[fieldId] = ids[0] || text;
    } else if (field.type === "datetime") {
      const plain = text.replace(" ", "T");
      input[fieldId] = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/u.test(plain) ? `${plain}Z` : plain;
    } else if (field.type === "link") {
      const ids = titles.get(fieldId)?.get(text.toLowerCase()) || [];
      if (ids.length > 1) {
        throw new GateError(400, `${field.label}: ${ids.length} records are called "${text}".`, {
          code: "apps_link_value_ambiguous",
          params: { field: field.label, count: ids.length, text }
        });
      }
      input[fieldId] = ids[0] || text;
    } else {
      input[fieldId] = cell;
    }
  }
  return input;
}
