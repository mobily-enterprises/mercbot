import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createMediaGuard } from "../../packages/account/src/server/mediaCheck.js";
import { buildTools } from "../../packages/bots/src/server/botTools.js";
import { createFileStore } from "../../packages/files/src/server/fileStore.js";
import { createMediaChecks } from "../../packages/files/src/server/mediaChecks.js";
import { turnDoubles } from "../support/botDoubles.mjs";
import { PICTURE } from "../support/browser.mjs";

// A bot's pictures on a copy that checks them (D-90): what a picture is asked to show is checked before anything is
// drawn, and each picture made before it's kept or shown; a turn's saved files are queued for their check afterwards.
// Gemini is a stand-in here (globalThis.fetch).

const IMAGES = Object.freeze({ AI_IMAGES_PROVIDER: "gemini", AI_IMAGES_API_KEY: "test-key" });
// Bot 13's turn for person 12 in public chat 14 of home 11, its seat there 15.
const WHOSE = Object.freeze({ homeId: "11", userId: "12", botId: "13", chatId: "14", chatBotId: "15" });
const SEAT = Object.freeze({ id: "13", workspace_id: "11", user_id: "12", chat_id: "14", chat_bot_id: "15", chat: { id: "14", kind: "public" } });
// Whose a check says the picture is: the home, the person, the bot and its chat.
const CHECKED_AS = Object.freeze({ workspaceId: "11", userId: "12", botId: "13", conversationId: "14" });

/** A checker whose text and picture verdicts the test sets, and what it was asked. */
function copyChecker() {
  const copy = { text: { verdict: "allow" }, pictures: [], asked: [] };
  copy.checkText = async (item) => {
    copy.asked.push(item);
    if (copy.text instanceof Error) throw copy.text;
    return copy.text;
  };
  copy.check = async (item) => {
    copy.asked.push(item);
    const answer = copy.pictures.shift() ?? { verdict: "allow" };
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return copy;
}

async function turn(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mb-picture-checks-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = createFileStore({ root: "", fallback: dir, ownStorage: async () => null, settle: async () => {}, explain: async () => {} });
  const place = store.placeFor({ homeId: WHOSE.homeId, chatId: WHOSE.chatId, chatKind: "public", botId: WHOSE.botId });
  await store.prepare(place);
  const drawn = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    drawn.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: PICTURE.toString("base64") } }] } }] }), { status: 200 });
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  const copy = copyChecker();
  const queued = [];
  const media = { ...createMediaChecks({ guard: createMediaGuard(copy), mediaChecks: null, systemContext: null, store: null }), filesLater: async (saved) => queued.push({ ...saved, paths: [...saved.paths] }) };
  const posted = [];
  const pagesDouble = { standalone: async () => ({ name: "plan.html", html: "<html><body>Plan</body></html>" }) };
  const run = buildTools(turnDoubles({
    env: { ...process.env, ...IMAGES },
    approvals: { decide: async () => "allow" },
    computer: null,
    files: { store, media, pages: pagesDouble, apps: { session: () => ({ close() {} }) } },
    place,
    seat: SEAT,
    post: async (messages) => posted.push(...messages)
  }));
  const pictures = async () => (await readdir(path.join(dir, "homes", WHOSE.homeId, "chats", WHOSE.chatId), { recursive: true }))
    .filter((name) => name.endsWith(".png"));
  return { run, copy, drawn, posted, queued, pictures, place };
}

const ASK = Object.freeze({ acknowledgement: "I'll draw it now.", prompt: "A cake with balloons", title: "Cake", caption: "A cake" });

