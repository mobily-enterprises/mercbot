/**
 * Bots and pictures for apps' scripts (D-136): an app's script queues AI work as app jobs the bots' runner claims.
 * Only adds (expand): the release before never writes these kinds or columns.
 * - app_jobs_kind_check: also 'ai_batch' (items a bot answers in one session, into a field of each item's record) and
 *   'ai_picture' (a picture made into a record's files field).
 * - app_jobs.app_id: the app whose script queued it, for the app's Logic tab and its limit on work at once; null for
 *   the tasks before (watches, hand-offs, commands). Gone with its app.
 * - app_jobs.error: why AI work failed, in words for the app's people.
 * - ix_app_jobs_app: an app's AI work, newest first, read without the rest of the queue.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw(
    "alter table app_jobs drop constraint app_jobs_kind_check, add constraint app_jobs_kind_check " +
      "check (kind in ('watch', 'handoff', 'shell', 'ai_batch', 'ai_picture'))"
  );
  await knex.raw("alter table app_jobs add column app_id varchar(24) references apps (id) on delete cascade, add column error text");
  await knex.raw("create index ix_app_jobs_app on app_jobs (app_id, id) where app_id is not null");
};

exports.down = async function down(knex) {
  await knex.raw("drop index if exists ix_app_jobs_app");
  await knex.raw("alter table app_jobs drop column if exists error, drop column if exists app_id");
  await knex.raw(
    "alter table app_jobs drop constraint app_jobs_kind_check, add constraint app_jobs_kind_check " +
      "check (kind in ('watch', 'handoff', 'shell'))"
  );
};
