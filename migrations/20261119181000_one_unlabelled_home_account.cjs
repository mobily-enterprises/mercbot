/**
 * A home has one unlabelled account of an app at most (D-94): the one adding an app made for the home, such as Sedna's
 * with the home's API credentials (D-93). Two owners adding it at once both found none and each made one; now the second
 * loses this index's race and finds the first (integrationsService.js installForHome). Accounts added for everyone with a
 * label ("Add another account") aren't affected. A home that already has two is named, with the fix, before anything
 * changes.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const { rows } = await knex.raw(`
    SELECT workspace_id, plugin_id, count(*) AS accounts FROM plugin_accounts
    WHERE workspace_id IS NOT NULL AND name = ''
    GROUP BY workspace_id, plugin_id HAVING count(*) > 1
  `);
  if (rows.length) {
    const homes = rows.map((row) => `home ${row.workspace_id}: ${row.accounts} unlabelled ${row.plugin_id} accounts`).join("; ");
    throw new Error(
      `One unlabelled home account per app can't be kept yet (${homes}). An owner or admin of each home removes the extra ` +
        "one in Connect apps (the app's accounts, Remove), then the migration runs again."
    );
  }
  await knex.raw(
    "CREATE UNIQUE INDEX ix_plugin_accounts_home_unlabelled ON plugin_accounts (workspace_id, plugin_id) WHERE workspace_id IS NOT NULL AND name = ''"
  );
};

exports.down = async function down(knex) {
  await knex.raw("DROP INDEX IF EXISTS ix_plugin_accounts_home_unlabelled");
};
