import assert from "node:assert/strict";
import test from "node:test";
import { runLoop } from "@jskit-ai/agent/server";
import { MockLanguageModelV4 } from "ai/test";

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
