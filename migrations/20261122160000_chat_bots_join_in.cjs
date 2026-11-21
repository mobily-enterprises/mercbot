/**
 * Whether a chat's bots join in when useful (D-115, B4): in a chat with several people, a person's message that calls
 * no bot goes through one judging call, which lets at most one of the chat's bots answer it. Off by default (O17), so
 * every chat made before this, and every new one, answers only when called (R3) until its maker or one of the home's
 * owners and admins switches it on in Chat details. Only adds (expand): an added column with a default, so the release
 * before, still serving beside this one, writes chats without it and gets false.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw("ALTER TABLE conversations ADD COLUMN bots_join_in boolean DEFAULT false NOT NULL");
};

exports.down = async function down(knex) {
  await knex.raw("ALTER TABLE conversations DROP COLUMN IF EXISTS bots_join_in");
};
