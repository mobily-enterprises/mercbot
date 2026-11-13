name: Views
description: Live figures from the home's tables: lists, totals and charts that stay up to date, saved at once.
pickable: no
---
A view shows figures from the home's tables and is always up to date. Any bot can make one with view_save; it opens at once, with no draft or publishing.

Choose:
- A **view** when someone wants figures that are in the home's tables and should stay current: open deals by stage, overdue invoices, this month's totals.
- A **page** for written content to keep: a guide, a plan, a checklist. A page's figures don't update.
- An **app** when people need to enter or change things: ask the home's Builder. Only the Builder makes apps and tables.
- If the figures aren't in a table yet, say so, and that the Builder can make one. Use data_tables to see what exists.

Keep one view per question. When the person asks to change a view, read it with view_get and save it again with its key; never make a second one. Use view_list to find one made earlier.

A view has:
- data: named queries. A list: { "from": "<table>", "where": "=<formula>", "sort": "-<field>", "limit": 10 }. One record: { "record": "<table>", "id": "=params.id" }. Totals: { "from": "<table>", "groupBy": "<field>", "sum": "<number or money field>", "grandTotal": true } (or avg, or just groupBy to count; grandTotal adds one Total line).
- content: the parts to show. Only these: text, chip, spacer, row, grid, tabs, input, table, field, totals, chart. No forms, buttons, dialogs or scripts, and tables don't react to clicks: a view only shows things.
- A heading is { "type": "text", "value": "Biggest deals", "size": "title" }: text shows as plain words, never Markdown. A table is { "type": "table", "rows": "=data.<list query>", "columns": [{ "label": "…", "value": "=row.<field>" }] }. A chart is { "type": "chart", "label": "…", "kind": "bar", "rows": "=data.<totals query>", "measure": "total" } ("count" when the query has no sum or avg), kind bar, line or pie. Totals are { "type": "totals", "label": "…", "rows": "=data.<totals query>" }. A field is { "type": "field", "label": "…", "value": "=data.<record query>.<field>" }.
- params: values an app passes in, as { "customer": {} }; read them as =params.customer. Only give a view params when an app will show it for one record.
- state: values a person types in an input, to filter with, as { "search": { "type": "string" } }.
- style: optional CSS, as an app's.

For example, open deals by stage and the ten biggest:
{
  "data": {
    "byStage": { "from": "deals", "where": "=status != \"Won\"", "groupBy": "stage", "sum": "value", "grandTotal": true },
    "biggest": { "from": "deals", "where": "=status != \"Won\"", "sort": "-value", "limit": 10 }
  },
  "content": [
    { "type": "chart", "label": "Open deals by stage", "kind": "bar", "rows": "=data.byStage", "measure": "total" },
    { "type": "text", "value": "Ten biggest", "size": "title" },
    { "type": "table", "rows": "=data.biggest", "columns": [{ "label": "Deal", "value": "=row.name" }, { "label": "Value", "value": "=row.value" }] }
  ]
}

If it isn't saved, the errors name each place: fix them and save again. Say in one line what the view shows; the card shows the rest. Everyone in the home sees every view from the start, so an app can use it at once. People restore and retire views, never bots; nothing is deleted.
