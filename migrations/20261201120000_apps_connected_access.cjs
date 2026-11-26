/**
 * Apps' scripts using connected apps (D-136). Only adds (expand): columns and a constraint the release before keeps,
 * since it never sets connected_access.
 * - apps.connected_access: the connected apps (plugin ids) an app's scripts may use, chosen by the home's owners and
 *   admins; empty until they do.
 * - ck_apps_connected_internal: an app that uses connected apps is internal only, never public, whichever is set first.
 * - app_scripts.runs_as_user_id: the person a job runs as when it uses connected apps, who saved it or switched it on;
 *   null when they left the home or were deleted, and then its connected calls are refused.
 * - ix_app_scripts_runs_as: the jobs of a person who leaves, found without reading every script.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw("alter table apps add column connected_access jsonb not null default '[]'::jsonb");
  await knex.raw(
    "alter table apps add constraint ck_apps_connected_internal check (public_at is null or connected_access = '[]'::jsonb)"
  );
  await knex.raw("alter table app_scripts add column runs_as_user_id bigint references users (id) on delete set null");
  await knex.raw("create index ix_app_scripts_runs_as on app_scripts (runs_as_user_id) where runs_as_user_id is not null");
};

exports.down = async function down(knex) {
  await knex.raw("drop index if exists ix_app_scripts_runs_as");
  await knex.raw("alter table app_scripts drop column if exists runs_as_user_id");
  await knex.raw("alter table apps drop constraint if exists ck_apps_connected_internal");
  await knex.raw("alter table apps drop column if exists connected_access");
};
