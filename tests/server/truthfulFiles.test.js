import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { withoutPaths } from "../../packages/bots/src/server/botAgent.js";
import { buildTools } from "../../packages/bots/src/server/botTools.js";
import { __testables } from "../../packages/bots/src/server/fileTools.js";
import { claimsFiles } from "../../packages/bots/src/server/replyChecks.js";
import { createFileStore } from "../../packages/files/src/server/fileStore.js";
import { turnDoubles } from "../support/botDoubles.mjs";

const { closestFiles } = __testables;

// Files are handed over as real cards, never claimed, never as internal paths (D-48).
test("internal paths are taken out of replies, keeping what's after the folder", () => {
  assert.equal(withoutPaths("Saved as /files/bot/Reports/plan.pdf and `/files/shared/menu.docx`."), "Saved as Reports/plan.pdf and `menu.docx`.");
  assert.equal(withoutPaths("Nothing to change here."), "Nothing to change here.");
});

// A chat's own folder (R6) is the one a bot saves in most.
test("a chat's own paths are taken out of replies too", {
  todo: "withoutPaths (packages/bots/src/server/botAgent.js) still names /files/mine, not /files/chat: the bots' owner's change"
}, () => {
  assert.equal(withoutPaths("Saved as /files/chat/Reports/plan.pdf."), "Saved as Reports/plan.pdf.");
});

test("a reply that says files are attached is spotted, one that says they aren't isn't", () => {
  for (const text of ["Here they are again: both attached as file cards below.", "I've attached them.", "Here are the files."]) assert.ok(claimsFiles(text), text);
  for (const text of ["I couldn't find report.pdf, so nothing is attached.", "The plan is ready.", "Want me to attach it?"]) assert.ok(!claimsFiles(text), text);
  // "The card below" is true when another kind of card shows there; "attached" still needs a file.
  assert.ok(claimsFiles("Preview it from the card below."));
  assert.ok(!claimsFiles("Preview it from the card below.", true));
  assert.ok(claimsFiles("I've attached them, and the draft is in the card below.", true));
});

test("the closest names to a missing file", () => {
  const paths = ["/files/chat/week-plan-page-2.pdf", "/files/chat/week-plan-page-3.pdf", "/files/chat/invoice.xlsx"];
  assert.deepEqual(closestFiles("/files/chat/week-plan-2.pdf", paths).slice(0, 2), ["/files/chat/week-plan-page-2.pdf", "/files/chat/week-plan-page-3.pdf"]);
  assert.deepEqual(closestFiles("/files/chat/zzz.pdf", paths), []);
});

test("send_files attaches existing files as cards, however old, and reports missing ones", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mb-send-"));
  const store = createFileStore({ root: "", fallback: dir, ownStorage: async () => null, settle: async () => {}, explain: async () => {} });
  // Read in a private chat, which reads every folder it has.
  const place = store.placeFor({ homeId: "1", chatId: "4", chatKind: "private", botId: "2" });
  await store.list(place);
  const old = await store.resolve(place, "/files/chat/week-plan-page-2.pdf");
  await writeFile(old, "%PDF-1.4 page two");
  await utimes(old, new Date(Date.now() - 86400000), new Date(Date.now() - 86400000));
  const files = { store, apps: { session: () => ({ close() {} }) } };
  const run = buildTools(turnDoubles({ approvals: { decide: async () => "allow" }, computer: null, files, place, homeId: "1", userId: "3", botId: "2", conversationId: "4" }));
  assert.deepEqual(await run.fileCards(), [], "an old file has no card by itself");
  const result = await run.tools.sendFiles.execute({ paths: ["/files/chat/week-plan-page-2.pdf", "/files/chat/week-plan-2-weekend.pdf"] });
  assert.deepEqual(result.attached, ["week-plan-page-2.pdf"]);
  assert.equal(result.notFound[0].path, "/files/chat/week-plan-2-weekend.pdf");
  assert.deepEqual(result.notFound[0].closest, ["/files/chat/week-plan-page-2.pdf"]);
  assert.deepEqual((await run.fileCards()).map((card) => card.name), ["week-plan-page-2.pdf"], "but gets one once sent");
});
