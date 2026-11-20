/**
 * A conversation can be archived (D-101): a Shared bot's shared tab, hidden for everyone in the home, or a person's own
 * "You only", hidden for them. `archived_at` says since when (null: not archived) and `archived_by` who did it, kept
 * when their account goes. The partial index finds a bot's archived conversations, which are few, without reading the
 * others. Only adds (expand): the release before reads none of it.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw(`
    ALTER TABLE bot_conversations
      ADD COLUMN archived_at timestamp with time zone,
      ADD COLUMN archived_by bigint REFERENCES users (id) ON DELETE SET NULL
  `);
  await knex.raw("CREATE INDEX ix_bot_conversations_archived ON bot_conversations (bot_id) WHERE archived_at IS NOT NULL");
};

exports.down = async function down(knex) {
  await knex.raw("DROP INDEX IF EXISTS ix_bot_conversations_archived");
  await knex.raw("ALTER TABLE bot_conversations DROP COLUMN IF EXISTS archived_by, DROP COLUMN IF EXISTS archived_at");
};
