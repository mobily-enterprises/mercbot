/**
 * Scripts belong to an app's draft (D-139): a script saved is the app's draft's (`draft`), tried in its preview and made
 * live when the draft is published; a draft can also take a live script away (`removed`). An app has one live and one
 * draft row of a key at most. A published version keeps its scripts as they went live (`app_versions.scripts`), which
 * restoring it brings back. Every script there is now is live. The release before writes only live rows (draft false)
 * and reads them by app and key, as one of the two rows the new key allows.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw("alter table app_scripts add column draft boolean not null default false");
  await knex.raw("alter table app_scripts add column removed boolean not null default false");
  await knex.raw("alter table app_scripts drop constraint ux_app_scripts_key");
  await knex.raw("alter table app_scripts add constraint ux_app_scripts_key_draft unique (app_id, key, draft)");
  await knex.raw("alter table app_versions add column scripts jsonb");
};

exports.down = async function down(knex) {
  await knex.raw("alter table app_versions drop column if exists scripts");
  await knex.raw("delete from app_scripts where draft");
  await knex.raw("alter table app_scripts drop constraint if exists ux_app_scripts_key_draft");
  await knex.raw("alter table app_scripts add constraint ux_app_scripts_key unique (app_id, key)");
  await knex.raw("alter table app_scripts drop column if exists removed");
  await knex.raw("alter table app_scripts drop column if exists draft");
};
