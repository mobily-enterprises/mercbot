/**
 * Bots remember their public chats; private chats are one-way glass (D-113, B2 of the rebuild).
 *
 * - `home_notes`: what a person asked a bot to tell everyone in the home, written only when they said yes on its card
 *   (`card_id`, one note per card), read live into every turn's state note, and shown on Team; removing one keeps the
 *   row with who removed it and when, so it's gone from the next turn on.
 * - `bot_memories`: one digest per bot of the home's public chats it is in, read in every chat of the bot. `covers`
 *   is where it read each chat up to ({ chatId: lastMessageId }), `up_to` the home's newest message when it was read.
 *   `version` goes up with each write, and `follows` is the version it replaced: a refresh writes only while the
 *   stored digest is still the one it read, so a slower server never overwrites a newer digest, nor one emptied by a
 *   forgetting meanwhile.
 * - `bot_memory_queue`: the refreshes waiting, one per bot, claimed by any server (SKIP LOCKED) under a lease its
 *   server renews while it writes (`claimed_by` is that run); `asks` counts the requests, so finishing an older one
 *   never drops a newer one; `attempts` and `last_error` back a failing one off (1, 2, 4... up to 60 minutes);
 *   `rebuild` asks for a digest made from the chats themselves after a deletion or a removal (O23).
 * - The recall index: full-text search over what was said in words, for the recall tool.
 *
 * Each of the two per-bot tables has one row a bot, unique on (bot_id, workspace_id): the key a write that may find the
 * row there already names, as every write in a home names its home. Only adds (expand): no release before reads any of
 * it.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw(`
    CREATE TABLE home_notes (
      id bigserial PRIMARY KEY,
      workspace_id bigint NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
      text character varying(500) NOT NULL,
      by_user_id bigint REFERENCES users (id) ON DELETE SET NULL,
      via_bot_id bigint REFERENCES bots (id) ON DELETE SET NULL,
      from_conversation_id bigint REFERENCES conversations (id) ON DELETE SET NULL,
      card_id bigint REFERENCES messages (id) ON DELETE SET NULL,
      created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
      removed_at timestamp with time zone,
      removed_by bigint REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT home_notes_card_unique UNIQUE (card_id),
      CONSTRAINT home_notes_text_check CHECK (length(btrim(text)) > 0)
    );
    CREATE INDEX ix_home_notes_live ON home_notes (workspace_id, id DESC) WHERE removed_at IS NULL;

    CREATE TABLE bot_memories (
      id bigserial PRIMARY KEY,
      bot_id bigint NOT NULL,
      workspace_id bigint NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
      text text DEFAULT '' NOT NULL,
      covers jsonb DEFAULT '{}'::jsonb NOT NULL,
      up_to bigint,
      version bigint DEFAULT 0 NOT NULL,
      follows bigint,
      tokens integer DEFAULT 0 NOT NULL,
      made_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
      CONSTRAINT bot_memories_home_unique UNIQUE (bot_id, workspace_id),
      CONSTRAINT bot_memories_bot_foreign FOREIGN KEY (bot_id, workspace_id) REFERENCES bots (id, workspace_id) ON DELETE CASCADE
    );

    CREATE TABLE bot_memory_queue (
      id bigserial PRIMARY KEY,
      bot_id bigint NOT NULL,
      workspace_id bigint NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
      due_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
      asks integer DEFAULT 0 NOT NULL,
      claimed_until timestamp with time zone,
      claimed_by character varying(40),
      attempts integer DEFAULT 0 NOT NULL,
      last_error text,
      rebuild boolean DEFAULT false NOT NULL,
      CONSTRAINT bot_memory_queue_home_unique UNIQUE (bot_id, workspace_id),
      CONSTRAINT bot_memory_queue_bot_foreign FOREIGN KEY (bot_id, workspace_id) REFERENCES bots (id, workspace_id) ON DELETE CASCADE
    );
    CREATE INDEX ix_bot_memory_queue_due ON bot_memory_queue (due_at);

    CREATE INDEX ix_messages_recall ON messages USING gin (to_tsvector('english'::regconfig, (body ->> 'text'))) WHERE ((kind)::text = 'text'::text);
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`
    DROP INDEX IF EXISTS ix_messages_recall;
    DROP TABLE IF EXISTS bot_memory_queue;
    DROP TABLE IF EXISTS bot_memories;
    DROP TABLE IF EXISTS home_notes;
  `);
};
