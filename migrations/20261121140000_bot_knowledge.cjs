/**
 * What a bot knows (D-107): the text and files its maker and the home's owners and admins give it, and the parts each
 * is split into, which a turn searches. `bot_knowledge` keeps each piece whole (`text`: what was pasted, or the text
 * read from the file at `file_path` in the bot's folder), its size and how far the server reading and splitting it has
 * got (`state`: reading, indexing, ready or failed, with `problem` saying what to do; `parts_done` of `parts_total`),
 * leased to one server's run at a time (`lease_by`, until `lease_until`, D-15). `bot_knowledge_parts` keeps the parts
 * in order, each with the heading and pages it falls under, and a full-text search vector PostgreSQL makes from them,
 * which its GIN index searches without reading the others. Only adds (expand): the release before reads none of it.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw(`
    CREATE TABLE bot_knowledge (
      id bigserial PRIMARY KEY,
      workspace_id bigint NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
      bot_id bigint NOT NULL REFERENCES bots (id) ON DELETE CASCADE,
      title varchar(200) NOT NULL,
      kind varchar(8) NOT NULL CHECK (kind IN ('text', 'file')),
      text text NOT NULL DEFAULT '',
      file_path varchar(1000),
      chars integer NOT NULL DEFAULT 0,
      state varchar(10) NOT NULL CHECK (state IN ('reading', 'indexing', 'ready', 'failed')),
      problem varchar(500),
      parts_total integer NOT NULL DEFAULT 0,
      parts_done integer NOT NULL DEFAULT 0,
      lease_until timestamp with time zone,
      lease_by varchar(40),
      created_by bigint REFERENCES users (id) ON DELETE SET NULL,
      created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await knex.raw("CREATE INDEX ix_bot_knowledge_bot ON bot_knowledge (bot_id, id)");
  await knex.raw("CREATE INDEX ix_bot_knowledge_waiting ON bot_knowledge (lease_until) WHERE state IN ('reading', 'indexing')");
  await knex.raw(`
    CREATE TABLE bot_knowledge_parts (
      id bigserial PRIMARY KEY,
      workspace_id bigint NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
      bot_id bigint NOT NULL REFERENCES bots (id) ON DELETE CASCADE,
      knowledge_id bigint NOT NULL REFERENCES bot_knowledge (id) ON DELETE CASCADE,
      position integer NOT NULL,
      heading varchar(300) NOT NULL DEFAULT '',
      pages varchar(40) NOT NULL DEFAULT '',
      text text NOT NULL,
      search tsvector GENERATED ALWAYS AS (to_tsvector('english', heading || ' ' || text)) STORED,
      UNIQUE (knowledge_id, position)
    )
  `);
  await knex.raw("CREATE INDEX ix_bot_knowledge_parts_bot ON bot_knowledge_parts (bot_id)");
  await knex.raw("CREATE INDEX ix_bot_knowledge_parts_search ON bot_knowledge_parts USING gin (search)");
};

exports.down = async function down(knex) {
  await knex.raw("DROP TABLE IF EXISTS bot_knowledge_parts");
  await knex.raw("DROP TABLE IF EXISTS bot_knowledge");
};
