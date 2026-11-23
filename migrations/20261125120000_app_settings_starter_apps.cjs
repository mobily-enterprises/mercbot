/**
 * Every home gets the Contacts and To-dos apps, empty, the first time it's opened (D-130): `starter_apps_at` says when
 * this home got them, so they're added once. Only adds (expand): a nullable column the release before never reads.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable("app_settings", (table) => {
    table.timestamp("starter_apps_at", { useTz: true }).nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("app_settings", (table) => {
    table.dropColumn("starter_apps_at");
  });
};
