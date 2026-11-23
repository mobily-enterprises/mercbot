/**
 * What bots' commands may use of the internet beyond one command (D-127), kept here as a home's bots run on several
 * servers (D-15).
 *
 * - `internet_days`: what a home's bot commands received and sent through Mercbot's gateway each day (UTC), and how
 *   many connections they opened: one row a home and day, which each gateway adds to a batch at a time (every few
 *   seconds while data moves, and as it closes), never a row a connection. Its day's total is the home's daily budget.
 *   Days older than two weeks are removed.
 * - `internet_minutes`: each bot's new connections in its present minute (minutes since 1970, UTC): one row a bot,
 *   started again in each new minute, which gateways take connections from a few at a time.
 *
 * Only adds (expand): no release before reads either.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw(`
    CREATE TABLE internet_days (
      id bigserial PRIMARY KEY,
      workspace_id bigint NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
      day date NOT NULL,
      bytes_in bigint DEFAULT 0 NOT NULL,
      bytes_out bigint DEFAULT 0 NOT NULL,
      connections bigint DEFAULT 0 NOT NULL,
      CONSTRAINT internet_days_home_day_unique UNIQUE (workspace_id, day),
      CONSTRAINT internet_days_amounts_check CHECK (bytes_in >= 0 AND bytes_out >= 0 AND connections >= 0)
    );
    CREATE INDEX ix_internet_days_day ON internet_days (day);

    CREATE TABLE internet_minutes (
      id bigserial PRIMARY KEY,
      bot_id bigint NOT NULL,
      workspace_id bigint NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
      minute integer NOT NULL,
      connections integer DEFAULT 0 NOT NULL,
      CONSTRAINT internet_minutes_bot_unique UNIQUE (workspace_id, bot_id),
      CONSTRAINT internet_minutes_bot_foreign FOREIGN KEY (bot_id, workspace_id) REFERENCES bots (id, workspace_id) ON DELETE CASCADE,
      CONSTRAINT internet_minutes_connections_check CHECK (connections >= 0)
    );
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`
    DROP TABLE IF EXISTS internet_minutes;
    DROP TABLE IF EXISTS internet_days;
  `);
};
