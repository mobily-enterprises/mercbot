// Who may see a bot, a conversation and its messages (D-36, D-46). These are the visibility rules
// that were written by hand at every read: listBots (botList.js:26-31), ownedBot and inGroup
// (botConversations.js:71-72,166-172) and yoursOrRooms (botLibrary.js:83-92). Ownership already
// keeps every read in the request's home; these only narrow inside it. What one screen lists
// (search leaving out a member bot's group computer, the list leaving out other people's seats)
// stays a filter on that screen's read: a policy hides a row everywhere.
//
// A signed-in person sees:
// - every bot of the home that is not a group chat, and the group chats they are in;
// - their own conversation with any bot (a seat: user_id is theirs);
// - a bot's rooms (user_id and group_id empty), when the bot is not a group chat or they are in it;
// - a member bot's own computer for a group (user_id empty, group_id set), when they are in that group;
// - the messages of the conversations they see.
// A job for a person (`{ actorId }`, a reply or a request carried out later) sees what that person
// sees. Background work for no one (a system context, a home's job) is scoped by ownership alone; an
// anonymous caller (a public app's visitor) sees none of them.

const GROUP = "group";

/** Whom the call is for: a request's signed-in person, or the person a job works for. */
function personOf(caller) {
  return caller.kind === "user" ? caller.userId : caller.actorId;
}

/** The person is one of the group's people: bot_group_people holds a row for them. */
function personInGroup(ownTable, groupIdColumn, userId) {
  return ownTable("botGroupPeople")
    .select(1)
    .whereColumn("bot_group_people.group_id", groupIdColumn)
    .where("bot_group_people.user_id", userId);
}

/**
 * The conversation predicate, for the conversations' own reads and for the messages' (which read
 * it on their conversation). `col` names a column of the conversation row as its query sees it.
 * @param {import("knex").Knex.QueryBuilder} builder
 * @param {{ col: (column: string) => string, ownTable: (name: string) => import("knex").Knex.QueryBuilder, userId: string }} options
 */
function visibleConversation(builder, { col, ownTable, userId }) {
  return builder
    .where(col("user_id"), userId)
    .orWhere((room) => room
      .whereNull(col("user_id"))
      .whereNull(col("group_id"))
      .where((kind) => kind
        .whereNotExists(ownTable("bots").select(1).whereColumn("bots.id", col("bot_id")).where("bots.kind", GROUP))
        .orWhereExists(personInGroup(ownTable, col("bot_id"), userId))))
    .orWhere((groupSeat) => groupSeat
      .whereNull(col("user_id"))
      .whereNotNull(col("group_id"))
      .whereExists(personInGroup(ownTable, col("group_id"), userId)));
}

const CONVERSATION_FIELDS = Object.freeze({ user_id: "userId", group_id: "groupId", bot_id: "botId" });

/** bots: a group chat only for its people (listBots, ownedBot). */
export function botVisibility({ query, caller, column, value, ownTable }) {
  if (caller.kind === "anonymous") return false;
  const person = personOf(caller);
  if (!person) return true;
  query.where((visible) => visible
    .whereNot(column("kind"), GROUP)
    .orWhereExists(personInGroup(ownTable, column("id"), value("userId", person))));
  return true;
}

/** bot_conversations: the person's own seats, the rooms of bots they see, their groups' member computers. */
export function conversationVisibility({ query, caller, column, value, ownTable }) {
  if (caller.kind === "anonymous") return false;
  const person = personOf(caller);
  if (!person) return true;
  const userId = value("userId", person);
  query.where((visible) => visibleConversation(visible, { col: (name) => column(CONVERSATION_FIELDS[name]), ownTable, userId }));
  return true;
}

/** bot_messages: the messages of a conversation the person sees (search, the timeline, the list's preview). */
export function messageVisibility({ query, caller, column, value, ownTable }) {
  if (caller.kind === "anonymous") return false;
  const person = personOf(caller);
  if (!person) return true;
  const userId = value("userId", person);
  query.whereExists(ownTable("botConversations")
    .select(1)
    .whereColumn("bot_conversations.id", column("conversationId"))
    .where((visible) => visibleConversation(visible, { col: (name) => `bot_conversations.${name}`, ownTable, userId })));
  return true;
}

/** Pure parts the tests reach directly. */
export const __testables = Object.freeze({ visibleConversation });
