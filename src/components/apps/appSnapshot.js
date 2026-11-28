import { cleanSnapshot } from "@local/bots/shared/onScreen";
import { isFileField, showValue } from "@local/apps/shared";

// What's on the person's screen in an app, sent with each message they write to its bot from the app's chat (D-147):
// the app and screen, the tab and what the screen was opened with, the record it shows, every form's fields with what's
// typed in them (unsaved text included, whole, from AppForm's own entry in the runtime), the screen's words as shown and
// its lists' first rows, and the last thing the app said. Cut to the limits the server keeps (@local/bots/shared/onScreen).

// The parts whose words are what the screen shows (AppNode's data-app-type), read as the person sees them.
const SHOWN = ["text", "chip", "field", "totals", "progress", "board", "calendar", "timeline"].map((type) => `[data-app-type="${type}"]`).join(", ");

const typedText = (value) => (Array.isArray(value) ? value.join(", ") : value && typeof value === "object" ? value.name || "" : String(value ?? ""));

/**
 * One form as it is now (AppForm's entry in the runtime): each field shown with what's typed in it, whole, and whether
 * that's saved yet; a field the screen marks `private` is left out (and named, so the record open leaves it out too).
 * @param {{ table: object | null, record: object | null, creating: boolean, entries: Array<{ field: string, def: object,
 *   private?: boolean }>, draft: Record<string, unknown>, toInput: (field: object, value: unknown) => unknown }} form
 */
export function formOnScreen({ table, record, creating, entries, draft, toInput }) {
  const saved = (entry) => typedText(toInput(entry.def, record?.[entry.field]));
  return {
    about: creating ? `adding to ${table?.label ?? ""}` : `editing ${table?.label ?? ""} #${record?.id ?? ""}`,
    fields: entries.filter((entry) => !entry.private && !isFileField(entry.def)).map((entry) => ({
      // The form's own name for it, as it shows it.
      label: entry.label || entry.def.label,
      key: entry.field,
      value: typedText(draft[entry.field]),
      unsaved: creating ? typedText(draft[entry.field]) !== "" : typedText(draft[entry.field]) !== saved(entry)
    })),
    hidden: entries.filter((entry) => entry.private).map((entry) => entry.field)
  };
}

const textOf = (element) => String(element?.innerText ?? element?.textContent ?? "").replace(/[ \t]+\n/gu, "\n").trim();

/** The screen's words as shown, each part once (a part inside another shown part is read with it). */
function shownTexts(main) {
  const parts = [...main.querySelectorAll(SHOWN)];
  return parts.filter((part) => !parts.some((other) => other !== part && other.contains(part))).map(textOf).filter(Boolean);
}

/** The screen's lists as shown: each list part's first rows, its columns named. */
function listsOf(main) {
  return [...main.querySelectorAll('[data-app-type="table"]')].map((part) => {
    const head = [...part.querySelectorAll("thead th")].map(textOf);
    const rows = [...part.querySelectorAll("tbody tr")].map((row) => [...row.querySelectorAll("td")]
      .map((cell, at) => [head[at], textOf(cell)])
      .filter(([, cell]) => cell)
      .map(([name, cell]) => (name ? `${name}: ${cell}` : cell))
      .join(" · ")).filter(Boolean);
    return { name: part.dataset.appLabel || "", table: "", rows, total: null };
  });
}

/**
 * The record the screen shows: its single-record query by the screen's first parameter (what it was opened on), else
 * one by another parameter, else its first.
 */
function recordOf(runtime, hidden) {
  const queries = runtime?.screen?.data || {};
  const names = Object.keys(queries).filter((key) => queries[key]?.record);
  const [opened] = Object.keys(runtime?.screen?.params || {});
  const byParam = (param) => names.find((key) => String(queries[key].id || "").trim() === `=params.${param}`);
  const name = (opened && byParam(opened)) || names.find((key) => String(queries[key].id || "").includes("params.")) || names[0];
  const record = name ? runtime.data?.[name] : null;
  const table = name ? runtime.queryTable(name) : null;
  if (!record || !table) return null;
  const titleField = table.fields.find((field) => field.id === table.titleFieldId);
  const filled = (field) => !field.obsolete && !hidden.has(field.key) && !isFileField(field) && ![null, undefined, ""].includes(record[field.key]);
  return {
    table: table.label,
    id: String(record.id ?? ""),
    title: titleField && filled(titleField) ? showValue(titleField, record[titleField.key]) : "",
    values: table.fields.filter(filled).map((field) => ({ label: field.label, key: field.key, value: showValue(field, record[field.key]) }))
  };
}

/**
 * The snapshot of the screen open now.
 * @param {{ app: { name: string, slug: string }, screen: { key: string, title: string }, params?: Record<string, string>,
 *   runtime: object | null, main: Element | null, notice?: string }} where `runtime` the screen's (appRuntime.js), `main`
 *   the element its parts are drawn in, `notice` the last thing the app said (a button's message)
 */
export function screenSnapshot({ app, screen, params = {}, runtime, main, notice = "" }) {
  const forms = [...(runtime?.forms?.values() || [])].map((read) => read());
  const hidden = new Set(forms.flatMap((form) => form.hidden || []));
  return cleanSnapshot({
    app,
    screen,
    tab: main ? textOf(main.querySelector(".v-tab--selected")) || null : null,
    params: Object.fromEntries(Object.entries(params).filter(([, value]) => value !== "")),
    record: recordOf(runtime, hidden),
    forms: forms.map(({ about, fields }) => ({ about, fields })),
    shown: main ? shownTexts(main) : [],
    lists: main ? listsOf(main) : [],
    notice
  });
}
