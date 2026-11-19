/**
 * Who a home's person is at an app connected with the home's API credentials (D-93, packages/integrations/src/server/
 * appPeople.js), when their sign-in address finds no user there: the user they picked as themselves, `asked` until an
 * owner or admin of the home confirms it (an owner's or admin's own pick is confirmed at once), and only then used.
 * `org` is the organisation the credentials were for (Sedna's tenant): a pick holds only there. No two people are
 * confirmed as one user of one organisation. A row goes with its account, its person and its home.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw(`
    CREATE TABLE plugin_account_people (
      id bigserial PRIMARY KEY,
      workspace_id bigint NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
      account_id bigint NOT NULL REFERENCES plugin_accounts (id) ON DELETE CASCADE,
      user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      org character varying(100) NOT NULL,
      app_user_id character varying(64) NOT NULL,
      app_user_name character varying(200) NOT NULL,
      status character varying(16) NOT NULL,
      confirmed_by bigint REFERENCES users (id) ON DELETE SET NULL,
      confirmed_at timestamp with time zone,
      created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
      CONSTRAINT plugin_account_people_status_check CHECK ((status IN ('asked', 'confirmed'))),
      CONSTRAINT plugin_account_people_person_unique UNIQUE (account_id, user_id)
    )
  `);
  await knex.raw(
    "CREATE UNIQUE INDEX ix_plugin_account_people_confirmed ON plugin_account_people (account_id, org, app_user_id) WHERE status = 'confirmed'"
  );
  await knex.raw("CREATE INDEX plugin_account_people_workspace_id_index ON plugin_account_people (workspace_id)");
};

exports.down = async function down(knex) {
  await knex.raw("DROP TABLE IF EXISTS plugin_account_people");
};
