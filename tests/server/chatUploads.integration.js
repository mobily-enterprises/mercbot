import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test, { after } from "node:test";
import { createFileStore } from "../../packages/files/src/server/fileStore.js";
import { registerRoutes } from "../../packages/files/src/server/registerRoutes.js";
import { memberOptions, startChatRecords } from "../support/botRecords.mjs";
import { seedChat } from "../support/chatFixtures.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";

// People's uploads in chats with other people (D-114, amending D-90 for chats): a file a person attaches in a chat goes
// in Uploads in the chat's own folder (/files/chat/Uploads), whoever else and whichever bots are in it, a chat of people
// alone included, and everyone who can open the chat finds it there. A copy that checks pictures and videos checks each
// one first, as the person's upload in that chat (D-90): one it blocks or can't check is refused and nothing is kept, and
// a file that isn't a picture or video isn't sent to it. Someone who can't open a private chat reaches its files by no
// files route: listing, folders, the viewer's preview, the file, its download, uploading, moving, a new folder, ticking
// a checklist or deleting, each the same 404 (the computer routes' 404 is chatComputers.integration.js's). Through the
// files routes as a person's request reaches them, on the bots' records, with a stand-in for the multipart reader and
// for the copy's checker.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const knex = await connectTestDatabase();
after(() => knex.destroy());

const NOT_HERE = Object.freeze({ status: 404, code: "files_place_not_found" });
// A picture's first bytes (a PNG's signature), and a text file's.
const PICTURE = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(600, 1)]);
const NOTE = Buffer.from("Bring the oak samples.\n- [ ] call the joiner\n");

/** A home with Anna (owner), Ben and Carla, and its bot Chef; `made` is removed after the test. */
async function rossiHome(context) {
  const [anna, ben, carla] = (await knex("users").orderBy("id").limit(3).pluck("id")).map(String);
  assert.ok(carla, "the test database needs three users");
  const [row] = await knex("workspaces").insert({ slug: `uploads-${randomBytes(5).toString("hex")}`, name: "Rossi", owner_user_id: anna, is_personal: false }).returning("id");
  const homeId = String(row.id);
  context.after(() => knex("workspaces").where({ id: homeId }).del());
  await knex("workspace_memberships").insert([anna, ben, carla].map((id, index) => ({ workspace_id: homeId, user_id: id, role_sid: index ? "member" : "owner", status: "active" })));
  const chef = String((await knex("bots").insert({ workspace_id: homeId, made_by: anna, name: "Chef", color: "#1E86FC" }).returning("id"))[0].id);
  return { homeId, anna, ben, carla, chef };
}

/**
 * The files routes as FilesFeature registers them, with a checker that answers `verdict` and keeps what it was asked
 * (`checked`), and a multipart reader that reads the request's `upload` ({ name, type, bytes }).
 */
async function filesRoutes(context) {
  const { records } = await startChatRecords(knex, context);
  const volume = await fs.mkdtemp(path.join(os.tmpdir(), "mercbot-chat-uploads-"));
  context.after(() => fs.rm(volume, { recursive: true, force: true }));
  const store = createFileStore({ root: "", fallback: volume, ownStorage: async () => null, settle: async () => {}, explain: async () => {} });
  const checked = [];
  const checker = { verdict: "allow" };
  const media = {
    on: true,
    check: async (item) => {
      checked.push(item);
      return { verdict: checker.verdict };
    }
  };
  const uploads = {
    readSingleMultipartFile: async (request) => {
      const stream = Readable.from([request.upload.bytes]);
      stream.truncated = false;
      return { fileName: request.upload.name, mimeType: request.upload.type, stream };
    }
  };
  const routes = new Map();
  const http = { router: { register: (method, url, _options, handler) => routes.set(`${method} ${url.replace("/api/w/:workspaceSlug/files", "")}`, handler) } };
  const pages = { pathChanged: async () => {} };
  const apps = { pagesOf: async () => ({ pages: [], more: false }) };
  registerRoutes(http, { files: { store, apps, storage: null, pages, media }, records, uploads });
  async function call(method, route, { homeId, userId, query = {}, body = undefined, upload = undefined }) {
    const reply = {
      statusCode: 200,
      body: undefined,
      code(status) {
        this.statusCode = status;
        return this;
      },
      send(sent) {
        this.body = sent;
        return this;
      },
      header() {
        return this;
      }
    };
    const request = { params: { workspaceSlug: `home-${homeId}` }, query, body, upload, workspace: { id: homeId }, user: { id: userId }, callOptions: async () => memberOptions({ userId, homeId }) };
    await routes.get(`${method} ${route}`)(request, reply);
    return { status: reply.statusCode, body: reply.body };
  }
  return { call, store, checked, checker, volume };
}

