/**
 * Sending without a button press (D-137): an app's jobs and public forms may notify the home's members in their chat with
 * the main bot, and send email from one of the home's connected mailboxes, each switched on for the app by an owner or
 * admin, with a daily limit. Only adds (expand): a column and a table the release before never reads.
 * - apps.sending: { notify, email, account, daily }, as owners and admins set it; null is nothing switched on.
 * - app_send_counts: what an app sent on a day (UTC), by what: "notice", "email", or "to:<address>" for a public form's
 *   emails to one address; one row each, counted under its row lock so servers count the same.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw("alter table apps add column sending jsonb");
  await knex.raw(`create table app_send_counts (
    id bigserial primary key,
    workspace_id bigint not null references workspaces (id) on delete cascade,
    app_id varchar(24) not null references apps (id) on delete cascade,
    day date not null,
    what varchar(300) not null,
    count integer not null default 0,
    constraint ux_app_send_counts unique (app_id, day, what)
  )`);
};

exports.down = async function down(knex) {
  await knex.raw("drop table if exists app_send_counts");
  await knex.raw("alter table apps drop column if exists sending");
};
