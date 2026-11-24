/**
 * What each recurring task cost (D-132): usage_tasks_daily keeps, per home, day (UTC) and task (a routine or a watch,
 * by its kind and id), how many times it ran, its AI calls and what they cost at their providers, with the person it
 * runs as (user_id, 0 for none) so a member sees only their own tasks' costs. One row per task per day it runs, kept
 * 13 months, then deleted by the usage upkeep, which finds old days by their own index. app_watches gains last_run_at,
 * when its last run was queued, for the home's list of recurring tasks. Only adds (expand): a table and a nullable
 * column the release before never reads.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw(`
    create table usage_tasks_daily (
      workspace_id bigint not null default 0,
      id bigserial,
      day date not null,
      task_kind varchar(12) not null,
      task_id varchar(64) not null,
      user_id bigint not null default 0,
      runs integer not null default 0,
      calls integer not null default 0,
      cost_nano bigint not null default 0,
      primary key (workspace_id, id)
    ) with (fillfactor = 80, autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02)`);
  await knex.raw("create unique index ux_usage_tasks_daily_key on usage_tasks_daily (workspace_id, day, task_kind, task_id)");
  await knex.raw("create index ix_usage_tasks_daily_id on usage_tasks_daily (id)");
  await knex.raw("create index ix_usage_tasks_daily_day on usage_tasks_daily (day)");
  await knex.schema.alterTable("app_watches", (table) => {
    table.timestamp("last_run_at", { useTz: true }).nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("app_watches", (table) => {
    table.dropColumn("last_run_at");
  });
  await knex.raw("drop table if exists usage_tasks_daily");
};
