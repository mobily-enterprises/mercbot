import { generateOnce } from "@jskit-ai/agent/server";
import { contentOf, instructionsFor } from "./botAgent.js";
import { modelFailure } from "./modelFailures.js";

// A Mercbot bot's one-shot writing jobs, outside its replies: the status line and reaction for a
// message, a new bot's welcome and first question, one answer for another feature, and a taught skill.

const ACTIVITY_INSTRUCTIONS = [
  "You label what an assistant is about to do for a user's message.",
  "Reply with JSON only: {\"status\": string, \"emoji\": string or null}.",
  "status: 2 to 5 words in present continuous describing the work, e.g. \"Looking up train times\". No trailing dot.",
  "emoji: one emoji reacting warmly to the message (one of 👍 ❤️ 😂 🎉 🙌 👀), or null if none fits."
].join("\n");

/**
 * A short label for the status line and an optional reaction to the user's message.
 * It's only a label: a model that doesn't answer, or answers in another shape, leaves the status line
 * its general wording. (A failed model call would otherwise answer the page with the model's own
 * status, such as 401 for a refused key, as if the page weren't signed in.) A failed call is logged in
 * one line with its message and status only: the error also carries the request, the message included.
 * @param {import("./types.js").ChatModel} model
 * @param {{ id: string }} bot
 * @param {object} userMessage
 */
export async function describeActivity(model, bot, userMessage) {
  try {
    const parsed = await askJson(model, ACTIVITY_INSTRUCTIONS, contentOf(userMessage).slice(0, 2000));
    const status = String(parsed?.status || "").trim().slice(0, 60);
    const emoji = typeof parsed?.emoji === "string" && parsed.emoji.trim() ? parsed.emoji.trim().slice(0, 8) : null;
    return { status, emoji };
  } catch (error) {
    // JSON.parse's SyntaxError is an answer in another shape; anything else is the model call failing.
    if (!(error instanceof SyntaxError)) console.warn(`Bot ${bot.id}'s status line has no label: ${modelFailure(error)}`);
    return { status: "", emoji: null };
  }
}

async function askJson(model, instructions, prompt) {
  const text = await generateOnce({ model, system: instructions, messages: [{ role: "user", content: prompt }] });
  return JSON.parse(String(text || "").replace(/^```(json)?|```$/gu, "").trim());
}

/**
 * A new bot's own short welcome.
 * @param {import("./types.js").ChatModel} model
 * @param {object} bot
 * @param {string} firstName
 */
export async function writeGreeting(model, bot, firstName) {
  const text = await generateOnce({
    model,
    system: `You are ${bot.name}, a brand-new personal assistant bot in Mercbot.`,
    messages: [
      {
        role: "user",
        content:
          `Write your first message to ${firstName}: greet them by name, say your name, and add one friendly line about being ` +
          `ready to help. One or two short sentences, no emoji, no question.`
      }
    ]
  });
  return String(text || "").trim();
}

/**
 * The question card a new bot opens with: what to help with first, with 3 to 5 options.
 * @param {import("./types.js").ChatModel} model
 * @param {object} bot
 * @param {{ multi: boolean }} options
 */
export async function writeFirstQuestion(model, bot, { multi }) {
  const parsed = await askJson(
    model,
    "You write one short question card for a new assistant bot. Reply with JSON only.",
    [
      `The bot is called ${bot.name}. It helps with work and everyday life: research, monitoring news or prices, shopping and ` +
        `bookings, email and scheduling, documents and more.`,
      "Write a question asking what it should help with first, in under 12 words.",
      "Give 3 or 4 different short options (2 to 5 words each), varied and specific to everyday errands.",
      'JSON shape: {"question": string, "options": [string]}'
    ].join("\n")
  );
  const options = (Array.isArray(parsed.options) ? parsed.options : [])
    .map((option) => String(option).trim().slice(0, 60))
    .filter(Boolean)
    .slice(0, 4);
  if (!parsed.question || options.length < 3) throw new Error("The first question came back incomplete.");
  return {
    question: String(parsed.question).trim().slice(0, 120),
    options,
    multi
  };
}

/**
 * A bot's one answer to `question`, in its own voice and kept nowhere: for a feature that shows it somewhere else.
 * @param {import("./types.js").ChatModel} model
 * @param {object} bot
 * @param {string} question
 */
export async function answerAsBot(model, bot, question) {
  const text = await generateOnce({ model, system: instructionsFor(bot), messages: [{ role: "user", content: question }] });
  return String(text || "").trim();
}

const SKILL_WRITER = [
  "You turn a recording of a person doing a task in a web browser into a reusable skill for their assistant.",
  "The recording is a list of what they did: pages opened, clicks, values typed and Enter presses. Values shown as (hidden) were passwords or card details: never guess them; that step means the person signs in.",
  "Reply with JSON only:",
  '{"name": short title of the task, 3 to 6 words;',
  '"description": one sentence on what the skill does;',
  '"input": {"label": what changes each time, in a few words (e.g. "the search term"), "example": the value used in the ' +
    "recording} or null when nothing changes;",
  '"steps": 2 to 8 short steps in plain words, in order, with literal values such as addresses and the example input in `backticks`;',
  '"instructions": the same steps as a numbered Markdown list for the assistant to follow later, with the input written as ' +
    "{{input}} instead of the example, and a first line saying what to ask for if the input wasn't given}.",
  'Leave out stray clicks that didn\'t matter. If nothing useful happened, reply {"name": ""}.'
].join("\n");

/**
 * A taught task becomes a skill: its name, steps and instructions.
 * @param {import("./types.js").ChatModel} model
 * @param {string[]} lines
 */
export async function writeSkillFromDemo(model, lines) {
  const skill = await askJson(model, SKILL_WRITER, `Recording:\n${lines.join("\n")}`);
  return {
    name: String(skill.name || "")
      .trim()
      .slice(0, 80),
    description: String(skill.description || "")
      .trim()
      .slice(0, 240),
    input: skill.input?.label
      ? { label: String(skill.input.label).slice(0, 80), example: String(skill.input.example || "").slice(0, 120) }
      : null,
    steps: (Array.isArray(skill.steps) ? skill.steps : [])
      .map((step) => String(step).trim())
      .filter(Boolean)
      .slice(0, 12),
    instructions: String(skill.instructions || "").trim()
  };
}
