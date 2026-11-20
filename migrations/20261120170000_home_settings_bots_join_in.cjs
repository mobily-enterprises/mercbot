/**
 * Whether a home's bots decide when to join in (D-102): in a Shared bot's shared tabs, in a home of two or more people,
 * the bot answers a message that doesn't call it only when one judging call says it makes sense; off, it answers only
 * when called. On by default, and a home with no row (nothing set yet) is on too. An added column with a default: the
 * release before, still serving beside this one, writes rows without it and gets true.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw("ALTER TABLE home_settings ADD COLUMN bots_join_in boolean DEFAULT true NOT NULL");
};

exports.down = async function down(knex) {
  await knex.raw("ALTER TABLE home_settings DROP COLUMN IF EXISTS bots_join_in");
};
