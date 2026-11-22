import assert from "node:assert/strict";
import test from "node:test";
import { modelTools, runLoop } from "@jskit-ai/agent/server";
import { MockLanguageModelV4 } from "ai/test";
import { ROOMS_MEMORY_LIMITS } from "../../packages/bots/src/server/roomsMemory.js";
import { roomsMemoryToolsFor } from "../../packages/bots/src/server/roomsMemoryTools.js";

// What keeps replies cheap (D-57): cached input costs a fiftieth of uncached, and a cache reuses only
// an unchanged start. The state note changes every turn, so nothing that stays the same may follow it.
function recording() {
  const prompts = [];
  const model = new MockLanguageModelV4({
    doGenerate: async ({ prompt }) => {
      prompts.push(prompt);
      return {
        content: [{ type: "text", text: "Done." }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
        warnings: []
      };
    }
  });
  return { model, prompts };
}

const say = (role, content) => ({ role, content });
const earlier = [say("user", "First question"), say("assistant", "First answer")];
const turn = (model, history, state) => runLoop({ model, name: "Otto", instructions: "Be helpful.", summary: "Older things.", history, state, tools: {}, maxSteps: 2 });

test("from turn to turn, everything before the state note stays exactly the same", async () => {
  const { model, prompts } = recording();
  await turn(model, [...earlier, say("user", "Second question")], "It's now 17:00.");
  await turn(model, [...earlier, say("user", "Second question"), say("assistant", "Second answer"), say("user", "Third question")], "It's now 17:10.");
  const [first, second] = prompts.map((prompt) => JSON.stringify(prompt));
  const sentBefore = JSON.stringify(prompts[0].slice(0, -1)).slice(0, -1);
  assert.ok(second.startsWith(sentBefore), `the next turn starts with all of the last one but its note:\n${first}\n${second}`);
  assert.ok(!JSON.stringify(prompts[1].filter((message) => message.role === "system")).includes("17:10"), "the time isn't in the system prompt");
  assert.match(JSON.stringify(prompts[1].at(-1)), /17:10/u, "the note is the last thing the model reads");
});

test("the summary stays in the system prompt, and no note means no extra message", async () => {
  const { model, prompts } = recording();
  await turn(model, [say("user", "Hi")], "");
  assert.match(JSON.stringify(prompts[0].filter((message) => message.role === "system")), /Older things/u);
  assert.equal(prompts[0].filter((message) => message.role === "user").length, 1);
});

/**
 * The rooms memory tools a person's own turn is offered (roomsMemoryTools.js), as the model is shown them, for a bot's seat: in a
 * chat it reads whole, or in a room it joined late, reading it from a message on.
 */
function shownTools(seat) {
  const tools = roomsMemoryToolsFor({
    records: {},
    roomsMemory: { limits: ROOMS_MEMORY_LIMITS },
    seat,
    turn: { remembers: true, tells: true, timeZone: "Europe/Rome" },
    call: {}
  })(async () => ({}));
  return Object.entries(modelTools(tools)).map(([key, tool]) => ({ key, description: tool.description, schema: tool.inputSchema.jsonSchema }));
}

test("read_further_back is offered the same in every chat, read whole or from a late start, so the tools stay a cached prefix", () => {
  const whole = shownTools({ id: "7", chat_id: "10", chat_bot_id: "100", reads_from_message_id: null });
  const late = shownTools({ id: "8", chat_id: "11", chat_bot_id: "101", reads_from_message_id: "5000" });
  assert.ok(whole.some((tool) => tool.key === "readFurtherBack"), "a person's own turn has it, even where the bot reads the whole chat");
  assert.equal(JSON.stringify(late), JSON.stringify(whole), "every tool, its words and its input, the same in both chats");
  const { schema } = whole.find((tool) => tool.key === "readFurtherBack");
  assert.match(schema.properties.messages.description, /100 if left out.*greater than or equal to 1, lower than or equal to 200/su);
});