test("a person's upload in a chat with others goes in the chat's folder, through the picture check, for everyone there", async (context) => {
  const { call, store, checked, checker } = await filesRoutes(context);
  const { homeId, anna, ben, carla, chef } = await rossiHome(context);
  // People alone (Anna and Ben), and people with a bot (Anna, Ben and Chef).
  const talk = await seedChat(knex, { homeId, kind: "public", title: "Talk", people: [anna, ben] });
  const kitchen = await seedChat(knex, { homeId, kind: "private", title: "Kitchen", people: [anna, ben], bots: [chef] });

  const sent = await call("POST", "/upload", { homeId, userId: ben, query: { chat: talk.id }, upload: { name: "oak.png", type: "image/png", bytes: PICTURE } });
  assert.deepEqual([sent.status, sent.body.path], [200, "/files/chat/Uploads/oak.png"], "in the chat's own folder");
  assert.deepEqual(checked.map((item) => [item.origin, item.workspaceId, item.userId, item.botId, item.conversationId, item.path, item.place.chatId]),
    [["upload", homeId, ben, null, talk.id, "/files/chat/Uploads/oak.png", talk.id]], "checked first, as Ben's upload in that chat");
  const kept = await store.resolve(store.placeFor({ homeId, chatId: talk.id, chatKind: "public" }), "/files/chat/Uploads/oak.png");
  assert.deepEqual(await fs.readFile(kept), PICTURE);
  // Anna, in the chat, finds it there; so does Carla, who isn't in it but may open a Public chat.
  for (const person of [anna, carla]) {
    const listing = await call("GET", "", { homeId, userId: person, query: { chat: talk.id, folder: "/files/chat/Uploads" } });
    assert.equal(listing.status, 200);
    assert.deepEqual(listing.body.entries.map((entry) => entry.path), ["/files/chat/Uploads/oak.png"]);
  }

  // With a bot there too it's the chat's folder (the bot's own folder isn't the chat's), checked as the person's in it.
  const withChef = await call("POST", "/upload", { homeId, userId: anna, query: { chat: kitchen.id, bot: chef }, upload: { name: "plan.png", type: "image/png", bytes: PICTURE } });
  assert.deepEqual([withChef.status, withChef.body.path], [200, "/files/chat/Uploads/plan.png"]);
  assert.deepEqual([checked.at(-1).userId, checked.at(-1).botId, checked.at(-1).conversationId], [anna, chef, kitchen.id]);
  const name = await call("POST", "/upload", { homeId, userId: ben, query: { chat: kitchen.id }, upload: { name: "plan.png", type: "image/png", bytes: PICTURE } });
  assert.equal(name.body.path, "/files/chat/Uploads/plan (2).png", "a name already there gets a number");

  // A file that isn't a picture or video isn't sent to the checker.
  const before = checked.length;
  const note = await call("POST", "/upload", { homeId, userId: ben, query: { chat: talk.id }, upload: { name: "note.md", type: "text/markdown", bytes: NOTE } });
  assert.deepEqual([note.status, note.body.path, checked.length], [200, "/files/chat/Uploads/note.md", before]);

  // One the checker blocks, or can't check now, is refused, and nothing of it is kept.
  for (const [verdict, refusal] of [["block", { status: 422, code: "media_blocked" }], ["unavailable", { status: 503, code: "media_check_unavailable" }]]) {
    checker.verdict = verdict;
    const refused = await call("POST", "/upload", { homeId, userId: ben, query: { chat: talk.id }, upload: { name: `${verdict}.png`, type: "image/png", bytes: PICTURE } });
    assert.deepEqual({ status: refused.status, code: refused.body?.code }, refusal, verdict);
  }
  const listing = await call("GET", "", { homeId, userId: anna, query: { chat: talk.id, folder: "/files/chat/Uploads" } });
  assert.deepEqual(listing.body.entries.map((entry) => entry.path).sort(), ["/files/chat/Uploads/note.md", "/files/chat/Uploads/oak.png"]);
});

test("someone who can't open a private chat reaches its files by no route", async (context) => {
  const { call, store, checked } = await filesRoutes(context);
  const { homeId, anna, ben, carla, chef } = await rossiHome(context);
  const kitchen = await seedChat(knex, { homeId, kind: "private", title: "Kitchen", people: [anna, ben], bots: [chef] });
  const sent = await call("POST", "/upload", { homeId, userId: ben, query: { chat: kitchen.id }, upload: { name: "list.md", type: "text/markdown", bytes: NOTE } });
  assert.equal(sent.body.path, "/files/chat/Uploads/list.md");
  const file = await store.resolve(store.placeFor({ homeId, chatId: kitchen.id, chatKind: "private" }), "/files/chat/Uploads/list.md");

  const picked = "/files/chat/Uploads/list.md";
  const routes = [
    ["GET", "", { folder: "/files/chat/Uploads" }, undefined, "the listing"],
    ["GET", "/folders", {}, undefined, "the folders"],
    ["GET", "/preview", { path: picked }, undefined, "the viewer's preview"],
    ["GET", "/content", { path: picked }, undefined, "the file"],
    ["GET", "/content", { path: picked, download: "1" }, undefined, "its download"],
    ["POST", "/upload", {}, undefined, "an upload into it"],
    ["POST", "/move", {}, { from: picked, to: "/files/shared/list.md" }, "moving it out"],
    ["POST", "/folder", {}, { path: "/files/chat/Mine" }, "a new folder"],
    ["POST", "/check", {}, { path: picked, line: 1, checked: true }, "ticking its checklist"],
    ["DELETE", "", { path: picked }, undefined, "deleting it"]
  ];
  for (const query of [{ chat: kitchen.id }, { chat: kitchen.id, bot: chef }]) {
    for (const [method, route, extra, body, what] of routes) {
      const upload = route === "/upload" ? { name: "in.png", type: "image/png", bytes: PICTURE } : undefined;
      const answer = await call(method, route, { homeId, userId: carla, query: { ...query, ...extra }, body, upload });
      assert.deepEqual({ status: answer.status, code: answer.body?.code }, NOT_HERE, `${what}, ${query.bot ? "with its bot" : "the chat's"}`);
    }
  }
  assert.equal(await fs.readFile(file, "utf8"), NOTE.toString(), "the file is as it was");
  assert.equal(checked.length, 0, "nothing of Carla's was checked, so nothing was read");
  const own = await call("GET", "/content", { homeId, userId: anna, query: { chat: kitchen.id, path: picked } });
  assert.deepEqual([own.status, String(own.body)], [200, NOTE.toString()], "while Anna, who's in it, opens it");
});
