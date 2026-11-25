/**
 * A watch's tasks still waiting to run (D-134). Only adds (expand): an index the release before never reads.
 * - ix_app_jobs_waiting_watch: the queued tasks of each watch. A watch's limit of 30 an hour counts its runs in the hour
 *   and these at each firing, so the count reads that watch's waiting tasks alone, never the jobs table's history.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw("create index ix_app_jobs_waiting_watch on app_jobs (watch_id) where status = 'queued'");
};

exports.down = async function down(knex) {
  await knex.raw("drop index if exists ix_app_jobs_waiting_watch");
};
