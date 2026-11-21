import assert from "node:assert/strict";
import test from "node:test";
import { contentOf } from "../../packages/bots/src/server/botAgent.js";
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

test("people are mentioned apart from bots: by their own ids, and only the people given", () => {
  const people = [{ id: "9", name: "Ben" }, { id: "12", name: "Carla" }];
  // Bot 9 and person 9 are different ids of different things: each marker names its own.
  const text = "<@bot:9> ask <@person:9> and <@person:12>, not <@person:40> or <@person:9> twice";
  const body = withMentions({ text }, members, people);
  assert.deepEqual(body.mentions, [{ id: "9", name: "Hazel" }]);
  assert.deepEqual(body.mentionedPeople, [{ id: "9", name: "Ben" }, { id: "12", name: "Carla" }]);
  assert.equal(plainMentions(text, members, people), "@Hazel ask @Ben and @Carla, not @someone or @Ben twice");
  assert.deepEqual(withMentions({ text: "<@person:12>" }, members, []), { text: "<@person:12>" }, "no one given, no one named");
  assert.equal(plainMentions("<@person:12>", members), "@someone", "a person marker never reads as a bot of the same id");
  assert.equal(plainMentions("<@person:9>", members), "@someone");
});

test("the model reads a person's mention as their name, never the marker", () => {
  const body = { text: "<@person:12> can you check?", mentionedPeople: [{ id: "12", name: "Carla" }] };
  assert.equal(contentOf({ body }), "@Carla can you check?");
  assert.equal(contentOf({ body: { text: "<@person:40> hi" } }), "@someone hi", "someone not kept on the message");
});
