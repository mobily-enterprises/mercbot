/**
 * Private tables (D-138): who may read a table's records and who may change them (everyone, owners and admins, or
 * named people), as the home's owners and admins choose. Only adds (expand): a column the release before never reads;
 * null is everyone, as every table was.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw("alter table app_tables add column access jsonb");
};

exports.down = async function down(knex) {
  await knex.raw("alter table app_tables drop column if exists access");
};
