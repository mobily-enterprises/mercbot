import assert from "node:assert/strict";
import test from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import { writeSkillFromDemo } from "../../packages/bots/src/server/botWriting.js";

// A taught task becomes a skill (Teach a task, learning-by-demo.md): the writer is told to mark the steps that order,
// pay or send "Ask first:", so the skill stops there for the person's yes every time it runs, and its answer is kept
// as the model wrote it, trimmed to size.
test("the skill writer marks ordering, paying and sending steps ask-first, and its answer is kept", async () => {
  const prompts = [];
  const answer = {
    name: "Order the weekly groceries",
    description: "Orders the usual groceries from the shop.",
    input: { label: "the delivery day", example: "Friday" },
    steps: ["Open `shop.example.com`", "Add the usual items", "Ask first: place the order for `Friday`"],
    instructions: "Ask which delivery day if none was given.\n1. Open shop.example.com\n2. Add the usual items\n3. Ask first: place the order for {{input}}"
  };
  const model = new MockLanguageModelV4({
    doGenerate: async ({ prompt }) => {
      prompts.push(prompt);
      return {
        content: [{ type: "text", text: JSON.stringify(answer) }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
        warnings: []
      };
    }
  });
  const skill = await writeSkillFromDemo(model, ["Opened shop.example.com", "Clicked Place order"]);
  const system = prompts[0].find((message) => message.role === "system").content;
  assert.match(system, /A step that orders, pays or sends something .* starts with "Ask first:" in both steps and instructions/u);
  assert.match(system, /go on only once the person has said yes in the chat, every time the skill runs/u);
  assert.deepEqual(skill, { ...answer, input: { label: "the delivery day", example: "Friday" } });
});
