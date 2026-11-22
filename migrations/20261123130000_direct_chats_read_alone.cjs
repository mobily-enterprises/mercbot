/**
 * A direct chat (a person's with a bot, or two people's) reads nothing private but itself: from one, the reading rule
 * `readable_from(chat)` reaches the chat itself and the home's public rooms only, never another private chat, even one
 * whose people include its own. Its people chose a chat of their own, so nothing in their other private chats reaches
 * it, as nothing in it reaches them (20261123120000_rooms_people_bots.cjs). Everything else in the rule is as that
 * migration left it. Only narrows what a bot reads: nothing is dropped or converted.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw(READING_RULE);
};

// The reading rule (D-112): the chat itself; every public chat of its home that isn't a direct chat; and, for a private
// chat that isn't a direct one, with at least one person, every private chat of its home that isn't a direct chat and
// whose people include all of its people.
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
              AND y.direct_bot_id IS NULL AND y.direct_person_id IS NULL
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

// The rule as 20261123120000_rooms_people_bots.cjs left it.
const BEFORE = String.raw`
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

exports.down = async function down(knex) {
  await knex.raw(BEFORE);
};
