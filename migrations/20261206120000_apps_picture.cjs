/**
 * An app's own picture on its tile (D-141), drawn by a bot and kept with the home's Database files: its path, in place
 * of the set picture (`icon`) while there is one. Only adds (expand): a column the release before never reads; null
 * is the set picture, as every app had.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw("alter table apps add column picture varchar(500)");
};

exports.down = async function down(knex) {
  await knex.raw("alter table apps drop column if exists picture");
};
