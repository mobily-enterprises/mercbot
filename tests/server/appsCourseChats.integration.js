import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import { generateReply } from "../../packages/bots/src/server/botAgent.js";
import { NO_CONNECTED_APPS, membersOn } from "../support/appsFeatures.mjs";
import { appsHome, botsOf } from "../support/appsHome.mjs";
import { startChatTurns } from "../support/botDoubles.mjs";
import { memberOptions } from "../support/botRecords.mjs";
import { earlierTransactionsEnded } from "../support/testDatabase.mjs";

// The courses' bots in their app's chat (D-147), on the test database, one exchange a course: the person asks about the
// lesson open, and the bot's turn is told the course's own brief and the app guide Mercbot wrote as it was published, in
// the cached start of its prompt, and gets the lesson on screen, typed code and all, in the person's message; its answer
// is posted in their chat. The apps are the real ones, installed from their templates; the model is a stand-in.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const templateOf = (key) => JSON.parse(readFileSync(new URL(`../../packages/apps/templates/${key}.json`, import.meta.url), "utf8"));

/**
 * A home with its main bot Otto and the course installed and published (with the bot it comes with), a chat kit whose
 * replies go through the real reply builder on a model that keeps each prompt, and the person's chat with the app's bot.
 */
async function courseChat(context, key, answer) {
  const prompts = [];
  const model = new MockLanguageModelV4({
    doGenerate: async ({ prompt }) => {
      prompts.push(prompt);
      return { content: [{ type: "text", text: answer }], finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } }, warnings: [] };
    }
  });
  let home = null;
  const kit = await startChatTurns(context, {
    reply: (bot, timeline, tools, state, prompt, options) => generateReply(bot, timeline, tools, state, prompt, { ...options, languageModel: model }),
    checkClaims: null,
    activity: async () => ({ status: "", emoji: null }),
    // The apps' side of the bot's turn, the real one in the course's home, as its person.
    apps: { appBots: { forTurn: (appId) => home.apps.appBots.forTurn(appId, home.options) } }
  });
  const { knex } = kit;
  const bots = botsOf(knex);
  const made = {};
  const appBot = async (slug) => {
    made.own ??= { id: String((await knex("bots").insert({ workspace_id: home.workspaceId, made_by: home.userId, name: slug === "coach" ? "Coach" : "Learner", color: "#1E86FC", library_template: slug }).returning("id"))[0].id), name: slug === "coach" ? "Coach" : "Learner" };
    return made.own;
  };
  const faces = async () => [{ id: made.main, name: "Otto", main: true, archived: false }, ...(made.own ? [{ ...made.own, main: false, archived: false }] : [])];
  // The person's chat with the app's bot is the bots' real one, made as them.
  const as = () => memberOptions({ userId: home.userId, homeId: home.workspaceId });
  const chats = { ...membersOn(knex), appBotChat: (input) => kit.records.chats.appBotChat(input, as()) };
  const records = { ...bots, directory: { ...bots.directory, homeBotFaces: faces }, chats };
  home = await appsHome(kit.cleanup, { slug: `apps-${key}`, knex, records, extras: { inputs: { "mercbot.app-connected": { ...NO_CONNECTED_APPS, appBot } } } });
  made.main = String((await knex("bots").insert({ workspace_id: home.workspaceId, made_by: home.userId, name: "Otto", color: "#1E86FC" }).returning("id"))[0].id);
  const actor = { type: "person", id: home.userId, name: "Pat" };
  const { app, errors } = await home.apps.installTemplate(home.ctx(actor), key, {});
  assert.deepEqual(errors, []);
  await earlierTransactionsEnded(knex);
  await home.apps.apps.publish(actor, app.slug, {}, home.options);
  const { chat, bot } = await home.apps.appBots.botChat(app.slug, home.options);
  /** The person asks from the app, with what's on screen; what the model was sent, and what the bot said. */
  const ask = async (text, snapshot) => {
    const sent = await kit.turns.chat.sendMessage(chat.id, { text, snapshot }, as());
    const replied = await kit.turns.chat.reply(chat.id, { afterMessageId: sent.messages.at(-1).id }, undefined, as());
    await kit.drain();
    const prompt = prompts.at(-1);
    const textOf = (message) => (typeof message.content === "string" ? message.content : message.content.map((part) => part.text || "").join(""));
    return {
      system: prompt.filter((message) => message.role === "system").map(textOf).join("\n"),
      asked: textOf(prompt.at(-2)),
      said: replied.messages.at(-1).body.text
    };
  };
  return { app, bot, ask, brief: templateOf(key).definition.brief };
}

