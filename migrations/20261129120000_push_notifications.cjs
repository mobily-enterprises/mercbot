/**
 * Notifications on people's devices (D-133). Only adds (expand): new tables the release before never reads.
 * - push_devices: each browser or installed app a person allowed notifications on, by its push service address
 *   (endpoint, unique: a device belongs to whoever subscribed it last), with the keys its notifications are sealed
 *   with, a label people recognise it by, and how many sends failed in a row.
 * - push_settings: one row per person who changed theirs: which kinds of news notify them, whether a notification
 *   shows the message's text, and quiet hours in their time zone. No row means everything on, text shown, no quiet.
 * - push_queue: a notification waiting to be sent, one for each message a person is to hear of, written as the message
 *   is (one insert, nothing read); once a person's oldest for a chat is due (send_after), the sweep takes all of theirs
 *   for that chat and sends one, about the newest, if it's still unread then. Claimed by one server at a time.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw(`
    create table push_devices (
      id bigserial primary key,
      user_id bigint not null references users (id) on delete cascade,
      endpoint varchar(2000) not null,
      p256dh varchar(200) not null,
      auth varchar(100) not null,
      label varchar(120) not null default '',
      created_at timestamptz not null default now(),
      last_sent_at timestamptz,
      failures integer not null default 0 constraint ck_push_devices_failures check (failures >= 0),
      constraint ux_push_devices_endpoint unique (endpoint)
    )`);
  await knex.raw("create index ix_push_devices_user on push_devices (user_id)");
  await knex.raw(`
    create table push_settings (
      id bigserial primary key,
      user_id bigint not null references users (id) on delete cascade constraint ux_push_settings_user unique,
      results boolean not null default true,
      waiting boolean not null default true,
      messages boolean not null default true,
      show_text boolean not null default true,
      quiet_from varchar(5) constraint ck_push_settings_quiet_from check (quiet_from ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
      quiet_to varchar(5) constraint ck_push_settings_quiet_to check (quiet_to ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
      time_zone varchar(64),
      updated_at timestamptz not null default now()
    )`);
  await knex.raw(`
    create table push_queue (
      workspace_id bigint not null references workspaces (id) on delete cascade,
      id bigserial,
      user_id bigint not null references users (id) on delete cascade,
      chat_id bigint not null references conversations (id) on delete cascade,
      kind varchar(12) not null constraint ck_push_queue_kind check (kind in ('results', 'waiting', 'messages')),
      message_id bigint not null,
      send_after timestamptz not null,
      claimed_at timestamptz,
      primary key (workspace_id, id)
    )`);
  await knex.raw("create index ix_push_queue_person_chat on push_queue (user_id, chat_id)");
  await knex.raw("create index ix_push_queue_id on push_queue (id)");
  await knex.raw("create index ix_push_queue_due on push_queue (send_after)");
};

exports.down = async function down(knex) {
  await knex.raw("drop table if exists push_queue");
  await knex.raw("drop table if exists push_settings");
  await knex.raw("drop table if exists push_devices");
};
