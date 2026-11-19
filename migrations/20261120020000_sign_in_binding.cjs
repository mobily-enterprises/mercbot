/**
 * A sign-in belongs to the browser that started it (D-97, packages/integrations/src/server/signInBinding.js): `binding`
 * is the hash of the cookie that browser was given, and the provider's callback finishes the sign-in only in a browser
 * that brings that cookie back. A sign-in this server lends a linked copy (`bridge_connection_id`) gets its cookie when
 * `lent_to`, the account that copy is linked to, begins it here signed in. A sign-in started before this has neither and
 * can't be finished: it is started again.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw("ALTER TABLE oauth_states ADD COLUMN binding character varying(64), ADD COLUMN lent_to bigint");
};

exports.down = async function down(knex) {
  await knex.raw("ALTER TABLE oauth_states DROP COLUMN IF EXISTS binding, DROP COLUMN IF EXISTS lent_to");
};
