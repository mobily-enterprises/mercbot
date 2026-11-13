// The filters the bots' repositories read by beyond each table's own search fields (records/tableResources.js): id
// lists, id bounds and the few values kept inside a message body. Server-only: they go in BotRecordsFeature's owns.

const idList = (actualField) => Object.freeze({ type: "array", actualField, filterOperator: "in", items: { type: "id" } });
const idBound = (filterOperator) => Object.freeze({ type: "id", actualField: "id", filterOperator });

/** A value kept as text in the message body (a JSON object): `compare` writes the comparison, its key literal in the SQL. */
const bodyText = (compare) => Object.freeze({
  type: "string",
  applyFilter(query, input, { column }) {
    compare(query, column("body"), String(input));
  }
});

export const CONVERSATION_SEARCH = Object.freeze({
  botIds: idList("botId"),
  // A seat with a pin position: the person's pinned bots.
  pinned: Object.freeze({
    type: "boolean",
    applyFilter(query, input, { column }) {
      if (input) query.whereNotNull(column("pinPosition"));
      else query.whereNull(column("pinPosition"));
    }
  }),
  // Rooms active since a moment: a turn's recent group chats (turnRepository.js recentGroupsOf).
  lastActivityAfter: Object.freeze({ type: "dateTime", actualField: "lastActivityAt", filterOperator: ">" })
});

export const MESSAGE_SEARCH = Object.freeze({
  // A page before the oldest message shown, the messages past a summary, and what a continued room knew.
  beforeId: idBound("<"),
  afterId: idBound(">"),
  atMostId: idBound("<="),
  kinds: Object.freeze({ type: "array", actualField: "kind", filterOperator: "in", items: { type: "string" } }),
  // A chat's catch-up: the messages a transaction changed since the page's cursor (the trigger-kept xid8 stamp).
  changedSince: Object.freeze({ type: "xid8", actualField: "changed", filterOperator: ">=" }),
  // The person's message as their page sent it (D-19), a routine run's message (D-57), a note's chat line (D-36) and a
  // card's status, claimed once (a draft being sent).
  clientId: bodyText((query, body, value) => query.whereRaw("?? ->> 'clientId' = ?", [body, value])),
  routineId: bodyText((query, body, value) => query.whereRaw("?? ->> 'routine' = ?", [body, value])),
  // As ix_bot_messages_note indexes it: (body->>'noteId') where kind = 'note'.
  noteId: bodyText((query, body, value) => query.whereRaw("?? ->> 'noteId' = ?", [body, value])),
  bodyStatus: bodyText((query, body, value) => query.whereRaw("?? ->> 'status' = ?", [body, value])),
  // A page's cards, deleted from the Library together, and the cards that name one slug (rewriteCards).
  bodyPath: bodyText((query, body, value) => query.whereRaw("?? ->> 'path' = ?", [body, value])),
  bodySlug: bodyText((query, body, value) => query.whereRaw("?? ->> 'slug' = ?", [body, value])),
  // What one bot made: in its own conversations (no other speaker), and where it spoke in a group (D-46).
  madeBy: Object.freeze({
    type: "id",
    applyFilter(query, input, { column }) {
      const botId = String(input);
      query.where((made) => made
        .where((own) => own.where(column("botId"), botId).whereRaw("?? -> 'speaker' is null", [column("body")]))
        .orWhereRaw("?? -> 'speaker' ->> 'id' = ?", [column("body"), botId]));
    }
  }),
  // A made message holding a Library pin: its own (a page, chart or view), or one of its files' or pictures'.
  pinned: Object.freeze({
    type: "boolean",
    applyFilter(query, input, { column }) {
      const holdsPin = (where) => where
        .whereRaw("?? @> ?::jsonb", [column("body"), JSON.stringify({ pinned: true })])
        .orWhereRaw("?? @> ?::jsonb", [column("body"), JSON.stringify({ files: [{ pinned: true }] })])
        .orWhereRaw("?? @> ?::jsonb", [column("body"), JSON.stringify({ images: [{ pinned: true }] })]);
      if (input) query.where(holdsPin);
      else query.whereNot(holdsPin);
    }
  })
});

export const GROUP_SEARCH = Object.freeze({ groupIds: idList("groupId") });

export const READ_SEARCH = Object.freeze({ conversationIds: idList("conversationId") });

export const BOT_SEARCH = Object.freeze({
  // The home's main bot: the one that is replaced when another becomes it.
  isMain: Object.freeze({ type: "boolean", actualField: "isMain" }),
  // A bot named in any case: a bot asks another by name (directory.js botNamed).
  nameInAnyCase: Object.freeze({
    type: "string",
    applyFilter(query, input, { column }) {
      query.whereRaw("lower(??) = lower(?)", [column("name"), String(input)]);
    }
  }),
  // Every bot but this one: a bot asking another by name never finds itself (directory.js botNamed).
  notId: Object.freeze({
    type: "id",
    applyFilter(query, id, { column }) {
      query.whereNot(column("id"), id);
    }
  })
});

// The notes still in a bot's notebook (removedAt: null, which matches IS NULL: json-rest-api 3.1 takes a null filter
// only on a nullable entry). turnRepository.js reads the notebook through it.
export const NOTEBOOK_SEARCH = Object.freeze({ removedAt: Object.freeze({ type: "dateTime", nullable: true, actualField: "removedAt" }) });
