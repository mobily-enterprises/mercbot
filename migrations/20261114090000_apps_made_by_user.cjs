/**
 * The apps a person made, read by person across homes (createAppsRepository's appsMadeBy). Only apps a person made
 * are indexed, the rows the read reaches.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw("CREATE INDEX ix_apps_made_by_user ON apps (made_by_user_id, created_at DESC) WHERE made_by_user_id IS NOT NULL");
};

exports.down = async function down(knex) {
  await knex.raw("DROP INDEX IF EXISTS ix_apps_made_by_user");
};
