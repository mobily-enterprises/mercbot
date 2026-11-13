import assert from "node:assert/strict";
import test from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import { describeActivity } from "../../packages/bots/src/server/botWriting.js";

// The status line's few words and the bot's reaction to a message, from one model call.
// It's only a label: an answer in another shape, or a model that fails (a refused key is a 401), leaves
// no label and no reaction, never an error that the page would take as its own; a failed call is logged.
function answering(answer) {
  const prompts = [];
  const model = new MockLanguageModelV4({
    doGenerate: async ({ prompt }) => {
      prompts.push(JSON.stringify(prompt));
      if (answer instanceof Error) throw answer;
      return {
        content: [{ type: "text", text: answer }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
        warnings: []
      };
    }
  });
  return { model, prompts };
}

const bot = { id: "8", name: "Otto" };
const message = (text) => ({ role: "user", kind: "text", body: { text } });

test("the model's label and reaction come from its JSON, fenced or not, trimmed to size", async () => {
  const fenced = answering('```json\n{"status": "  Looking up train times  ", "emoji": " 👍 "}\n```');
  assert.deepEqual(await describeActivity(fenced.model, bot, message("When's the next train?")), { status: "Looking up train times", emoji: "👍" });
  assert.match(fenced.prompts[0], /You label what an assistant is about to do/u);
  assert.match(fenced.prompts[0], /When's the next train\?/u);

  const long = answering(JSON.stringify({ status: "x".repeat(80), emoji: "  " }));
  assert.deepEqual(await describeActivity(long.model, bot, message("y".repeat(2100))), { status: "x".repeat(60), emoji: null });
  assert.ok(long.prompts[0].includes("y".repeat(2000)) && !long.prompts[0].includes("y".repeat(2001)), "the model reads the message's first 2000 characters");

  const plainFence = answering('```\n{"status": "Planning the trip", "emoji": "🎉🎉🎉🎉🎉"}\n```');
  assert.deepEqual(await describeActivity(plainFence.model, bot, message("Plan a trip")), { status: "Planning the trip", emoji: "🎉🎉🎉🎉" });
});

test("an answer in another shape, or a model that fails, leaves no label and no reaction", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  assert.deepEqual(await describeActivity(answering("Sure, looking it up!").model, bot, message("Hi")), { status: "", emoji: null });
  assert.deepEqual(await describeActivity(answering("null").model, bot, message("Hi")), { status: "", emoji: null });
  assert.equal(warn.mock.callCount(), 0, "an answer in another shape isn't a failure");

  // As a provider's client throws it, with the request it sent (the person's message) and, here, a key.
  const refused = Object.assign(new Error("Invalid API key"), {
    statusCode: 401,
    requestBodyValues: { messages: [{ role: "user", content: "Book my flight to Rome" }] },
    apiKey: "sk-test-secret"
  });
  assert.deepEqual(await describeActivity(answering(refused).model, bot, message("Book my flight to Rome")), { status: "", emoji: null });
  // Retries used up: the status is the last attempt's.
  const unavailable = Object.assign(new Error("Failed after 3 attempts. Last error: Service Unavailable"), { lastError: { statusCode: 503 } });
  assert.deepEqual(await describeActivity(answering(unavailable).model, bot, message("Hi")), { status: "", emoji: null });
  assert.deepEqual(warn.mock.calls.map((call) => call.arguments), [
    ["Bot 8's status line has no label: its model call failed (status 401): Invalid API key"],
    ["Bot 8's status line has no label: its model call failed (status 503): Failed after 3 attempts. Last error: Service Unavailable"]
  ], "one line for each failure, with its message and status only");
});
