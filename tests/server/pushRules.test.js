import assert from "node:assert/strict";
import test from "node:test";
import { inQuietHours, pushKeysOf } from "../../packages/account/src/server/push.js";
import { noteText } from "../../packages/bots/src/server/pushSweep.js";
import { pushRecipients } from "../../packages/bots/src/server/records/pushQueueRepository.js";

// The rules of people's notifications (D-133) that need no database: the server's keys, quiet hours, who a chat's new
// messages notify and as what, and the words a notification shows.

test("the server's push keys come from its secret, the same every time, and there are none without one", () => {
  assert.equal(pushKeysOf(""), null);
  assert.equal(pushKeysOf(undefined), null);
  const keys = pushKeysOf("a-secret");
  assert.deepEqual(pushKeysOf("a-secret"), keys, "every server and every start has the same keys");
  assert.notEqual(pushKeysOf("another").publicKey, keys.publicKey);
  assert.equal(Buffer.from(keys.publicKey, "base64url").length, 65, "an uncompressed P-256 point, as browsers take it");
  assert.equal(Buffer.from(keys.privateKey, "base64url").length, 32);
});

test("quiet hours hold from their start to their end in the person's time zone, past midnight too", () => {
  const at = new Date("2026-11-24T21:30:00Z"); // 08:30 the next morning in Sydney (UTC+11)
  assert.equal(inQuietHours({ quietFrom: "22:00", quietTo: "07:00", timeZone: "UTC" }, at), false);
  assert.equal(inQuietHours({ quietFrom: "21:00", quietTo: "07:00", timeZone: "UTC" }, at), true, "past midnight");
  assert.equal(inQuietHours({ quietFrom: "08:00", quietTo: "09:00", timeZone: "Australia/Sydney" }, at), true);
  assert.equal(inQuietHours({ quietFrom: "08:00", quietTo: "08:30", timeZone: "Australia/Sydney" }, at), false, "the end is outside");
  assert.equal(inQuietHours({ quietFrom: "08:00", quietTo: "08:00", timeZone: "UTC" }, at), false, "the same start and end is none");
  assert.equal(inQuietHours({ quietFrom: null, quietTo: "07:00", timeZone: "UTC" }, at), false);
  assert.equal(inQuietHours({ quietFrom: "21:00", quietTo: "22:00", timeZone: "Not/AZone" }, at), true, "an unknown zone reads as UTC");
});

const people = (...ids) => ids.map((userId) => ({ userId, muted: false }));

test("in a chat of one person a new message notifies them, as a result, a wait or a message", () => {
  const ann = people("1");
  assert.deepEqual(pushRecipients([{ role: "bot", kind: "text" }], ann, { work: "chat", personId: "1" }), [{ userId: "1", kind: "messages" }]);
  assert.deepEqual(pushRecipients([{ role: "bot", kind: "text" }], ann, { work: "background", personId: "1" }), [{ userId: "1", kind: "results" }]);
  for (const kind of ["choice", "draft", "email", "connect", "approval"]) {
    assert.deepEqual(pushRecipients([{ role: "bot", kind }, { role: "bot", kind: "text" }], ann, { work: "background", personId: "1" }), [
      { userId: "1", kind: "waiting" }
    ], kind);
  }
  assert.deepEqual(pushRecipients([{ role: "system", kind: "text" }], ann, { work: "chat", personId: "1" }), [], "Mercbot's own lines notify nobody");
  assert.deepEqual(pushRecipients([{ role: "user", kind: "text", authorUserId: "1" }], ann, { work: "chat", personId: "1" }), [], "nor its author");
  assert.deepEqual(pushRecipients([{ role: "bot", kind: "text" }], [{ userId: "1", muted: true }], { work: "chat", personId: "1" }), [], "nor a muted chat");
});

test("in a chat of several people only those a message is for are notified: the mentioned, and the person a bot works for", () => {
  const room = people("1", "2", "3");
  assert.deepEqual(pushRecipients([{ role: "user", kind: "text", authorUserId: "1" }], room, { work: "chat", personId: "1" }), []);
  const mention = { role: "user", kind: "text", authorUserId: "1", body: { mentionedPeople: [{ id: 2 }, { id: 1 }] } };
  assert.deepEqual(pushRecipients([mention], room, { work: "chat", personId: "1" }), [{ userId: "2", kind: "messages" }]);
  assert.deepEqual(pushRecipients([{ role: "bot", kind: "text" }], room, { work: "background", personId: "3" }), [{ userId: "3", kind: "results" }]);
  assert.deepEqual(pushRecipients([{ role: "bot", kind: "text" }], room, { work: "chat", personId: null }), [], "a bot's post for nobody in particular");
  const pair = people("1", "2");
  assert.deepEqual(pushRecipients([{ role: "user", kind: "text", authorUserId: "1" }], pair, { work: "chat", personId: "1" }), [], "a room of two");
  assert.deepEqual(pushRecipients([{ role: "user", kind: "text", authorUserId: "1" }], pair, { work: "chat", personId: "1", direct: true }), [
    { userId: "2", kind: "messages" }
  ], "two people's direct chat notifies the other, whatever is said");
});

test("a notification's words are the message's, on one line and short", () => {
  assert.equal(noteText({ body: { text: "  Rain\n\ntomorrow  " } }), "Rain tomorrow");
  assert.equal(noteText({ body: { question: "Which one?" } }), "Which one?");
  assert.equal(noteText({ body: {} }), "");
  assert.equal(noteText({ body: null }), "");
  const long = noteText({ body: { text: "word ".repeat(100) } });
  assert.equal(long.length, 160);
  assert.ok(long.endsWith("…"));
});
