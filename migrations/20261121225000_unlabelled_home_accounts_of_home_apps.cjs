/**
 * Only an app whose API credentials are the whole home's (D-93, Sedna today) keeps one unlabelled account in a home
 * (D-94), the one adding it made, so two owners adding it at once still find one. Any other app's accounts may now all go
 * without a label, each shown by its address (D-110), so the index that held
 * every app to one unlabelled home account is narrowed to those apps. The narrower index is made before the wider one
 * goes, so Sedna's is never unguarded; it can't fail, since every row the wider index allowed it allows.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw(
    "CREATE UNIQUE INDEX ix_plugin_accounts_home_app_unlabelled ON plugin_accounts (workspace_id, plugin_id) " +
      "WHERE workspace_id IS NOT NULL AND name = '' AND plugin_id IN ('sedna')"
  );
  await knex.raw("DROP INDEX ix_plugin_accounts_home_unlabelled");
};

exports.down = async function down(knex) {
  await knex.raw(
    "CREATE UNIQUE INDEX ix_plugin_accounts_home_unlabelled ON plugin_accounts (workspace_id, plugin_id) WHERE workspace_id IS NOT NULL AND name = ''"
  );
  await knex.raw("DROP INDEX ix_plugin_accounts_home_app_unlabelled");
};
