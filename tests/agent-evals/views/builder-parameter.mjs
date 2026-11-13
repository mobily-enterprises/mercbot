import { fail, pass, viewsOf, viewParts } from "./helpers.mjs";
// The hard one: a view that takes a parameter, on each record's own screen.
export async function setup(ctx) {
  const context = { workspaceId: ctx.workspaceId, actor: ctx.actor, via: { kind: "data" } };
  const customers = await ctx.apps.registry.createTable(ctx.workspaceId, ctx.actor, { key: "customers", fields: [{ key: "name", type: "text", required: true }] });
  const orders = await ctx.apps.registry.createTable(ctx.workspaceId, ctx.actor, {
    key: "orders",
    fields: [{ key: "item", type: "text", required: true }, { key: "customer", type: "link", target: "customers" }, { key: "total", type: "money" }]
  });
  const id = (table, key) => table.fields.find((field) => field.key === key).id;
  ctx.ana = await ctx.apps.gate.create(context, "customers", { [id(customers, "name")]: "Ana" });
  const ben = await ctx.apps.gate.create(context, "customers", { [id(customers, "name")]: "Ben" });
  for (const [item, who, total] of [["Desk", ctx.ana, 30000], ["Lamp", ctx.ana, 5000], ["Chair", ben, 12000]]) {
    await ctx.apps.gate.create(context, "orders", { [id(orders, "item")]: item, [id(orders, "customer")]: String(who.id), [id(orders, "total")]: total });
  }
}
export async function script({ say }) {
  await say("Make a Customers app: a list of customers, and when I click one, their own screen with a reusable view of that customer's orders. Make that view something other apps could use too, so make it a real view with the customer passed in, shared with the home.");
}
export async function judge(ctx) {
  const views = await viewsOf(ctx);
  const view = views.find((entry) => Object.keys(entry.body.params || {}).length);
  if (!view) return fail(`no view with a parameter: ${views.map((entry) => entry.row.name)}`);
  const made = await ctx.knex("apps").where({ workspace_id: ctx.workspaceId, kind: "app" });
  if (!made.length) return fail("no app");
  if (made.length > 1) return fail(`made ${made.length} apps: ${made.map((entry) => entry.slug)}`);
  const [app] = made;
  const { parts } = await viewParts(ctx, app.slug);
  const part = parts.find((entry) => entry.params && Object.values(entry.params).some((value) => /params\./u.test(String(value))));
  if (!part) return fail(`no part passing a parameter: ${JSON.stringify(parts)}`);
  const param = Object.keys(view.body.params)[0];
  const queries = Object.entries(view.body.data).filter(([, entry]) => entry.from === "orders");
  if (!queries.length) return fail("the view doesn't read orders");
  // A totals query often comes first, so check whichever query answers with the list of orders.
  const context = { workspaceId: ctx.workspaceId, actor: ctx.actor, via: { kind: "data" } };
  let items = null;
  for (const [query] of queries) {
    const answer = await ctx.apps.runtime.query(context, { slug: view.row.slug, screen: "main", query, params: { [param]: String(ctx.ana.id) } });
    if (Array.isArray(answer.records)) { items = answer.records.map((record) => record.item).sort(); break; }
  }
  if (!items) return fail("no list of the customer's orders");
  if (JSON.stringify(items) !== JSON.stringify(["Desk", "Lamp"])) return fail(`Ana's orders: ${JSON.stringify(items).slice(0, 200)}`);
  return pass();
}
