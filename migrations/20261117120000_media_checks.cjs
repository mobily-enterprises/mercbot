/**
 * The pictures and videos waiting for a copy's check (D-90, packages/files/src/server/mediaChecks.js): a bot's computer's
 * screenshots and the files bots save, checked afterwards, a batch at a time, by whichever server takes them first.
 * `check_after` is when a row may be taken: now for a new one, a few minutes on while a server checks it, and later
 * again, further each time, while the check can't be made. The rows go once their file is checked, or gone. A
 * home's rows go with it; the bot, person and conversation are only whose a file is, so a check outlives them.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw(`
    CREATE TABLE media_checks (
      id bigserial PRIMARY KEY,
      workspace_id bigint NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
      origin character varying(16) NOT NULL,
      place jsonb,
      path text NOT NULL,
      bot_id bigint,
      user_id bigint,
      conversation_id bigint,
      attempts integer DEFAULT 0 NOT NULL,
      check_after timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
      created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
      CONSTRAINT media_checks_origin_check CHECK ((origin IN ('screenshot', 'saved_file')))
    )
  `);
  await knex.raw("CREATE INDEX ix_media_checks_due ON media_checks (check_after, id)");
};

exports.down = async function down(knex) {
  await knex.raw("DROP TABLE IF EXISTS media_checks");
};
