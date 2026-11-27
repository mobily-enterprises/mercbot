/**
 * The home's own time zone for its apps (D-140): "today" in formulas and filters, a job's day, and weeks and months in
 * totals. Only adds (expand): a column the release before never reads; null is UTC.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw("alter table app_settings add column time_zone varchar(64)");
};

exports.down = async function down(knex) {
  await knex.raw("alter table app_settings drop column if exists time_zone");
};
