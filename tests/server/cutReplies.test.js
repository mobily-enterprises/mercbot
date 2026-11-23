import assert from "node:assert/strict";
import test from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import { generateReply, instructionsFor } from "../../packages/bots/src/server/botAgent.js";

// A reply the provider stops part-way (its length limit, or an answer that broke off) is marked `cut`, so the turn
// writes it again (botReplies.js, CUT_CHECK); one that ended isn't. And a bot asked about a chat it can't read here
// says it stays private, never that it doesn't exist.
const answering = (text, unified) => new MockLanguageModelV4({
  doGenerate: async () => ({
    content: [{ type: "text", text }],
    finishReason: { unified, raw: unified },
    usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
    warnings: []
  })
});
const BOT = { id: "7", name: "Guide" };
const ASKED = [{ id: "1", kind: "text", role: "user", authorUserId: "1", body: { text: "Summarise our private chat", authorName: "Pat" } }];
const replyOn = (model) => generateReply(BOT, ASKED, {}, "", "", { languageModel: model, reasoning: {} });

test("a reply the provider stopped part-way is cut; one that ended isn't", async () => {
  for (const reason of ["length", "error", "other", "unknown"]) {
    const out = await replyOn(answering("What I do have on record is the state of the por", reason));
    assert.equal(out.cut, true, reason);
    assert.equal(out.text, "What I do have on record is the state of the por");
  }
  for (const reason of ["stop", "content-filter"]) {
    assert.equal((await replyOn(answering("All done.", reason))).cut, undefined, reason);
  }
});

test("a bot asked about a chat it can't read here says it stays private and offers to summarise it there", () => {
  assert.match(instructionsFor(BOT), /never say it doesn't exist[^.]*: say it stays private to the people in it[^.]*offer to summarise it there/u);
});
