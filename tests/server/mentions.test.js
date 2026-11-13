import assert from "node:assert/strict";
import test from "node:test";
import { mentionMarkers, mentionsIn, plainMentions, withMentions } from "../../packages/bots/src/server/mentions.js";

// Group chat mentions: markers in storage, plain "@Name" for the model.
const members = [{ id: "9", name: "Hazel" }, { id: "10", name: "Maple" }, { id: "11", name: "Maple Tree" }];

test("the model's @names become markers, longest name first", () => {
  assert.equal(mentionMarkers("Good call @Maple Tree, and @Maple too.", members), "Good call <@bot:11>, and <@bot:10> too.");
  assert.equal(mentionMarkers("email@Hazelish.com", members), "email@Hazelish.com");
});

test("markers read back as names, and messages keep who they mention", () => {
  const text = "<@bot:9> and <@everyone>, see <@app:slack>";
  assert.deepEqual(mentionsIn(text), ["9"]);
  assert.equal(plainMentions(text, members), "@Hazel and @everyone, see @slack");
  assert.deepEqual(withMentions({ text }, members).mentions, [{ id: "9", name: "Hazel" }]);
});
