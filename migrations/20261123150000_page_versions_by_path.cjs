/**
 * The versions of some pages in a home by their paths alone (files' pages.pathsChanged): a page in the home's own
 * folder is any bot's, so moving or deleting it reads `page_versions` by home and path with no bot, which
 * `ix_page_versions_page` (workspace_id, bot_id, path, id) can't narrow past the home: a folder move read every version
 * of every page in the home. Built CONCURRENTLY, outside a transaction, so the table keeps taking saves while it builds.
 * Only adds (expand).
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw("CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_page_versions_path ON page_versions (workspace_id, path)");
};

exports.down = async function down(knex) {
  await knex.raw("DROP INDEX CONCURRENTLY IF EXISTS ix_page_versions_path");
};

// CREATE INDEX CONCURRENTLY can't run inside a transaction.
exports.config = { transaction: false };
