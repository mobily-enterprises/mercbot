/**
 * Rooms memory and the bots' common knowledge (D-119): the tables 20261122140000_bot_memory.cjs made take the names
 * the app now uses, with their constraints, indexes and id sequences.
 * - `home_notes` becomes `common_knowledge`: the home's common knowledge, which every bot reads.
 * - `bot_memories` becomes `rooms_memories` and `bot_memory_queue` becomes `rooms_memory_queue`: each bot's rooms
 *   memory (its digest of the home's public rooms) and its refreshes waiting.
 * A primary key's or a unique constraint's index is renamed with its constraint. No SQL function or view names these
 * tables. Only names change: no row, column or rule is dropped or converted.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw(`
    ALTER TABLE home_notes RENAME TO common_knowledge;
    ALTER SEQUENCE home_notes_id_seq RENAME TO common_knowledge_id_seq;
    ALTER TABLE common_knowledge RENAME CONSTRAINT home_notes_pkey TO common_knowledge_pkey;
    ALTER TABLE common_knowledge RENAME CONSTRAINT home_notes_workspace_id_fkey TO common_knowledge_workspace_id_fkey;
    ALTER TABLE common_knowledge RENAME CONSTRAINT home_notes_by_user_id_fkey TO common_knowledge_by_user_id_fkey;
    ALTER TABLE common_knowledge RENAME CONSTRAINT home_notes_via_bot_id_fkey TO common_knowledge_via_bot_id_fkey;
    ALTER TABLE common_knowledge RENAME CONSTRAINT home_notes_from_conversation_id_fkey TO common_knowledge_from_conversation_id_fkey;
    ALTER TABLE common_knowledge RENAME CONSTRAINT home_notes_card_id_fkey TO common_knowledge_card_id_fkey;
    ALTER TABLE common_knowledge RENAME CONSTRAINT home_notes_removed_by_fkey TO common_knowledge_removed_by_fkey;
    ALTER TABLE common_knowledge RENAME CONSTRAINT home_notes_card_unique TO common_knowledge_card_unique;
    ALTER TABLE common_knowledge RENAME CONSTRAINT home_notes_text_check TO common_knowledge_text_check;
    ALTER INDEX ix_home_notes_live RENAME TO ix_common_knowledge_live;

    ALTER TABLE bot_memories RENAME TO rooms_memories;
    ALTER SEQUENCE bot_memories_id_seq RENAME TO rooms_memories_id_seq;
    ALTER TABLE rooms_memories RENAME CONSTRAINT bot_memories_pkey TO rooms_memories_pkey;
    ALTER TABLE rooms_memories RENAME CONSTRAINT bot_memories_workspace_id_fkey TO rooms_memories_workspace_id_fkey;
    ALTER TABLE rooms_memories RENAME CONSTRAINT bot_memories_home_unique TO rooms_memories_home_unique;
    ALTER TABLE rooms_memories RENAME CONSTRAINT bot_memories_bot_foreign TO rooms_memories_bot_foreign;

    ALTER TABLE bot_memory_queue RENAME TO rooms_memory_queue;
    ALTER SEQUENCE bot_memory_queue_id_seq RENAME TO rooms_memory_queue_id_seq;
    ALTER TABLE rooms_memory_queue RENAME CONSTRAINT bot_memory_queue_pkey TO rooms_memory_queue_pkey;
    ALTER TABLE rooms_memory_queue RENAME CONSTRAINT bot_memory_queue_workspace_id_fkey TO rooms_memory_queue_workspace_id_fkey;
    ALTER TABLE rooms_memory_queue RENAME CONSTRAINT bot_memory_queue_home_unique TO rooms_memory_queue_home_unique;
    ALTER TABLE rooms_memory_queue RENAME CONSTRAINT bot_memory_queue_bot_foreign TO rooms_memory_queue_bot_foreign;
    ALTER INDEX ix_bot_memory_queue_due RENAME TO ix_rooms_memory_queue_due;
  `);
};

exports.contracts =
  "Renames home_notes, bot_memories and bot_memory_queue to common_knowledge, rooms_memories and rooms_memory_queue " +
  "(D-119), with their constraints, indexes and sequences: the release before reads the old names, so until its " +
  "servers are replaced its turns can't read the home's common knowledge or a bot's rooms memory. Nothing is dropped " +
  "or converted, and the down renames everything back.";

exports.down = async function down(knex) {
  await knex.raw(`
    ALTER INDEX ix_rooms_memory_queue_due RENAME TO ix_bot_memory_queue_due;
    ALTER TABLE rooms_memory_queue RENAME CONSTRAINT rooms_memory_queue_bot_foreign TO bot_memory_queue_bot_foreign;
    ALTER TABLE rooms_memory_queue RENAME CONSTRAINT rooms_memory_queue_home_unique TO bot_memory_queue_home_unique;
    ALTER TABLE rooms_memory_queue RENAME CONSTRAINT rooms_memory_queue_workspace_id_fkey TO bot_memory_queue_workspace_id_fkey;
    ALTER TABLE rooms_memory_queue RENAME CONSTRAINT rooms_memory_queue_pkey TO bot_memory_queue_pkey;
    ALTER SEQUENCE rooms_memory_queue_id_seq RENAME TO bot_memory_queue_id_seq;
    ALTER TABLE rooms_memory_queue RENAME TO bot_memory_queue;

    ALTER TABLE rooms_memories RENAME CONSTRAINT rooms_memories_bot_foreign TO bot_memories_bot_foreign;
    ALTER TABLE rooms_memories RENAME CONSTRAINT rooms_memories_home_unique TO bot_memories_home_unique;
    ALTER TABLE rooms_memories RENAME CONSTRAINT rooms_memories_workspace_id_fkey TO bot_memories_workspace_id_fkey;
    ALTER TABLE rooms_memories RENAME CONSTRAINT rooms_memories_pkey TO bot_memories_pkey;
    ALTER SEQUENCE rooms_memories_id_seq RENAME TO bot_memories_id_seq;
    ALTER TABLE rooms_memories RENAME TO bot_memories;

    ALTER INDEX ix_common_knowledge_live RENAME TO ix_home_notes_live;
    ALTER TABLE common_knowledge RENAME CONSTRAINT common_knowledge_text_check TO home_notes_text_check;
    ALTER TABLE common_knowledge RENAME CONSTRAINT common_knowledge_card_unique TO home_notes_card_unique;
    ALTER TABLE common_knowledge RENAME CONSTRAINT common_knowledge_removed_by_fkey TO home_notes_removed_by_fkey;
    ALTER TABLE common_knowledge RENAME CONSTRAINT common_knowledge_card_id_fkey TO home_notes_card_id_fkey;
    ALTER TABLE common_knowledge RENAME CONSTRAINT common_knowledge_from_conversation_id_fkey TO home_notes_from_conversation_id_fkey;
    ALTER TABLE common_knowledge RENAME CONSTRAINT common_knowledge_via_bot_id_fkey TO home_notes_via_bot_id_fkey;
    ALTER TABLE common_knowledge RENAME CONSTRAINT common_knowledge_by_user_id_fkey TO home_notes_by_user_id_fkey;
    ALTER TABLE common_knowledge RENAME CONSTRAINT common_knowledge_workspace_id_fkey TO home_notes_workspace_id_fkey;
    ALTER TABLE common_knowledge RENAME CONSTRAINT common_knowledge_pkey TO home_notes_pkey;
    ALTER SEQUENCE common_knowledge_id_seq RENAME TO home_notes_id_seq;
    ALTER TABLE common_knowledge RENAME TO home_notes;
  `);
};
