import { fail, pass } from "./helpers.mjs";
// A discussion of three bots (D-115): a chat with the person and three bots, a Discuss card on a real question, one
// round started as the card's Start does, then Wrap up. Judged on what the round and the wrap-up said: every bot spoke
// or passed, no turn repeats another's point, the wrap-up names a choice, and what the card says it cost stays under the
// cap it started with. Its words come from a real model, so this case is for the bench (scripts/agent-evals-ours.mjs
// --suite chat --only discuss-three), never the test suites.
export const builder = false;
export const group = true;
export const prompt = "We have one free Saturday next month and three options: repaint the kitchen, fix the garden fence, or take the kids to the coast. Which should we do, and why?";

const OTHERS = [
  { name: "Gardener", color: "#2E7D32", instructions: "You look after the house's garden and outdoor jobs." },
  { name: "Planner", color: "#6A1B9A", instructions: "You plan the family's weekends, trips and budget." }
];

// The chat's two other bots, seated after the case's own one (renamed Handy, the house's odd jobs).
export async function setup({ knex, bot, workspaceId, userId, chatId }) {
  await knex("bots").where({ id: bot.id }).update({ name: "Handy", instructions: "You handle the house's repairs and odd jobs." });
  const made = await knex("bots").insert(OTHERS.map((other) => ({ ...other, made_by: userId, workspace_id: workspaceId }))).returning("id");
  await knex("chat_bots").insert(made.map(({ id }, at) => ({ conversation_id: chatId, workspace_id: workspaceId, bot_id: id, position: at + 1 })));
}

/** The card as the chat now keeps it. */
const cardOf = async (knex, chatId) => knex("messages").where({ conversation_id: chatId, kind: "discussion" }).orderBy("id", "desc").first();

// Propose, start one round, wait for it, wrap up, wait again: each step as the card's presses send it.
export async function script({ knex, service, options, chatId }) {
  const where = { timeZone: "Europe/London", language: "en" };
  const { messages: [message] } = await service.chat.discuss(chatId, { question: prompt }, options);
  await service.chat.startDiscussion(chatId, message.id, { rounds: 1, ...where }, options);
  await service.drain(10 * 60 * 1000);
  const waiting = await cardOf(knex, chatId);
  if (waiting.body.status !== "waiting") return;
  await service.chat.wrapUpDiscussion(chatId, message.id, where, options);
  await service.drain(10 * 60 * 1000);
}

const words = (text) => new Set(String(text).toLowerCase().match(/[a-z']{4,}/gu) || []);
/** How much of `a`'s vocabulary `b` shares: near 1 when one turn restates another. */
const overlap = (a, b) => {
  const left = words(a);
  const right = words(b);
  return left.size ? [...left].filter((word) => right.has(word)).length / left.size : 0;
};

export async function judge({ knex, chatId }) {
  const card = await cardOf(knex, chatId);
  if (!card) return fail("no discussion card");
  const body = card.body;
  if (body.status !== "ended" || body.ended !== "wrapped") return fail(`card ${body.status}/${body.ended}`);
  const turns = await knex("messages").where({ conversation_id: chatId, role: "bot", kind: "text" }).whereRaw("body->>'discussion' = ?", [String(card.id)]).orderBy("id");
  const round = turns.filter((turn) => Number(turn.body.round) === 1);
  const wrap = turns.filter((turn) => turn.body.round === "wrap");
  const spokeOrPassed = new Set([...round.map((turn) => String(turn.author_bot_id)), ...(body.passed || []).map(String)]);
  if (spokeOrPassed.size !== body.bots.length) return fail(`${spokeOrPassed.size} of ${body.bots.length} bots spoke or passed`);
  for (const [at, turn] of round.entries()) {
    for (const earlier of round.slice(0, at)) {
      if (overlap(turn.body.text, earlier.body.text) > 0.6) return fail(`a turn repeats another: ${turn.body.text.slice(0, 200)}`);
    }
  }
  if (wrap.length !== 1) return fail(`${wrap.length} wrap-ups`);
  if (!/kitchen|fence|coast/iu.test(wrap[0].body.text)) return fail(`the wrap-up names no option: ${wrap[0].body.text.slice(0, 300)}`);
  if (Number(body.spentNano) > Number(body.capNano)) return fail(`spent ${body.spentNano} over its cap ${body.capNano}`);
  return pass(`${round.length} spoke, ${(body.passed || []).length} passed; $${(Number(body.spentNano) / 1e9).toFixed(4)} of up to $${(Number(body.capNano) / 1e9).toFixed(4)}`);
}
