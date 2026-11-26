/**
 * A pressed button's change in a connected app that the person's approval rules ask about (D-136): kept here, for that
 * person alone, until they confirm it (and it is made) or it goes stale. Only adds (expand): a table the release before
 * never reads.
 * - app_connected_confirms: the change (the bots' action id and its arguments, made by the server), the question the
 *   person is asked, and when it was used, so it is made at most once.
 * - ix_app_connected_confirms_created: the stale ones, cleared with scripts' old runs, found without reading the rest.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw(`create table app_connected_confirms (
    id bigserial primary key,
    workspace_id bigint not null references workspaces (id) on delete cascade,
    app_id varchar(24) not null references apps (id) on delete cascade,
    script_key varchar(64) not null,
    user_id bigint not null references users (id) on delete cascade,
    plugin_id varchar(64) not null,
    action_id varchar(64) not null,
    args jsonb not null,
    question text not null,
    created_at timestamptz not null default current_timestamp,
    used_at timestamptz
  )`);
  await knex.raw("create index ix_app_connected_confirms_created on app_connected_confirms (created_at)");
};

exports.down = async function down(knex) {
  await knex.raw("drop table if exists app_connected_confirms");
};
