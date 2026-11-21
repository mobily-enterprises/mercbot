/**
 * A bot can be archived (D-108): put away for everyone in the home, its chats kept, until someone unarchives it.
 * `archived_at` says since when (null: not archived, every bot already there) and `archived_by` who did it, kept when
 * their account goes. Each person's pins and section stay on their own conversation with the bot, untouched, so an
 * unarchived bot is back where it was for everyone. Only adds (expand): the release before reads none of it, and
 * existing rows need no value.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw(`
    ALTER TABLE bots
      ADD COLUMN archived_at timestamp with time zone,
      ADD COLUMN archived_by bigint REFERENCES users (id) ON DELETE SET NULL
  `);
};

exports.down = async function down(knex) {
  await knex.raw("ALTER TABLE bots DROP COLUMN IF EXISTS archived_by, DROP COLUMN IF EXISTS archived_at");
};
