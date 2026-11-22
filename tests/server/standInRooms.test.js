import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { instructionsFor } from "../../packages/bots/src/server/botAgent.js";
import { startStandInModel } from "../../tools/standInModel.mjs";

// The stand-in model plays a bot asked for a database or a spreadsheet (D-122), so the flow can be tried in a Preview:
// a bot that isn't the Builder proposes a private room with the Builder (start_room), and says so once the card is up;
// with no Builder it says so; a request that names a spreadsheet starts one, with no room. Through its HTTP API, as the
// app calls it.

let standIn;
before(async () => {
  standIn = await startStandInModel();
});
after(() => standIn?.stop());

const TOOLS = ["start_room", "app_help", "use_app", "read_skill"].map((name) => ({ type: "function", function: { name, parameters: { type: "object" } } }));
const SYSTEM = instructionsFor({ id: "7", name: "Whiskers", isBuilder: false, additions: "", template: { tag: "Cats", instructions: "Use a spreadsheet for any list.", skills: [] } });
const state = (builderLine) => ({ role: "user", content: `Current state, from the system. It is the truth; earlier messages may be out of date:\n- Their time zone: Europe/London.\n${builderLine}` });

/** One step of the stand-in's reply to the person's words, with what came after them; its message. */
async function step(words, builderLine, after = []) {
  const response = await fetch(`${standIn.url}/premium/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "stand-in", tools: TOOLS, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: words }, ...after, state(builderLine)] })
  });
  assert.equal(response.status, 200);
  return (await response.json()).choices[0].message;
}
const called = (message) => message.tool_calls?.map((toolCall) => [toolCall.function.name, JSON.parse(toolCall.function.arguments)]) ?? [];

test("asked for a database, a bot that isn't the Builder proposes a private room with the Builder, then says the card is waiting", async () => {
  const first = await step("Make a database of my cats.", "- This home's Builder: Mercbot.");
  const [[tool, args]] = called(first);
  assert.equal(tool, "start_room");
  assert.deepEqual([args.title, args.kind, args.bots], ["Cats database", "private", ["Mercbot"]]);
  assert.match(args.brief, /^Mercbot, please build a database of cats/u);
  const asked = [{ role: "assistant", content: "", tool_calls: first.tool_calls }, { role: "tool", tool_call_id: first.tool_calls[0].id, content: "{\"status\":\"waiting_for_approval\"}" }];
  const then = await step("Make a database of my cats.", "- This home's Builder: Mercbot.", asked);
  assert.deepEqual(called(then), []);
  assert.match(then.content, /Mercbot, this home's Builder, makes databases and apps\. .*waiting for your OK on the card below/u);
});

test("with no Builder, the bot says so and where one is chosen; the Builder itself would build it", async () => {
  const none = await step("Make a database of my cats.", "- This home has no Builder set: the home's owners and admins choose one in Settings, under Main bot and Builder.");
  assert.deepEqual(called(none), []);
  assert.match(none.content, /no Builder yet.*Settings, under Main bot and Builder/u);
  const builder = await step("Make a database of my cats.", "- You are this home's Builder.");
  assert.deepEqual(called(builder), []);
  assert.match(builder.content, /I'm this home's Builder/u);
});

test("a request that names a spreadsheet gets a spreadsheet, and no room", async () => {
  const first = await step("Put my cats in a spreadsheet.", "- This home's Builder: Mercbot.");
  assert.deepEqual(called(first), [["app_help", { app: "sheet" }]]);
  const helped = [{ role: "assistant", content: "", tool_calls: first.tool_calls }, { role: "tool", tool_call_id: first.tool_calls[0].id, content: "{\"help\":\"\"}" }];
  const then = await step("Put my cats in a spreadsheet.", "- This home's Builder: Mercbot.", helped);
  assert.deepEqual(called(then), []);
  assert.match(then.content, /spreadsheet, as you asked/u);
});
