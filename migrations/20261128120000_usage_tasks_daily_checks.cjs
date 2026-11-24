/**
 * A recurring task's day (D-132) keeps only the kinds Mercbot counts, a routine's or a watch's, and never a negative
 * count or cost: the recorder and the run counter only ever add to them (usage.js taskOf, countForTask, countRun), and
 * the table now says so too. Added NOT VALID and then validated, so the check of rows already there takes only a lock
 * that lets writes go on.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw(`alter table usage_tasks_daily
    add constraint ck_usage_tasks_daily_kind check (task_kind in ('routine', 'watch')) not valid,
    add constraint ck_usage_tasks_daily_counts check (runs >= 0 and calls >= 0 and cost_nano >= 0) not valid`);
  await knex.raw("alter table usage_tasks_daily validate constraint ck_usage_tasks_daily_kind");
  await knex.raw("alter table usage_tasks_daily validate constraint ck_usage_tasks_daily_counts");
};

exports.down = async function down(knex) {
  await knex.raw("alter table usage_tasks_daily drop constraint if exists ck_usage_tasks_daily_counts, drop constraint if exists ck_usage_tasks_daily_kind");
};
