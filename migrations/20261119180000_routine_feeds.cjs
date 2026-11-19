/**
 * Where each routine has read a connected app's events feed up to (D-94): `feeds` keeps, by account ("sedna:<account
 * id>"), the page the routine's last good run stopped on and the events of that page it already handled, so its next run
 * starts after them. It's written only by the server holding the run, as the run ends well; null until a routine reads a
 * feed.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw("ALTER TABLE bot_routines ADD COLUMN feeds jsonb");
};

exports.down = async function down(knex) {
  await knex.raw("ALTER TABLE bot_routines DROP COLUMN IF EXISTS feeds");
};
