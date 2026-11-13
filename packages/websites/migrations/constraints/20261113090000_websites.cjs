/**
 * A home's own website and the pages published to it (D-84). Both tables belong to the websites package, so a server
 * composed without it has neither; they are made after the app's own migrations (a package's constraints/ directory),
 * since a publication names a bot.
 *
 * home_websites: one per home. Where pages are uploaded (a folder or S3-compatible storage, with its keys) is sealed
 * with the vault key in `settings`; `base_url` is the address the website serves that place at. `confirmed_at` is
 * when someone agreed that pages put there become public: the first publish to a new place asks first.
 *
 * page_publications: a page published there, named as its link is (D-74) by its bot and its path, at
 * <base_url>/<slug>/. `marker` is the random id the copy's .mercbot-page.json carries: Mercbot replaces or removes
 * only a folder holding its own marker. `published_at` stays empty until the first upload has finished.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable("home_websites", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("workspace_id").notNullable().references("id").inTable("workspaces").onDelete("CASCADE");
    table.string("kind", 12).notNullable();
    table.text("base_url").notNullable();
    table.jsonb("settings").notNullable();
    table.timestamp("confirmed_at", { useTz: true }).nullable();
    table.unique(["workspace_id"], { indexName: "ux_home_websites_home" });
  });
  await knex.raw("alter table home_websites add constraint home_websites_kind_check check (kind in ('folder', 's3'))");

  await knex.schema.createTable("page_publications", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("workspace_id").notNullable().references("id").inTable("workspaces").onDelete("CASCADE");
    table.bigInteger("bot_id").notNullable().references("id").inTable("bots").onDelete("CASCADE");
    table.text("path").notNullable();
    table.string("slug", 80).notNullable();
    table.string("marker", 32).notNullable();
    table.timestamp("published_at", { useTz: true }).nullable();
    table.unique(["workspace_id", "bot_id", "path"], { indexName: "ux_page_publications_page" });
    table.unique(["workspace_id", "slug"], { indexName: "ux_page_publications_slug" });
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTable("page_publications");
  await knex.schema.dropTable("home_websites");
};
