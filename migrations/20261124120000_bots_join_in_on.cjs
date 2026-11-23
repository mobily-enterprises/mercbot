/**
 * "Bots join in when useful" is on (D-129): with it, every live bot of a chat with several people reads every person's
 * message and replies when it has something useful to say, so a person carries on with a bot without naming it every
 * time. On for every new chat (the column's default), and for every chat made before this: none chose Off, which was
 * only the default until now (D-115, O17). Only adds (expand): a default and values, nothing taken away; the release
 * before, still serving beside this one, reads the switch on as "the judge may name a bot", the nearest it knows.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw("ALTER TABLE conversations ALTER COLUMN bots_join_in SET DEFAULT true");
  await knex.raw("UPDATE conversations SET bots_join_in = true WHERE NOT bots_join_in");
};

exports.down = async function down(knex) {
  await knex.raw("ALTER TABLE conversations ALTER COLUMN bots_join_in SET DEFAULT false");
};
