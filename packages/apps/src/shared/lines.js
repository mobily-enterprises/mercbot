// Line items (D-140): a record's screen shows its child records and adds, edits and removes them in place, such as an
// invoice's lines or an order's items. The Builder writes one part:
//   { "type": "lines", "record": "=data.invoice", "table": "invoice_lines", "link": "invoice",
//     "columns": [{ "label": "Item", "value": "=row.item" }], "fields": ["item", "quantity", "price"], "label": "Lines" }
// and every screen that runs it, on the server and in the browser, works with what it stands for: the parts screens
// already have. Its lines are a list query of `table` whose `link` is the shown record's id, under its label; each row
// has Edit (it sets the screen value of the line being edited and opens a dialog with an edit form of it) and Remove
// (the row marked obsolete); an add form below adds a line already linked to the record. The record's id is the one its
// own query reads (`=params.id`), so the lines follow it.

/** The screen values, queries and dialog keys a lines part at `index` (in screen order) adds. */
const namesOf = (index) => ({ list: `lines_${index}`, edited: `line_${index}`, dialog: `line_${index}` });

/** Whether a part is a lines part with what it needs to stand in for: an id formula of its record's own query. */
const idOf = (screen, node) => {
  const query = /^=data\.(\w+)$/u.exec(String(node?.record || ""))?.[1];
  const id = query && screen?.data?.[query]?.record ? screen.data[query].id : null;
  return typeof id === "string" && id.startsWith("=") ? id.slice(1) : null;
};

/**
 * A screen with each lines part replaced by what it stands for (a grid of a list with Edit and Remove, an add form and
 * an edit dialog), and the queries and screen values those read; a screen without one comes back as it is. A lines part
 * whose record isn't one of the screen's single-record queries stays as it is, for the save check to name.
 * @param {object | undefined} screen
 */
export function expandLines(screen) {
  if (!screen || !JSON.stringify(screen.content || []).includes('"lines"')) return screen;
  const data = { ...(screen.data || {}) };
  const state = { ...(screen.state || {}) };
  let count = 0;
  const expand = (node) => {
    if (Array.isArray(node)) return node.map(expand);
    if (!node || typeof node !== "object") return node;
    if (node.type !== "lines") {
      const out = { ...node };
      if (Array.isArray(node.content)) out.content = expand(node.content);
      if (Array.isArray(node.tabs)) out.tabs = node.tabs.map((tab) => ({ ...tab, content: expand(tab?.content) }));
      return out;
    }
    const id = idOf(screen, node);
    if (!id || typeof node.table !== "string" || typeof node.link !== "string") return node;
    count += 1;
    const names = namesOf(count);
    const fields = Array.isArray(node.fields) ? node.fields : [];
    data[names.list] = { from: node.table, where: `=${node.link} == ${id}` };
    data[names.edited] = { record: node.table, id: `=state.${names.edited}` };
    state[names.edited] = { type: "string", default: "" };
    const rowActions = [
      {
        type: "button",
        label: "Edit",
        icon: "edit",
        emphasis: "subtle",
        do: [{ set: { state: names.edited, value: "=row.id" } }, { openDialog: names.dialog }]
      },
      { type: "button", label: "Remove", icon: "close", emphasis: "subtle", do: [{ markObsolete: { record: "=row" } }] }
    ];
    return {
      type: "grid",
      columns: 1,
      content: [
        ...(node.label ? [{ type: "text", value: node.label, size: "title" }] : []),
        { type: "table", rows: `=data.${names.list}`, columns: node.columns || [], rowActions },
        ...(node.add === false
          ? []
          : [{
              type: "form",
              table: node.table,
              fields,
              buttons: [{
                type: "button",
                label: "Add line",
                icon: "add",
                do: [{ create: { table: node.table, values: "=form.values", preset: { [node.link]: `=${id}` } } }]
              }]
            }]),
        {
          type: "dialog",
          key: names.dialog,
          title: "Edit line",
          content: [{
            type: "form",
            record: `=data.${names.edited}`,
            fields,
            buttons: [{
              type: "button",
              label: "Save",
              emphasis: "primary",
              do: [{ update: { record: `=data.${names.edited}`, set: "=form.values" } }, { closeDialog: names.dialog }]
            }]
          }]
        }
      ]
    };
  };
  const content = expand(screen.content || []);
  return count ? { ...screen, data, state, content } : screen;
}
