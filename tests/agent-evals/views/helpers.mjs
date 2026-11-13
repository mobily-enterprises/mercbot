import { checkView, viewBody } from "../../../packages/apps/src/shared/check.js";
import { toNames } from "../../../packages/apps/src/shared/definitions.js";

// What the judges of the views cases look at (D-55): the home's views as they're really stored,
// what their queries answer, and the cards the bot posted. Each case is a person's own words, so a
// judge checks what happened, never how the bot phrased it.
export const fail = (notes) => ({ pass: false, notes });
export const pass = (notes = "") => ({ pass: true, notes });

const DEALS = [
  ["Acme renewal", "New", 90000], ["Bolt rollout", "New", 12000], ["Cedar pilot", "New", 45000], ["Delta audit", "Proposal", 300000],
  ["Echo licences", "Proposal", 21000], ["Fern support", "Proposal", 76000], ["Gale upgrade", "Proposal", 150000], ["Hale training", "New", 8000],
  ["Iris migration", "Proposal", 220000], ["Jade review", "New", 33000], ["Kite expansion", "Proposal", 510000], ["Lumen trial", "New", 5000],
  ["Mesa contract", "Won", 999000], ["Nova deal", "Lost", 888000]
];
export const OPEN_TOTAL = DEALS.filter(([, stage]) => !["Won", "Lost"].includes(stage)).reduce((sum, [, , amount]) => sum + amount, 0);

/** A home's sales data, as a person who has been using Mercbot for a while has it. */
export async function dealsTable(ctx) {
  const context = { workspaceId: ctx.workspaceId, actor: ctx.actor, via: { kind: "data" } };
  const table = await ctx.apps.registry.createTable(ctx.workspaceId, ctx.actor, {
    key: "deals",
    fields: [
      { key: "title", type: "text", required: true },
      { key: "stage", type: "choice", choices: ["New", "Proposal", "Won", "Lost"] },
      { key: "amount", type: "money" }
    ]
  });
  const id = (key) => table.fields.find((field) => field.key === key).id;
  for (const [title, stage, amount] of DEALS) {
    await ctx.apps.gate.create(context, "deals", { [id("title")]: title, [id("stage")]: stage, [id("amount")]: amount });
  }
  return { context, id };
}

/** Another bot in the home, with its own chat. */
export async function anotherBot(ctx, name) {
  const [bot] = await ctx.knex("bots").insert({ user_id: ctx.userId, workspace_id: ctx.workspaceId, name, color: "#1E86FC" }).returning("*");
  await ctx.knex("bot_conversations").insert({ workspace_id: ctx.workspaceId, bot_id: bot.id, user_id: ctx.userId });
  return bot;
}

/** A view the person already has, saved as their bot would have saved it. */
export function haveView(ctx, title, definition, { botId = ctx.bot.id } = {}) {
  const context = { workspaceId: ctx.workspaceId, actor: { type: "bot", id: String(botId), name: "A bot" }, via: { kind: "chat" } };
  return ctx.apps.views.save(context, { title, summary: `${title}, kept up to date`, definition }, { userId: ctx.userId, botId });
}

export const PIPELINE = {
  data: {
    byStage: { from: "deals", where: '=stage != "Won" && stage != "Lost"', groupBy: "stage", sum: "amount" },
    biggest: { from: "deals", where: '=stage != "Won" && stage != "Lost"', sort: "-amount", limit: 5 }
  },
  content: [
    { type: "chart", label: "Open deals by stage", kind: "bar", rows: "=data.byStage", measure: "total" },
    { type: "table", rows: "=data.biggest", columns: [{ label: "Deal", value: "=row.title" }, { label: "Value", value: "=row.amount" }] }
  ]
};

/** The home's views: as stored, by names, checked again, with every query run for real. */
export async function viewsOf(ctx) {
  const tables = await ctx.apps.registry.loadTables(ctx.workspaceId);
  const rows = await ctx.knex("apps").where({ workspace_id: ctx.workspaceId, kind: "view" }).orderBy("created_at");
  const context = { workspaceId: ctx.workspaceId, actor: ctx.actor, via: { kind: "data" } };
  const views = [];
  for (const row of rows) {
    const versions = await ctx.knex("app_versions").where({ app_id: row.id }).orderBy("number");
    const live = versions.find((version) => version.id === row.live_version_id);
    const body = viewBody(toNames(live.definition, tables));
    const answers = {};
    for (const query of Object.keys(body.data || {})) answers[query] = await ctx.apps.runtime.query(context, { slug: row.slug, screen: "main", query });
    views.push({ row, versions, body, answers, errors: checkView(body, tables), parts: JSON.stringify(body.content) });
  }
  return views;
}

/** Every message the bot posted in a chat since the start, by kind. */
export async function cards(ctx, kind, bot = ctx.bot) {
  return ctx.knex("bot_messages").where({ bot_id: bot.id, kind }).orderBy("id");
}

/** The tools a bot called in a chat. */
export async function toolsCalled(ctx, bot = ctx.bot) {
  const messages = await ctx.knex("bot_messages").where({ bot_id: bot.id, kind: "text", role: "bot" });
  return messages.flatMap((message) => message.body?.transcript || [])
    .flatMap((message) => (Array.isArray(message.content) ? message.content.filter((part) => part.type === "tool-call").map((part) => part.toolName) : []));
}

/** An app's parts of a kind, in a version's definition by names: `draft` or `live`. */
export async function viewParts(ctx, slug, version = "draft") {
  const { definition } = await ctx.apps.apps.get(ctx.workspaceId, slug, { version });
  const parts = [];
  const walk = (value) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== "object") return;
    if (value.type === "view") parts.push(value);
    Object.values(value).forEach(walk);
  };
  walk(definition?.screens);
  return { definition, parts };
}

const NOT_DONE = /\b(can't|cannot|can not|couldn't|isn't possible|not able|unable|don't have|only (?:shows?|displays?)|read-only|no buttons?|ask the builder|the builder)\b/iu;
export const saysItCant = (reply) => NOT_DONE.test(reply);