const onScreen = (app, screen, form, shown = []) => ({
  app: { name: app.name, slug: app.slug },
  screen,
  params: { id: "12" },
  forms: [{ about: "editing My progress #40", fields: [form] }],
  shown,
  lists: []
});

test("Learn to program: asked what's wrong with the code on screen, Coach is told its brief and the app, and sees the code", async (context) => {
  const answer = "Line 3 gives back n itself: multiply it by 2 before you return it.";
  const { app, bot, ask, brief } = await courseChat(context, "learn_to_program", answer);
  assert.equal(bot.name, "Coach", "the app's own bot");
  const code = "def double(n):\n    # give back n times 2\n    return n";
  const turn = await ask("What's wrong with my code?", onScreen(app, { key: "lesson", title: "Lesson" }, { label: "Your code", key: "code", value: code, unsaved: true }, ["FAILED test_doubles_three: double(3) should be 6"]));
  assert.ok(turn.system.includes(brief), "the course's brief");
  assert.ok(turn.system.includes("  - button Check my answer ▶️: runs the script check"), "the app guide, from the published app");
  assert.ok(turn.system.indexOf("# The app guide of \"Learn to program\"") < turn.system.indexOf(brief), "the guide, then the brief");
  assert.ok(turn.asked.includes(`  - Your code (code), typed and not saved yet:\n    \`\`\`\n${code}\n    \`\`\``), "the code on screen, as typed");
  assert.ok(turn.asked.includes("FAILED test_doubles_three"), "and the tests' last word");
  assert.equal(turn.said, answer);
});

test("Study: asked about the lesson open, Learner is told its brief and the app, and sees the lesson", async (context) => {
  const answer = "Seeds wake up when they drink water: think of a dry bean swelling in a glass overnight.";
  const { app, bot, ask, brief } = await courseChat(context, "study", answer);
  assert.equal(bot.name, "Learner");
  const turn = await ask("Explain this lesson more simply", {
    ...onScreen(app, { key: "lesson", title: "Lesson" }, { label: "Notes", key: "notes", value: "" }),
    record: { table: "Lessons", id: "12", title: "💧 Water", values: [{ label: "Lesson", key: "text", value: "Seeds drink water to wake up." }] }
  });
  assert.ok(turn.system.includes(brief), "the course's brief");
  assert.ok(turn.system.includes("### lesson (screen lesson)"), "the app guide");
  assert.ok(turn.asked.includes("- The record open: Lessons #12 \"💧 Water\"\n  - Lesson (text): Seeds drink water to wake up."), "the lesson on screen");
  assert.equal(turn.said, answer);
});

test("Make your own LLM: asked for a hint on a lesson, the home's main bot is told the course's brief and the app, and sees the code", async (context) => {
  const answer = "softmax needs the exponent of each score first: try math.exp on each one, then divide by their sum.";
  const { app, bot, ask, brief } = await courseChat(context, "llm_course", answer);
  assert.equal(bot.name, "Otto", "no bot of its own: the home's main bot");
  const code = "def softmax(scores):\n    total = sum(scores)\n    return [s / total for s in scores]";
  const turn = await ask("Give me a hint", onScreen(app, { key: "l08", title: "Softmax" }, { label: "Your code", key: "code", value: code, unsaved: true }));
  assert.ok(turn.system.includes(brief), "the course's brief");
  assert.ok(turn.system.includes("# The app guide of \"Make your own LLM\""), "the app guide");
  assert.ok(turn.asked.includes(code), "the code on screen");
  assert.equal(turn.said, answer);
});
