/**
 * A home's settings for its bots (D-100), one row per home, owned by the bots package and made the first time one is
 * set. `new_bot_sharing` is the sharing every bot made in the home from then on gets (private, mixed or shared): NULL
 * until chosen, which means Mixed, as before. `team_question_answered_at` is when an owner or admin answered the
 * question shown once the home's people went from one to two: answered, it isn't asked again. `updated_by` is who last
 * changed the row (NULL once that account is gone).
 *
 * The row is keyed by its own `id`, as every table a JSKIT handle scopes to a home is, and `workspace_id` is unique, so
 * a home has one and two first writes at once make one (an upsert on it).
 *
 * A home that already has two active people or more has seen its first other person join before this release, so its
 * question counts as answered: it is asked only when a home goes from one person to two from now on. Its new bots stay
 * Mixed until one of its owners or admins chooses otherwise.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw(`
    CREATE TABLE home_settings (
      id bigserial PRIMARY KEY,
      workspace_id bigint NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
      new_bot_sharing character varying(16),
      team_question_answered_at timestamp with time zone,
      updated_by bigint REFERENCES users (id) ON DELETE SET NULL,
      updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
      CONSTRAINT home_settings_new_bot_sharing_check CHECK ((new_bot_sharing IN ('private', 'mixed', 'shared'))),
      CONSTRAINT home_settings_workspace_unique UNIQUE (workspace_id)
    )
  `);
  await knex.raw(`
    INSERT INTO home_settings (workspace_id, team_question_answered_at)
      SELECT workspace_id, CURRENT_TIMESTAMP FROM workspace_memberships
      WHERE status = 'active'
      GROUP BY workspace_id
      HAVING count(*) > 1
  `);
};

exports.down = async function down(knex) {
  await knex.raw("DROP TABLE IF EXISTS home_settings");
};
