/**
 * Every app has a bot to talk to (D-147). Only adds (expand): columns and an index the release before never reads.
 * - `conversations.bot_app_id`: a person's own chat with an app's bot, opened from inside the app. Private, one per
 *   person and app (its maker, `made_by`), so `app_id`, the app's one public chat with its Builder (D-41), stays as it is.
 * - `app_versions.guide`: the app guide Mercbot writes for each version as it's saved or published, the same way for
 *   every app (appGuide.js), which the app's bot reads in the cached start of its prompt; null for versions made before,
 *   written once the first time their bot needs it.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw("alter table conversations add column bot_app_id character varying(24)");
  await knex.raw(
    "alter table conversations add constraint conversations_bot_app_check check (bot_app_id is null or (kind = 'private' and app_id is null))"
  );
  await knex.raw(
    "create unique index ux_conversations_bot_app on conversations (workspace_id, bot_app_id, made_by) where bot_app_id is not null"
  );
  await knex.raw("alter table app_versions add column guide text");
};

exports.down = async function down(knex) {
  await knex.raw("alter table app_versions drop column if exists guide");
  await knex.raw("drop index if exists ux_conversations_bot_app");
  await knex.raw("alter table conversations drop constraint if exists conversations_bot_app_check");
  await knex.raw("alter table conversations drop column if exists bot_app_id");
};
