/**
 * The GitHub repositories a person let a bot use in its commands (D-128), `bot_github_repos`: each row is one person's
 * yes on the bot's card, theirs in the home (user_id), for one repository (GitHub's own id, which stays the same when
 * it's renamed, and its owner/name as the card showed it).
 * - Always for this bot: no chat_bot_id and no expires_at, one row per bot, person and repository
 *   (ux_bot_github_repos_always).
 * - Just this task: the bot's seat in the chat it was asked in (chat_bot_id) until expires_at.
 * A row goes with its bot, its seat, its person and its home. Only adds (expand): no release before reads it.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw(`
    CREATE TABLE bot_github_repos (
      id bigserial PRIMARY KEY,
      workspace_id bigint NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
      bot_id bigint NOT NULL,
      user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      repository_id bigint NOT NULL,
      full_name character varying(140) NOT NULL,
      chat_bot_id bigint REFERENCES chat_bots (id) ON DELETE CASCADE,
      expires_at timestamp with time zone,
      created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
      CONSTRAINT bot_github_repos_bot_foreign FOREIGN KEY (bot_id, workspace_id) REFERENCES bots (id, workspace_id) ON DELETE CASCADE,
      CONSTRAINT bot_github_repos_task_check CHECK ((chat_bot_id IS NULL) = (expires_at IS NULL)),
      CONSTRAINT bot_github_repos_name_check CHECK (full_name ~ '^[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9._-]+$')
    );
    CREATE UNIQUE INDEX ux_bot_github_repos_always ON bot_github_repos (workspace_id, bot_id, user_id, repository_id) WHERE chat_bot_id IS NULL;
    CREATE INDEX ix_bot_github_repos_person ON bot_github_repos (workspace_id, user_id, bot_id);
    CREATE INDEX ix_bot_github_repos_chat_bot ON bot_github_repos (chat_bot_id) WHERE chat_bot_id IS NOT NULL;
  `);
};

exports.down = async function down(knex) {
  await knex.raw("DROP TABLE IF EXISTS bot_github_repos;");
};
