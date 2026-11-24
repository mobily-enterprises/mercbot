/**
 * An app made from a ready-made template remembers which (`template_key`) and the template's version it was made or
 * last updated from (`template_version`, a short hash of the template's screens and tables), so the home's Builder can
 * tell when the template has changed and bring the app up to date as a draft (D-130). Only adds (expand): nullable
 * columns the release before never reads.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable("apps", (table) => {
    table.string("template_key", 64).nullable();
    table.string("template_version", 32).nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("apps", (table) => {
    table.dropColumn("template_key");
    table.dropColumn("template_version");
  });
};
