import { createTool } from "@jskit-ai/agent/server";
import { z } from "zod";

// Rooms a bot starts (D-122): start_room proposes one, with its name, Private or Public, the home's bots and people in
// it and a first message (a brief), always on a card for the person the bot works for. Only their yes makes it, as
// them, through the same create as New room's (chatMembers.js), so the brief, which may carry this chat's words,
// leaves the chat only once they've seen it on the card.

/** The most a brief may be: a message's length (botRows.js messageBody). */
export const BRIEF_LIMIT = 8000;
// The most bots and people a card names besides the bot and the person.
const NAMED_LIMIT = 20;

const sameName = (name) => String(name ?? "").trim().toLowerCase();
/** Who a card names besides the person it's for: "you, Whiskers and Mercbot". */
const withWhom = (people, bots) => {
  const names = ["you", ...people.slice(1).map((person) => person.name), ...bots.map((bot) => bot.name)];
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
};
// What a refusal of a member says, when its own words name no one.
const GONE = Object.freeze({
  bots_person_not_found: "Someone on the card isn't in this home any more.",
  bots_bot_not_found: "A bot on the card isn't in this home any more."
});

/**
 * The bots and people a card names, from what the model gave: the home's bots by name (none archived) and its active
 * members by name, the proposing bot and the person always among them. An error the model sees for a name that isn't
 * one of them.
 * @param {object} shared
 * @param {import("./types.js").BotRecords} shared.records
 * @param {object} shared.seat the proposing bot in its chat, for its person
 * @param {object} shared.call the model's reader
 * @param {{ bots: string[], people: string[] }} named
 */
async function membersNamed({ records, seat, call }, named) {
  const homeBots = await records.directory.listHomeBots(call);
  const bots = [{ id: String(seat.id), name: seat.name }];
  for (const name of named.bots) {
    const found = homeBots.find((bot) => sameName(bot.name) === sameName(name));
    if (!found) return { error: `There's no bot called "${name}" in this home. The home's bots are in the Current state note.` };
    if (found.archived) return { error: `${found.name} is archived, so it can't be in a new room.` };
    if (!bots.some((bot) => bot.id === found.id)) bots.push({ id: found.id, name: found.name });
  }
  const memberIds = named.people.length ? (await records.chats.everyoneIn(call)).map(String) : [];
  const names = await records.chats.names([String(seat.user_id), ...memberIds], call);
  const people = [{ id: String(seat.user_id), name: names.get(String(seat.user_id)) || "You" }];
  for (const name of named.people) {
    const matches = memberIds.filter((id) => sameName(names.get(id)) === sameName(name));
    if (!matches.length) return { error: `Nobody called "${name}" is in this home: a room has only the home's people.` };
    if (matches.length > 1) return { error: `More than one person in this home is called "${name}". Ask the person which one they mean.` };
    if (!people.some((person) => person.id === matches[0])) people.push({ id: matches[0], name: names.get(matches[0]) });
  }
  return { bots, people };
}

/**
 * start_room, in the person's own turn: a card for them proposing a room.
 * @param {object} shared
 * @param {import("./types.js").BotRecords} shared.records
 * @param {object} shared.seat the bot in its chat, for the person it works for
 * @param {object} shared.call the model's reader
 * @param {(actionId: string, input: object) => Promise<object>} shared.attempt the turn's way to an action (botTools.js),
 *   which parks start_room on its card
 */
export function buildRoomTools({ records, seat, call, attempt }) {
  async function startRoom({ title, kind = "private", bots = [], people = [], brief }) {
    const name = String(title).trim();
    const words = String(brief).trim();
    if (!name) return { error: "Give the room a name." };
    if (!words) return { error: "Write the brief: what the room is for, from this conversation." };
    const members = await membersNamed({ records, seat, call }, { bots, people });
    if (members.error) return members;
    return attempt("start_room", { title: name, kind, bots: members.bots, people: members.people, brief: words });
  }
  return {
    startRoom: createTool(Object.freeze({
      id: "start_room",
      description:
        "Start a new room with the person, you and others of this home, for a job that needs them: above all to bring in the home's Builder when they want a database, a table or an app. " +
        "It shows the person a card with the room's name, Private or Public, who is in it and your brief, and nothing happens unless they say yes; then the room is made with exactly them, and your brief is its first message. " +
        "You and the person are always in it.",
      inputSchema: z.object({
        title: z.string().min(1).max(80).describe("The room's name, short: \"Cats database\""),
        kind: z.enum(["private", "public"]).default("private").describe("private: only its people can open it (the default); public: everyone in the home can"),
        bots: z.array(z.string().min(1).max(80)).max(NAMED_LIMIT).default([]).describe("The other bots of this home in it, by name (the Builder for a database or an app)"),
        people: z.array(z.string().min(1).max(120)).max(NAMED_LIMIT).default([]).describe("Other people of this home in it, by name; leave out for just the person"),
        brief: z.string().min(1).max(BRIEF_LIMIT).describe("The room's first message, from you: what the person wants, written from this conversation, for the others to work from")
      }),
      execute: (input) => startRoom(input)
    }))
  };
}

/**
 * start_room (D-122): an action that always asks, on a card for the person the bot works for. Their yes makes the room
 * as them, with exactly the card's bots and people (the bot and the person among them) and the bot's brief as its first
 * message after the start line; the card then opens it. A bot archived, or a person who left the home, since the card
 * was made is said, and nothing is made.
 */
export const ROOM_ACTIONS = Object.freeze({
  start_room: {
    alwaysAsks: true,
    reversible: () => true,
    describe: ({ title }) => `start the room "${title}"`,
    question: ({ title, kind, bots, people }) =>
      `Start the ${kind === "public" ? "public" : "private"} room "${title}" with ${withWhom(people, bots)}?`,
    async run({ chats, call, userId, botId }, { title, kind, bots, people, brief }) {
      const proposer = bots.find((bot) => bot.id === String(botId));
      try {
        const { chat } = await chats.create({
          kind,
          title,
          people: [...new Set([String(userId), ...people.map((person) => person.id)])],
          bots: [...new Set([String(botId), ...bots.map((bot) => bot.id)])]
        }, call, { opening: { botId: String(botId), botName: proposer?.name || "", text: String(brief).slice(0, BRIEF_LIMIT) } });
        return {
          kind: "event",
          role: "bot",
          body: {
            text: "Started the room",
            name: chat.title,
            detail: `Started the ${kind} room "${chat.title}" with ${withWhom(people, bots)}; your brief is its first message there. The person opens it from the card.`
          },
          card: { chatId: String(chat.id) }
        };
      } catch (error) {
        // A refusal says why (a bot archived or a person gone since the card); anything else is the card's.
        if (!(error?.statusCode < 500)) throw error;
        return { kind: "event", role: "system", body: { text: "The room wasn't started", detail: `${GONE[error.code] || error.message} The room wasn't started.` } };
      }
    }
  }
});
