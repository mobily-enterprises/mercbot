/**
 * People mentioned in chats (D-114, B3). A person's place in a chat (`chat_people`) keeps `mentioned_at`: since when
 * someone else's message there has mentioned them (`<@person:ID>`) and they haven't read the chat since. The chat list
 * shows an "@" on that chat while it's set, and reading the chat clears it, as it clears `unread`. A copy built on
 * Mercbot can tell a person of a mention they leave unread (the time it has waited is the time since `mentioned_at`).
 * Only adds (expand): the release before reads none of it, and existing rows need no value.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw(`
    ALTER TABLE chat_people
      ADD COLUMN mentioned_at timestamp with time zone;
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`
    ALTER TABLE chat_people DROP COLUMN IF EXISTS mentioned_at;
  `);
};
