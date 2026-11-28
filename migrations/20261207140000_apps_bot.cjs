/**
 * The bot a ready-made app comes with (D-144): the home's bot its scripts' AI work goes to, which installing the
 * template made or found. Only adds (expand): a column the release before never reads; null is no bot of its own, so
 * its work goes to the home's main bot, as every app's did. A bot deleted leaves its apps without one.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw("alter table apps add column bot_id bigint references bots(id) on delete set null");
};

exports.down = async function down(knex) {
  await knex.raw("alter table apps drop column if exists bot_id");
};
