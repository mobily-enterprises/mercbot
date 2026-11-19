/**
 * Each connected account's Request pace (D-96, packages/integrations/src/server/appRequests.js): `pace` is the one its
 * owner, or for a home's account an owner or admin of the home, chose in Connect apps ("gentle", "normal" or "fast");
 * null, as every account had before, is Gentle. `plugin_account_turns` holds each account's next turn to send a
 * request to its app, `next_at`, shared by every server: a request takes the turn and moves it on, under the row's lock,
 * and an app's busy answer moves it past the time the app asked for. A row goes with its account.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw(`
    ALTER TABLE plugin_accounts ADD COLUMN pace character varying(16),
      ADD CONSTRAINT plugin_accounts_pace_check CHECK ((pace IS NULL OR pace IN ('gentle', 'normal', 'fast')))
  `);
  await knex.raw(`
    CREATE TABLE plugin_account_turns (
      account_id bigint PRIMARY KEY REFERENCES plugin_accounts (id) ON DELETE CASCADE,
      next_at timestamp with time zone NOT NULL
    )
  `);
};

exports.down = async function down(knex) {
  await knex.raw("DROP TABLE IF EXISTS plugin_account_turns");
  await knex.raw("ALTER TABLE plugin_accounts DROP CONSTRAINT IF EXISTS plugin_accounts_pace_check, DROP COLUMN IF EXISTS pace");
};
