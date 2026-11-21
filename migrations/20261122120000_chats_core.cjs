/**
 * Chats are the core of Mercbot (D-112, version 0): a chat is a row of `conversations`, Public or Private, and its
 * members are people (`chat_people`, each with their own place in it: read point, unread, pin, section, hidden, muted)
 * and bots (`chat_bots`, "this bot in this chat", which everything a bot runs in a chat hangs off: its reply runs, goal
 * and to-do list, job notes, computer, browser state, commands, routines, watches, app jobs and follow-ups). Everything
 * said in a chat is a row of `messages`, written by a person (`author_user_id`), a bot (`author_bot_id`) or Mercbot
 * itself (neither); `role` stays as the kind of author, since many readers ask it and an author's account can go.
 * `conversation_sections` are a person's sidebar sections.
 *
 * D-112's one reading rule is one SQL function, `readable_from(chat)`: the conversations whose content a bot in that
 * chat may use, because everyone who can open the chat can open them too. A public chat is opened by everyone in the
 * home, now and later, so it reads only public chats; a private chat is opened by its people, so it also reads every
 * private chat whose people include all of its own. The row policies' model's reader (records/rowPolicies.js) uses it.
 *
 * Bots lose their modes and groups (`kind`, `sharing`) and D-98's unread leftovers (`label`, `instructions`, `skills`,
 * `origin`, `bots_before_templates`); `user_id` becomes `made_by`, kept null once that account goes, so a person's
 * account going no longer deletes the bots they made. The vault and the app actions turned off are the home's. A
 * person's personal skills, approval rules and auto-review are theirs in each home. The agent engine's runs, goals and commands are keyed by the bot in the chat,
 * and its summaries by the chat (one summary of a shared chat).
 *
 * Gone outright (no compatibility at version 0): bot_conversations, bot_messages, bot_group_members, bot_group_people,
 * conversation_reads, bot_sections, bot_notebook, person_memories and home_settings, with their indexes, trigger and
 * row policies. There is no data to keep: every bot and every chat-bearing row goes first, so nothing points at a
 * vanished chat or computer. Homes and people stay. The files bucket is emptied with the database at release, except
 * `.mercbot-files`.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.transaction(async (trx) => {
    await trx.raw(NO_DATA);
    await trx.raw(DROPPED);
    await trx.raw(BOTS);
    await trx.raw(CHATS);
    await trx.raw(READING_RULE);
    await trx.raw(REKEYED);
  });
};

// Every bot goes, and with it (ON DELETE CASCADE) its conversations, messages, groups, knowledge and pages; every table
// re-keyed below is emptied by name, so none is left holding a row its new key can't name. App jobs that no bot ran
// (an app's own) stay.
const NO_DATA = String.raw`
DELETE FROM bots;
DELETE FROM agent_runs;
DELETE FROM agent_goals;
DELETE FROM agent_commands;
DELETE FROM agent_summaries;
DELETE FROM agent_summary_queue;
DELETE FROM bot_routines;
DELETE FROM bot_requests;
DELETE FROM bot_computers;
DELETE FROM bot_browser_state;
DELETE FROM computer_tickets;
DELETE FROM shell_runs;
DELETE FROM app_watches;
DELETE FROM connect_follow_ups;
DELETE FROM media_checks;
DELETE FROM vault_items;
DELETE FROM user_skills;
DELETE FROM plugin_actions_off;
DELETE FROM bot_policies;
DELETE FROM approval_rules;
`;

const DROPPED = String.raw`
DROP TABLE bot_group_members, bot_group_people, conversation_reads, bot_notebook, person_memories, home_settings,
  bots_before_templates, bot_messages, bot_conversations, bot_sections CASCADE;
DROP FUNCTION bot_messages_changed();
`;

const BOTS = String.raw`
ALTER TABLE bots
  DROP CONSTRAINT bots_sharing_check,
  DROP COLUMN kind,
  DROP COLUMN sharing,
  DROP COLUMN label,
  DROP COLUMN instructions,
  DROP COLUMN skills,
  DROP COLUMN origin,
  DROP COLUMN user_id,
  ADD COLUMN made_by bigint REFERENCES users (id) ON DELETE SET NULL,
  ADD CONSTRAINT bots_id_workspace_unique UNIQUE (id, workspace_id);
CREATE INDEX ix_bots_made_by ON bots (made_by, created_at DESC) WHERE made_by IS NOT NULL;
`;

const CHATS = String.raw`
CREATE TABLE conversation_sections (
  id bigserial PRIMARY KEY,
  workspace_id bigint NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name character varying(80) NOT NULL,
  "position" integer NOT NULL,
  collapsed boolean DEFAULT false NOT NULL
);
CREATE INDEX ix_conversation_sections_person ON conversation_sections (workspace_id, user_id);

CREATE TABLE conversations (
  id bigserial PRIMARY KEY,
  workspace_id bigint NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  kind character varying(8) NOT NULL,
  everyone boolean DEFAULT false NOT NULL,
  direct_user_id bigint REFERENCES users (id) ON DELETE CASCADE,
  direct_bot_id bigint,
  title character varying(80),
  app_id character varying(24),
  made_by bigint REFERENCES users (id) ON DELETE SET NULL,
  onboarding_step character varying(32),
  archived_at timestamp with time zone,
  archived_by bigint REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  last_activity_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT conversations_id_workspace_unique UNIQUE (id, workspace_id),
  CONSTRAINT conversations_direct_bot_foreign FOREIGN KEY (direct_bot_id, workspace_id) REFERENCES bots (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT conversations_kind_check CHECK ((kind IN ('public', 'private'))),
  CONSTRAINT conversations_everyone_check CHECK ((NOT everyone OR kind = 'public')),
  CONSTRAINT conversations_direct_check CHECK (((direct_user_id IS NULL) = (direct_bot_id IS NULL))),
  CONSTRAINT conversations_direct_title_check CHECK ((direct_bot_id IS NULL OR title IS NULL)),
  CONSTRAINT conversations_app_check CHECK ((app_id IS NULL OR kind = 'public'))
);
CREATE INDEX ix_conversations_activity ON conversations (workspace_id, last_activity_at DESC);
CREATE UNIQUE INDEX ux_conversations_direct ON conversations (direct_user_id, direct_bot_id) WHERE direct_bot_id IS NOT NULL;
CREATE UNIQUE INDEX ux_conversations_app ON conversations (workspace_id, app_id) WHERE app_id IS NOT NULL;
CREATE UNIQUE INDEX ux_conversations_everyone ON conversations (workspace_id) WHERE everyone;
CREATE INDEX ix_conversations_direct_bot ON conversations (direct_bot_id) WHERE direct_bot_id IS NOT NULL;

CREATE TABLE chat_people (
  id bigserial PRIMARY KEY,
  conversation_id bigint NOT NULL,
  workspace_id bigint NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  added_by bigint REFERENCES users (id) ON DELETE SET NULL,
  joined_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  read_up_to bigint,
  unread boolean DEFAULT false NOT NULL,
  pin_position integer,
  section_id bigint REFERENCES conversation_sections (id) ON DELETE SET NULL,
  hidden boolean DEFAULT false NOT NULL,
  muted boolean DEFAULT false NOT NULL,
  CONSTRAINT chat_people_conversation_foreign FOREIGN KEY (conversation_id, workspace_id) REFERENCES conversations (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT chat_people_person_unique UNIQUE (conversation_id, workspace_id, user_id)
);
CREATE INDEX ix_chat_people_person ON chat_people (user_id, workspace_id);

CREATE TABLE chat_bots (
  id bigserial PRIMARY KEY,
  conversation_id bigint NOT NULL,
  workspace_id bigint NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  bot_id bigint NOT NULL,
  added_by bigint REFERENCES users (id) ON DELETE SET NULL,
  joined_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "position" integer NOT NULL,
  waiting_task character varying(200),
  job_notes jsonb DEFAULT '[]'::jsonb NOT NULL,
  CONSTRAINT chat_bots_conversation_foreign FOREIGN KEY (conversation_id, workspace_id) REFERENCES conversations (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT chat_bots_bot_foreign FOREIGN KEY (bot_id, workspace_id) REFERENCES bots (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT chat_bots_bot_unique UNIQUE (conversation_id, workspace_id, bot_id)
);
CREATE INDEX ix_chat_bots_bot ON chat_bots (bot_id);

CREATE TABLE messages (
  id bigserial PRIMARY KEY,
  conversation_id bigint NOT NULL,
  workspace_id bigint NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  author_user_id bigint REFERENCES users (id) ON DELETE SET NULL,
  author_bot_id bigint REFERENCES bots (id) ON DELETE SET NULL,
  role character varying(8) NOT NULL,
  kind character varying(16) NOT NULL,
  body jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  changed xid8 DEFAULT pg_current_xact_id() NOT NULL,
  CONSTRAINT messages_conversation_foreign FOREIGN KEY (conversation_id, workspace_id) REFERENCES conversations (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT messages_author_check CHECK ((
    (role = 'user' AND author_bot_id IS NULL) OR
    (role = 'bot' AND author_user_id IS NULL) OR
    (role = 'system' AND author_user_id IS NULL AND author_bot_id IS NULL)))
);
CREATE INDEX ix_messages_conversation ON messages (conversation_id, id);
CREATE INDEX ix_messages_changed ON messages (conversation_id, changed);
CREATE INDEX ix_messages_bot ON messages (author_bot_id, id) WHERE author_bot_id IS NOT NULL;
CREATE INDEX ix_messages_workspace ON messages (workspace_id);

CREATE FUNCTION messages_changed() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  begin
    new.changed := pg_current_xact_id();
    return new;
  end
  $$;
CREATE TRIGGER messages_changed BEFORE UPDATE ON messages FOR EACH ROW EXECUTE FUNCTION messages_changed();
`;

// The reading rule (D-112): the conversations a bot in the chat may use, since everyone who can open the chat can open
// each of them: the chat itself; every public chat of its home; and, for a private chat with at least one person, every
// private chat of its home whose people include all of its people. Nothing else, and nothing for a chat that isn't there.
const READING_RULE = String.raw`
CREATE FUNCTION readable_from(chat bigint) RETURNS SETOF bigint
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
`;

const REKEYED = String.raw`
ALTER TABLE agent_runs
  ADD COLUMN user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  ADD CONSTRAINT agent_runs_chat_bot_foreign FOREIGN KEY (conversation_id) REFERENCES chat_bots (id) ON DELETE CASCADE;
ALTER TABLE agent_goals ADD CONSTRAINT agent_goals_chat_bot_foreign FOREIGN KEY (conversation_id) REFERENCES chat_bots (id) ON DELETE CASCADE;
ALTER TABLE agent_commands ADD CONSTRAINT agent_commands_chat_bot_foreign FOREIGN KEY (conversation_id) REFERENCES chat_bots (id) ON DELETE CASCADE;
ALTER TABLE agent_summaries ADD CONSTRAINT agent_summaries_conversation_foreign FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE;
ALTER TABLE agent_summary_queue ADD CONSTRAINT agent_summary_queue_conversation_foreign FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE;

ALTER TABLE bot_routines
  DROP COLUMN bot_id,
  DROP COLUMN conversation_id,
  ADD COLUMN chat_bot_id bigint NOT NULL REFERENCES chat_bots (id) ON DELETE CASCADE,
  ADD COLUMN made_by bigint REFERENCES users (id) ON DELETE SET NULL;
CREATE INDEX ix_bot_routines_chat_bot ON bot_routines (chat_bot_id);

ALTER TABLE bot_requests
  DROP COLUMN from_bot_id,
  DROP COLUMN from_conversation_id,
  DROP COLUMN to_conversation_id,
  DROP COLUMN to_message_id,
  ADD COLUMN from_chat_bot_id bigint NOT NULL REFERENCES chat_bots (id) ON DELETE CASCADE,
  ADD COLUMN conversation_id bigint NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  ADD COLUMN steps jsonb;
ALTER TABLE bot_requests RENAME COLUMN from_message_id TO message_id;
CREATE INDEX ix_bot_requests_chat ON bot_requests (conversation_id, status);
CREATE UNIQUE INDEX ux_bot_requests_open ON bot_requests (from_chat_bot_id, to_bot_id, user_id)
  WHERE (status IN ('queued', 'working', 'question', 'waiting_approval'));

ALTER TABLE bot_computers DROP COLUMN conversation_id, ADD COLUMN chat_bot_id bigint PRIMARY KEY REFERENCES chat_bots (id) ON DELETE CASCADE;
ALTER TABLE bot_browser_state DROP COLUMN conversation_id, ADD COLUMN chat_bot_id bigint PRIMARY KEY REFERENCES chat_bots (id) ON DELETE CASCADE;
ALTER TABLE computer_tickets DROP COLUMN conversation_id, ADD COLUMN chat_bot_id bigint NOT NULL REFERENCES chat_bots (id) ON DELETE CASCADE;

ALTER TABLE shell_runs DROP COLUMN bot_id, DROP COLUMN conversation_id, ADD COLUMN chat_bot_id bigint NOT NULL REFERENCES chat_bots (id) ON DELETE CASCADE;
CREATE INDEX ix_shell_runs_chat_bot ON shell_runs (chat_bot_id, id);

ALTER TABLE app_jobs DROP COLUMN conversation_id, ADD COLUMN chat_bot_id bigint REFERENCES chat_bots (id) ON DELETE CASCADE;
ALTER TABLE app_watches DROP COLUMN bot_id, DROP COLUMN conversation_id, ADD COLUMN chat_bot_id bigint NOT NULL REFERENCES chat_bots (id) ON DELETE CASCADE;
CREATE INDEX ix_app_watches_chat_bot ON app_watches (chat_bot_id);

ALTER TABLE connect_follow_ups
  DROP COLUMN conversation_id,
  ADD COLUMN chat_bot_id bigint NOT NULL REFERENCES chat_bots (id) ON DELETE CASCADE,
  ADD CONSTRAINT connect_follow_ups_message_foreign FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE CASCADE;
CREATE INDEX ix_connect_follow_ups_chat ON connect_follow_ups (chat_bot_id) WHERE ((status)::text = 'ready'::text);

ALTER TABLE media_checks DROP COLUMN bot_id, ADD COLUMN chat_bot_id bigint;

ALTER TABLE vault_items
  DROP COLUMN user_id,
  ADD COLUMN workspace_id bigint NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  ADD COLUMN made_by bigint REFERENCES users (id) ON DELETE SET NULL;
CREATE INDEX ix_vault_items_home ON vault_items (workspace_id);

ALTER TABLE user_skills ADD COLUMN workspace_id bigint NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE;
DROP INDEX ix_user_skills_user;
CREATE INDEX ix_user_skills_person ON user_skills (workspace_id, user_id);

ALTER TABLE plugin_actions_off
  DROP COLUMN user_id,
  ADD COLUMN workspace_id bigint NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE;
CREATE UNIQUE INDEX ux_plugin_actions_off_key ON plugin_actions_off (workspace_id, plugin_id, action_id);

ALTER TABLE bot_policies ALTER COLUMN workspace_id SET NOT NULL;
DROP INDEX ux_bot_policies_key;
CREATE UNIQUE INDEX ux_bot_policies_key ON bot_policies (workspace_id, user_id);
ALTER TABLE approval_rules ALTER COLUMN workspace_id SET NOT NULL;
DROP INDEX ix_approval_rules_user;
CREATE INDEX ix_approval_rules_person ON approval_rules (workspace_id, user_id);
`;

exports.contracts =
  "Version 0 (D-112): no one uses Mercbot before day 0 and nothing in any database is kept, so this release deletes " +
  "every bot and chat-bearing row, drops the old chat tables and columns outright and re-keys the rest in one step, " +
  "with no release before it left running: Online recreates its database at this release. It can't be rolled back.";

exports.down = async function down() {
  throw new Error("Chats are the core (D-112) can't be rolled back: the old chat tables and every bot are gone.");
};
