// The filters the bots' repositories read by beyond each table's own search fields (records/tableResources.js): id
// lists, id bounds and the few values kept inside a message body. Server-only: they go in BotRecordsFeature's owns.

export const idList = (actualField) => Object.freeze({ type: "array", actualField, filterOperator: "in", items: { type: "id" } });
const idBound = (filterOperator) => Object.freeze({ type: "id", actualField: "id", filterOperator });

/** A value kept as text in the message body (a JSON object): `compare` writes the comparison, its key literal in the SQL. */
const bodyText = (compare) => Object.freeze({
  type: "string",
  applyFilter(query, input, { column }) {
    compare(query, column("body"), String(input));
  }
});

const isSet = (field) => Object.freeze({
  type: "boolean",
  applyFilter(query, input, { column }) {
    if (input) query.whereNotNull(column(field));
    else query.whereNull(column(field));
  }
});

export const CHAT_SEARCH = Object.freeze({
  // An app's chat with the Builder, or any other.
  app: isSet("appId"),
  // Archived chats, or those that aren't.
  archived: isSet("archivedAt"),
  // A direct chat (one person's with one bot), or any other.
  direct: isSet("directBotId"),
  // A chat between two people, or any other.
  directPerson: isSet("directPersonId"),
  // The chats made before one: the next page of a list read newest first.
  beforeId: idBound("<"),
  // A chat at this step of its onboarding script: what moves it on writes only while it's still there.
  onboardingStep: Object.freeze({ type: "string", actualField: "onboardingStep", filterOperator: "=" }),
  // The chats a bot in this chat may read (D-112): the migration's readable_from(chat).
  readableFrom: Object.freeze({
    type: "id",
    applyFilter(query, input, { column }) {
      query.whereRaw(`?? in (select readable_from(?))`, [column("id"), String(input)]);
    }
  })
});

export const CHAT_PERSON_SEARCH = Object.freeze({
  conversationIds: idList("conversationId"),
  userIds: idList("userId"),
  // Everyone in the chat but this person: who a new message marks unread.
  notUserId: Object.freeze({
    type: "id",
    applyFilter(query, id, { column }) {
      query.whereNot(column("userId"), id);
    }
  }),
  // Everyone but these people: who has a place in a home's chats but is no longer one of its active members.
  notUserIds: Object.freeze({
    type: "array",
    items: { type: "id" },
    applyFilter(query, ids, { column }) {
      query.whereNotIn(column("userId"), ids.map(String));
    }
  }),
  // A pinned chat: the person's pins, in their order.
  pinned: isSet("pinPosition"),
  // Mentioned in the chat since they last read it (D-114): a later mention keeps the first one's time.
  mentioned: isSet("mentionedAt")
});

export const CHAT_BOT_SEARCH = Object.freeze({
  conversationIds: idList("conversationId"),
  botIds: idList("botId")
});

export const MESSAGE_SEARCH = Object.freeze({
  // A page before the oldest message shown, the messages past a summary, and what a continued room knew.
  beforeId: idBound("<"),
  afterId: idBound(">"),
  atMostId: idBound("<="),
  kinds: Object.freeze({ type: "array", actualField: "kind", filterOperator: "in", items: { type: "string" } }),
  // A chat's catch-up: the messages a transaction changed since the page's cursor (the trigger-kept xid8 stamp).
  changedSince: Object.freeze({ type: "xid8", actualField: "changed", filterOperator: ">=" }),
  // The person's message as their page sent it (D-19), a routine run's message (D-57) and a card's status, claimed
  // once (a draft being sent).
  clientId: bodyText((query, body, value) => query.whereRaw("?? ->> 'clientId' = ?", [body, value])),
  routineId: bodyText((query, body, value) => query.whereRaw("?? ->> 'routine' = ?", [body, value])),
  bodyStatus: bodyText((query, body, value) => query.whereRaw("?? ->> 'status' = ?", [body, value])),
  // A page's cards, deleted from the Library together, and the cards that name one slug (rewriteCards).
  bodyPath: bodyText((query, body, value) => query.whereRaw("?? ->> 'path' = ?", [body, value])),
  bodySlug: bodyText((query, body, value) => query.whereRaw("?? ->> 'slug' = ?", [body, value])),
  // What one bot made, in every chat it's in: the messages it wrote (D-112).
  madeBy: Object.freeze({ type: "id", actualField: "authorBotId", filterOperator: "=" }),
  // The messages of some chats.
  conversationIds: idList("conversationId"),
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

export const BOT_SEARCH = Object.freeze({
  // The bots pointing at some of the home's templates (D-98): how many use each.
  homeTemplateIds: idList("homeTemplateId"),
  // The bots following some of Mercbot's templates (D-105): a team leaves out the ones the home has.
  libraryTemplates: Object.freeze({ type: "array", actualField: "libraryTemplate", filterOperator: "in", items: { type: "string" } }),
  // The home's main bot: the one that is replaced when another becomes it.
  isMain: Object.freeze({ type: "boolean", actualField: "isMain" }),
  // Archived bots (D-108), or those that aren't: an archive or unarchive writes only a bot that isn't one yet.
  archived: Object.freeze({
    type: "boolean",
    applyFilter(query, input, { column }) {
      if (input) query.whereNotNull(column("archivedAt"));
      else query.whereNull(column("archivedAt"));
    }
  }),
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
