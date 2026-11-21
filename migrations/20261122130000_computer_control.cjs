/**
 * Who has control of a chat's computer, and what's signed in on it (D14, D16). A person who can open the chat takes
 * over a bot's computer there (`controlled_by`, since `controlled_at`) and the bot doesn't act on it until someone
 * hands it back; their account going hands it back. `sign_ins` lists what's signed in on the computer's browser, as
 * the computer panel shows it: [{ label, kind, since }], kept with the saved browser, so a reset forgets it with the
 * browser. Only adds (expand): the release before reads none of it, and existing rows need no value.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw(`
    ALTER TABLE bot_computers
      ADD COLUMN controlled_by bigint REFERENCES users (id) ON DELETE SET NULL,
      ADD COLUMN controlled_at timestamp with time zone;
    ALTER TABLE bot_browser_state
      ADD COLUMN sign_ins jsonb NOT NULL DEFAULT '[]'::jsonb;
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`
    ALTER TABLE bot_browser_state DROP COLUMN IF EXISTS sign_ins;
    ALTER TABLE bot_computers DROP COLUMN IF EXISTS controlled_at, DROP COLUMN IF EXISTS controlled_by;
  `);
};
