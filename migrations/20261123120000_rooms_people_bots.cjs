/**
 * Rooms, People and Bots. A chat between two people (`direct_person_id`): Private, untitled, one per pair in a home, the
 * pair kept in one order (`direct_user_id < direct_person_id`), so two first uses at once make one: an insert that
 * skips on `ux_conversations_person_direct`, whole rather than partial so an insert can name it (a chat with no
 * `direct_person_id` never clashes on it, as nulls are distinct). A person's chat with a bot is
 * Private too, and a direct chat (with a bot or a person) is readable only from itself: the reading rule
 * `readable_from(chat)` never reaches one from another chat, even when its people would match the private rule, so no
 * bot elsewhere, and no bot's memory, ever reads it. Everything else in the rule is as the chats-core migration made it.
 *
 * A bot's seat keeps where it reads its chat from (`chat_bots.reads_from_message_id`): a bot invited into a room with a
 * long history reads only its last messages and what is said after it joined; null reads the chat from its beginning,
 * as every seat made before this does.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.transaction(async (trx) => {
    await trx.raw(PERSON_CHATS);
    await trx.raw(BOT_CHATS_PRIVATE);
    await trx.raw(READING_RULE);
    await trx.raw("ALTER TABLE chat_bots ADD COLUMN reads_from_message_id bigint");
  });
};

const PERSON_CHATS = String.raw`
ALTER TABLE conversations ADD COLUMN direct_person_id bigint REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE conversations DROP CONSTRAINT conversations_direct_check;
ALTER TABLE conversations
  ADD CONSTRAINT conversations_direct_check CHECK (((direct_bot_id IS NOT NULL OR direct_person_id IS NOT NULL) = (direct_user_id IS NOT NULL))),
  ADD CONSTRAINT conversations_direct_one_check CHECK ((direct_bot_id IS NULL OR direct_person_id IS NULL)),
  ADD CONSTRAINT conversations_person_direct_check CHECK ((direct_person_id IS NULL OR (kind = 'private' AND title IS NULL AND direct_user_id < direct_person_id)));
CREATE UNIQUE INDEX ux_conversations_person_direct ON conversations (direct_user_id, direct_person_id, workspace_id);
CREATE INDEX ix_conversations_direct_person ON conversations (direct_person_id) WHERE direct_person_id IS NOT NULL;
`;

// Only development databases hold chats with a bot made Public: they become Private before the check that keeps them so.
const BOT_CHATS_PRIVATE = String.raw`
UPDATE conversations SET kind = 'private' WHERE direct_bot_id IS NOT NULL AND kind <> 'private';
ALTER TABLE conversations
  ADD CONSTRAINT conversations_direct_private_check CHECK (((direct_bot_id IS NULL AND direct_person_id IS NULL) OR kind = 'private'));
`;

// The reading rule (D-112), with direct chats readable only from themselves: the chat itself; every public chat of its
// home that isn't a direct chat; and, for a private chat with at least one person, every private chat of its home that
// isn't a direct chat and whose people include all of its people.
const READING_RULE = String.raw`
CREATE OR REPLACE FUNCTION readable_from(chat bigint) RETURNS SETOF bigint
  LANGUAGE sql STABLE
  AS $$
    SELECT x.id
    FROM conversations y
    JOIN conversations x ON x.workspace_id = y.workspace_id
    WHERE y.id = chat
      AND (
        x.id = y.id
        OR (
          x.direct_bot_id IS NULL AND x.direct_person_id IS NULL
          AND (
            x.kind = 'public'
            OR (
              y.kind = 'private' AND x.kind = 'private'
              AND EXISTS (SELECT 1 FROM chat_people p WHERE p.conversation_id = y.id)
              AND NOT EXISTS (
                SELECT 1 FROM chat_people p
                WHERE p.conversation_id = y.id
                  AND NOT EXISTS (SELECT 1 FROM chat_people q WHERE q.conversation_id = x.id AND q.user_id = p.user_id)
              )
            )
          )
        )
      )
  $$;
`;

exports.contracts =
  "Chats with a bot become Private and the direct-chat check is replaced: the release before makes a chat with a bot " +
  "Public, which the new check refuses, so until its servers are replaced they can't make a person's first chat with a " +
  "bot. No chat is converted beyond development databases (there is no real data to keep), and nothing is dropped.";

exports.down = async function down(knex) {
  await knex.transaction(async (trx) => {
    await trx.raw("ALTER TABLE chat_bots DROP COLUMN IF EXISTS reads_from_message_id");
    await trx.raw(String.raw`
CREATE OR REPLACE FUNCTION readable_from(chat bigint) RETURNS SETOF bigint
  LANGUAGE sql STABLE
  AS $$
    SELECT x.id
    FROM conversations y
    JOIN conversations x ON x.workspace_id = y.workspace_id
    WHERE y.id = chat
      AND (
        x.id = y.id
        OR x.kind = 'public'
        OR (
          y.kind = 'private' AND x.kind = 'private'
          AND EXISTS (SELECT 1 FROM chat_people p WHERE p.conversation_id = y.id)
          AND NOT EXISTS (
            SELECT 1 FROM chat_people p
            WHERE p.conversation_id = y.id
              AND NOT EXISTS (SELECT 1 FROM chat_people q WHERE q.conversation_id = x.id AND q.user_id = p.user_id)
          )
        )
      )
  $$;
`);
    await trx.raw("ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_direct_private_check");
    await trx.raw("DELETE FROM conversations WHERE direct_person_id IS NOT NULL");
    await trx.raw("ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_person_direct_check");
    await trx.raw("ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_direct_one_check");
    await trx.raw("ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_direct_check");
    await trx.raw("ALTER TABLE conversations DROP COLUMN IF EXISTS direct_person_id");
    await trx.raw("ALTER TABLE conversations ADD CONSTRAINT conversations_direct_check CHECK (((direct_user_id IS NULL) = (direct_bot_id IS NULL)))");
  });
};