test("what a picture is asked to show is checked first: refused, nothing is drawn, posted or kept", async (t) => {
  const { run, copy, drawn, posted, pictures } = await turn(t);
  copy.text = { verdict: "block" };
  const blocked = await run.tools.makePicture.execute(ASK);
  assert.match(blocked.error, /^That picture can't be made from this description, so none was made\./u);
  assert.deepEqual(copy.asked, [{ text: "A cake with balloons", origin: "picture_prompt", ...CHECKED_AS }]);
  assert.deepEqual([drawn.length, posted.length, (await pictures()).length], [0, 0, 0]);
  assert.equal(run.madePicture(), true, "make_picture answered, so the reply isn't sent back to make one");

  copy.text = new Error("the checker is down");
  t.mock.method(console, "warn", () => {});
  assert.match((await run.tools.makePicture.execute(ASK)).error, /^Pictures can't be checked right now, so none was made\..*try again in a few minutes/u);
  copy.text = { verdict: "block", notice: "Pictures like that aren't made here." };
  assert.match((await run.tools.makePicture.execute(ASK)).error, /Say it in these words: "Pictures like that aren't made here\."$/u);
  assert.deepEqual([drawn.length, posted.length], [0, 0]);
});

test("each picture made is checked before it's kept or shown: one not allowed is neither", async (t) => {
  const { run, copy, drawn, pictures } = await turn(t);
  // Two variants, the first blocked: only the second is kept and shown.
  copy.pictures = [{ verdict: "block" }, { verdict: "allow" }];
  const one = await run.tools.makePicture.execute({ ...ASK, variants: 2 });
  assert.equal(drawn.length, 2);
  assert.equal(one.status, "shown");
  assert.equal(one.paths.length, 1);
  assert.match(one.paths[0], /-2\.png$/u, "the second picture");
  assert.match(one.note, /Only 1 of the 2 pictures is shown: The picture that was made can't be shown, so it wasn't kept\./u);
  assert.equal((await pictures()).length, 1);
  const checked = copy.asked.filter((item) => item.origin === "picture");
  assert.deepEqual(checked.map((item) => [item.mime, item.workspaceId, item.userId, item.botId, item.conversationId, item.path.startsWith("/files/chat/Pictures/cake-")]),
    [["image/png", "11", "12", "13", "14", true], ["image/png", "11", "12", "13", "14", true]]);
  assert.deepEqual(checked[0].bytes, PICTURE);
  await run.finish();
  assert.deepEqual(run.after.filter((message) => message.kind === "pictures").map((message) => message.body.images.map((image) => image.title)), [["Cake"]]);
});

test("a picture that's blocked, or can't be checked now, is neither kept nor shown, and the bot says why", async (t) => {
  const blockedTurn = await turn(t);
  blockedTurn.copy.pictures = [{ verdict: "block" }];
  const blocked = await blockedTurn.run.tools.makePicture.execute(ASK);
  assert.match(blocked.error, /^The picture that was made can't be shown, so it wasn't kept\./u);
  assert.equal((await blockedTurn.pictures()).length, 0);
  assert.equal(blockedTurn.run.madePicture(), true);
  await blockedTurn.run.finish();
  assert.deepEqual(blockedTurn.run.after.filter((message) => message.kind === "pictures"), []);

  const heldTurn = await turn(t);
  t.mock.method(console, "warn", () => {});
  heldTurn.copy.pictures = [new Error("the checker is down")];
  assert.match((await heldTurn.run.tools.makePicture.execute(ASK)).error, /^The picture can't be checked right now, so it wasn't kept or shown\..*try again in a few minutes/u);
  assert.equal((await heldTurn.pictures()).length, 0);
});

test("the files a turn saved are queued for their check when it closes; a turn that saved none queues nothing", async (t) => {
  const { run, queued, place } = await turn(t);
  await run.close();
  assert.deepEqual(queued, []);
  const kept = await run.tools.keepPageCopy.execute({ path: "/files/bot/Pages/plan.html" });
  assert.equal(kept.status, "saved", JSON.stringify(kept));
  await run.close();
  assert.deepEqual(queued, [{ place, paths: [kept.path], workspaceId: "11", userId: "12", chatBotId: "15" }]);
});
