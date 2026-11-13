// A very long chat (about 600k tokens, past what a reply reads word for word) with five facts
// planted in its older part; the bot is asked for all five (D-48: never forget unseen). The
// summary is written before the reply, by the real summariser.
export const builder = false;
export const prompt = "Quick check on things we talked about a while ago: (1) when is my sister Lucia's birthday, (2) what did we decide to call the café, (3) who is the plumber and when is he coming, (4) what's the kitchen budget, and (5) what am I allergic to? Short answers please.";

const FACTS = [
  "By the way, my sister Lucia's birthday is on 14 March.",
  "OK, decided: we're calling the café Little Fern.",
  "The plumber is Dave Kowalski, booked for Tuesday 10 November at 9am.",
  "We settled the kitchen budget at AUD 18,500.",
  "Please remember I'm allergic to cashews."
];
const TOPICS = ["the garden beds", "the weekend weather", "a podcast episode", "the bike ride", "the book club", "the recipe for dinner", "the new running shoes", "the train timetable", "the neighbour's dog", "the photo album", "the shopping list", "the gym schedule", "the playlist", "the board game night", "the paint colours"];
const PHRASES = ["I was thinking about", "Can you give me a few ideas about", "Tell me something interesting about", "I keep going back and forth on", "Let's talk a bit more about"];

function random(seed) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

// Facts an earlier run saved with remember would answer for the summary, so they go first and last.
const forget = (knex, userId) => knex("person_memories").where({ user_id: userId }).where((query) => {
  for (const word of ["Lucia", "Little Fern", "Kowalski", "18,500", "18500", "cashew"]) query.orWhere("fact", "ilike", `%${word}%`);
});

export async function setup({ knex, bot, userId }) {
  await forget(knex, userId).del();
  const conversationId = (await knex("bot_conversations").where({ bot_id: bot.id }).first()).id;
  const next = random(42);
  const pick = (list) => list[Math.floor(next() * list.length)];
  const rows = [];
  let chars = 0;
  const factAt = [40, 160, 300, 420, 520];
  for (let turn = 0; chars < 2400000; turn += 1) {
    const topic = pick(TOPICS);
    const fact = factAt.indexOf(turn) >= 0 ? `${FACTS[factAt.indexOf(turn)]} ` : "";
    const asked = `${fact}${pick(PHRASES)} ${topic}. ${"It's been on my mind this week, nothing urgent. ".repeat(3 + Math.floor(next() * 4))}`;
    const answer = Array.from({ length: 6 + Math.floor(next() * 6) }, (_, n) => `Point ${n + 1} about ${topic}: ${pick(["keep it simple", "try a small change first", "see how it feels after a week", "ask a friend for a second opinion", "write it down so you don't forget", "pick the option that's easiest to undo"])}, and ${pick(["it often works better than expected", "it saves time later", "most people find it easier", "you can always adjust it"])}.`).join(" ");
    rows.push({ workspace_id: bot.workspace_id, bot_id: bot.id, conversation_id: conversationId, kind: "text", role: "user", body: { text: asked } });
    rows.push({ workspace_id: bot.workspace_id, bot_id: bot.id, conversation_id: conversationId, kind: "text", role: "bot", body: { text: answer } });
    chars += asked.length + answer.length;
  }
  for (let index = 0; index < rows.length; index += 500) await knex("bot_messages").insert(rows.slice(index, index + 500));
}

export async function judge({ reply, knex, bot, userId }) {
  await forget(knex, userId).del();
  const conversationId = (await knex("bot_conversations").where({ bot_id: bot.id }).first()).id;
  const summarised = await knex("agent_summaries").where({ conversation_id: conversationId }).first();
  if (!summarised) return { pass: false, notes: "no summary was written before the reply" };
  const missing = [
    [/14(th)? March|March 14/iu, "birthday"],
    [/Little Fern/iu, "café"],
    [/Kowalski/iu, "plumber"],
    [/18,?500/u, "budget"],
    [/cashew/iu, "allergy"]
  ].filter(([pattern]) => !pattern.test(reply)).map(([, name]) => name);
  return missing.length ? { pass: false, notes: `missing: ${missing.join(", ")}; reply: ${reply.slice(0, 400)}` } : { pass: true };
}
