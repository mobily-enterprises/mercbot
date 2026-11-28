import { showValue } from "../shared/formulas.js";
import { refused } from "./scriptConnected.js";

// Documents for scripts (D-140): `docs.pdf({ template, record, into, name })`, for a button's and a job's scripts, fills
// a web page from one record and makes it a PDF in a file field, as a record's file goes on (the data gate, as the run).
// The template is HTML with {{field}} for the record's fields, shown as screens show them, and
// {{lines:table:link:field,field}} for a table of the records of `table` whose `link` points at it (an invoice's lines),
// shown the same way. Values are escaped; the page is made in the office apps' sandbox, which has no network, so it
// loads nothing from outside. A draft's preview makes none.
//
// And `docs.text({ record, field })` (D-143) reads a record's file as text, for a script to work from (a book to
// summarise, a contract to check): through the gate as the run, so only a file it may see, at most 1,000,000 characters
// (`more` says there were others), 3 a run. It only reads, so a draft's preview reads too.
const DOC_LIMITS = Object.freeze({ templateChars: 20000, perRun: 3, lines: 200, textChars: 1000000 });

const PAGE_STYLE =
  "body{font-family:sans-serif;font-size:11pt;color:#1c1c1c;margin:32px}" +
  "table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border:1px solid #c8c8c8;padding:4px 8px;text-align:left}" +
  "th{background:#f0f0f0}";
const PLACE = /\{\{\s*([^{}]+?)\s*\}\}/gu;

const escaped = (text) => String(text).replace(/[&<>"']/gu, (char) => `&#${char.charCodeAt(0)};`);

/** A lines place's text as one key, whatever its spaces: "lines:table:link:field,field". */
const linesKey = (inside) => {
  const [, table, link, fields = ""] = inside.split(":").map((part) => part.trim());
  return `lines:${table}:${link}:${fields.split(",").map((key) => key.trim()).filter(Boolean).join(",")}`;
};

/** The live field of a table by key, or a refusal naming the table's fields. */
function fieldOf(table, key) {
  const field = table.fields.find((entry) => !entry.obsolete && entry.key === key);
  if (!field) throw refused(`${table.key} has no field "${key}" (its fields: ${table.fields.filter((entry) => !entry.obsolete).map((entry) => entry.key).join(", ")})`);
  return field;
}

/**
 * The places a template names, in order: `{ kind: "field", key }` or `{ kind: "lines", table, link, fields }`; refused
 * when one isn't either.
 */
export function templatePlaces(template) {
  return [...String(template).matchAll(PLACE)].map(([, inside]) => {
    if (!inside.startsWith("lines:")) return { kind: "field", key: inside };
    const [, table, link, fields = ""] = inside.split(":").map((part) => part.trim());
    const keys = fields.split(",").map((key) => key.trim()).filter(Boolean);
    if (!table || !link || !keys.length) throw refused(`{{${inside}}} is {{lines:table:link:field,field}}, e.g. {{lines:invoice_lines:invoice:item,quantity,price}}`);
    return { kind: "lines", table, link, fields: keys };
  });
}

/**
 * The page of a record: `template` with each place filled, the record's (by field id, as the gate reads it) and each
 * lines place's rows (`lines`, by the place's text, each `{ table, records }`), in a whole page unless it is one.
 */
export function fillTemplate(template, table, record, lines = new Map()) {
  const body = String(template).replace(PLACE, (_match, inside) => {
    const trimmed = inside.trim();
    if (!trimmed.startsWith("lines:")) {
      const field = fieldOf(table, trimmed);
      return escaped(showValue(field, record[field.id]));
    }
    const { table: child, records } = lines.get(linesKey(trimmed));
    const fields = linesKey(trimmed).split(":")[3].split(",").map((key) => fieldOf(child, key));
    const head = fields.map((field) => `<th>${escaped(field.label)}</th>`).join("");
    const rows = records.map((row) => `<tr>${fields.map((field) => `<td>${escaped(showValue(field, row[field.id]))}</td>`).join("")}</tr>`);
    return `<table><thead><tr>${head}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
  });
  if (/^\s*<!doctype|^\s*<html/iu.test(body)) return body;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${PAGE_STYLE}</style></head><body>${body}</body></html>`;
}

/** A document's file name: words, ending .pdf. */
const fileName = (name) => `${String(name || "document").replace(/[^\p{L}\p{N} ._-]+/gu, "-").trim().slice(0, 80) || "document"}.pdf`.replace(/(\.pdf)+$/iu, ".pdf");

/**
 * @param {object} dependencies
 * @param {import("./types.js").DataGate} dependencies.gate
 */
export function createScriptDocs({ gate }) {
  /**
   * The host's `docs` calls for one run: `pdf` and `text`, at most DOC_LIMITS.perRun of each.
   * @param {{ options: object, practice?: { simulated: object[] }, via: { script: string } }} ctx the run's gate ctx
   */
  function forRun(ctx) {
    let made = 0;
    async function pdf({ template, record, into, name } = {}) {
      if ((made += 1) > DOC_LIMITS.perRun) throw refused(`at most ${DOC_LIMITS.perRun} docs.pdf a run`);
      const text = String(template || "");
      if (!text.trim() || text.length > DOC_LIMITS.templateChars) throw refused(`the template is 1 to ${DOC_LIMITS.templateChars} characters`);
      if (!record?.table || !record?.id) throw refused("record is { table, id }: the record the document is of");
      const target = typeof into === "string" ? { table: record.table, id: record.id, field: into } : into;
      if (!target?.table || !target?.id || !target?.field) throw refused("into is a file field of the record (its name), or { table, id, field }");
      const { table } = await gate.tableFor(String(record.table), ctx.options);
      const shown = await gate.get(ctx, table.id, String(record.id));
      const lines = new Map();
      for (const place of templatePlaces(text).filter((entry) => entry.kind === "lines")) {
        const key = linesKey(`lines:${place.table}:${place.link}:${place.fields.join(",")}`);
        const { table: child } = await gate.tableFor(place.table, ctx.options);
        const link = fieldOf(child, place.link);
        const where = { plan: { kind: "compare", op: "=", field: { name: link.id, lower: false }, value: JSON.stringify(String(shown.id)) }, variables: {}, values: {} };
        const { records } = await gate.read(ctx, child.id, { where, page: { size: DOC_LIMITS.lines } });
        lines.set(key, { table: child, records });
      }
      const html = fillTemplate(text, table, shown, lines);
      if (ctx.practice) {
        ctx.practice.simulated.push({ docs: { pdf: fileName(name) }, script: ctx.via.script });
        return { simulated: true };
      }
      const saved = await gate.makeDocument(ctx, String(target.table), String(target.id), String(target.field), html, fileName(name));
      const { table: targetTable } = await gate.tableFor(String(target.table), ctx.options);
      const file = saved[fieldOf(targetTable, String(target.field)).id];
      return { file: { name: file?.name, size: file?.size } };
    }
    let read = 0;
    async function text({ record, field } = {}) {
      if ((read += 1) > DOC_LIMITS.perRun) throw refused(`at most ${DOC_LIMITS.perRun} docs.text a run`);
      if (!record?.table || !record?.id || !field) throw refused("docs.text takes { record: { table, id }, field }: the record and its file field");
      return gate.recordFileText(ctx, String(record.table), String(record.id), String(field), { max: DOC_LIMITS.textChars });
    }
    return async (name, args) => {
      if (name === "text") return text(args[0]);
      if (name !== "pdf") throw refused(`docs has no ${name}`);
      return pdf(args[0]);
    };
  }

  return Object.freeze({ forRun });
}
