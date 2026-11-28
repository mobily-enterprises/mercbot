/**
 * Apps follow their template unless forked (D-141): `forked_at`, when a change to an app's screens or scripts that
 * didn't come from its template was first saved; while it's null, the app takes each new version of its template.
 * Only adds (expand): a column the release before never reads. An app made from a template before this follows it
 * when it was never changed: one with a version its template didn't make (a draft a person or the Builder saved, a
 * script's change, a restore, a removal) is a fork.
 * @param {import('knex').Knex} knex
 */
async function forkChanged(knex) {
  await knex.raw(`
    update apps set forked_at = now()
    where template_key is not null and forked_at is null and exists (
      select 1 from app_versions v
      where v.app_id = apps.id and v.summary not like 'From the % template' and v.summary not like 'Updated from the % template'
    )`);
}

exports.up = async function up(knex) {
  await knex.raw("alter table apps add column forked_at timestamptz");
  // A copy that started fresh (D-141): its number, which its own tables carry ("study_courses_copy_2"); null for the
  // first app of a template and a copy that shares the first one's things.
  await knex.raw("alter table apps add column template_copy integer");
  await forkChanged(knex);
};

exports.down = async function down(knex) {
  await knex.raw("alter table apps drop column if exists template_copy");
  await knex.raw("alter table apps drop column if exists forked_at");
};

exports.forkChanged = forkChanged;
