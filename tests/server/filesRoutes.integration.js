import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFileStore } from "../../packages/files/src/server/fileStore.js";
import { registerRoutes } from "../../packages/files/src/server/registerRoutes.js";
import { memberOptions, startChatRecords } from "../support/botRecords.mjs";
import { seedChat } from "../support/chatFixtures.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";

// The files routes (R6, D13) as a person's request reaches them, on the bots' records: a route's place is a chat the
// caller can open, with a bot in that chat, a bot of the home, or the home's own folder. A chat they can't open, a bot
// not in that chat, another home's chat or bot, and an id that isn't one are the same 404, so none says which it is.
// What a person does there is their own doing, so a private chat's wider folders take it.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const NOT_HERE = Object.freeze({ error: "That chat or bot isn't here.", code: "files_place_not_found" });

/** Two people of the test database, and how to make homes for them and bots there; `made` lists the homes made. */
async function homes(knex) {
  const [anna, ben] = (await knex("users").orderBy("id").limit(2).pluck("id")).map(String);
  assert.ok(ben, "the test database needs two users");
  const made = [];
  async function home(name, people) {
    const [row] = await knex("workspaces").insert({ slug: `${name}-${randomBytes(5).toString("hex")}`, name, owner_user_id: people[0], is_personal: false }).returning("id");
    const homeId = String(row.id);
    made.push(homeId);
    await knex("workspace_memberships").insert(people.map((id, index) => ({ workspace_id: homeId, user_id: id, role_sid: index ? "member" : "owner", status: "active" })));
    return homeId;
  }
  const bot = async (homeId, name) => String((await knex("bots").insert({ workspace_id: homeId, made_by: anna, name, color: "#1E86FC" }).returning("id"))[0].id);
  return { anna, ben, home, bot, made };
}

/** The files routes as FilesFeature registers them, on `records`, called as `userId` in home `homeId`. */
function filesRoutes({ store, records }) {
  const routes = new Map();
  const moved = [];
  const http = { router: { register: (method, url, _options, handler) => routes.set(`${method} ${url.replace("/api/w/:workspaceSlug/files", "")}`, handler) } };
  registerRoutes(http, { files: { store, apps: null, storage: null, pages: { pathChanged: async (change) => moved.push(change) } }, records, uploads: null });
  async function call(method, route, { homeId, userId, query = {}, body = undefined }) {
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
    const request = { params: { workspaceSlug: `home-${homeId}` }, query, body, workspace: { id: homeId }, user: { id: userId }, callOptions: async () => memberOptions({ userId, homeId }) };
    await routes.get(`${method} ${route}`)(request, reply);
    return { status: reply.statusCode, body: reply.body };
  }
  return { call, moved };
}

test("the files routes open a chat the caller can, a bot only in its chat, and nothing of another home", async (context) => {
  const knex = await connectTestDatabase();
  const { anna, ben, home, bot, made } = await homes(knex);
  context.after(async () => {
    await knex("workspaces").whereIn("id", made).del();
    await knex.destroy();
  });
  const { records } = await startChatRecords(knex, context);
  const volume = await fs.mkdtemp(path.join(os.tmpdir(), "mercbot-files-routes-"));
  context.after(() => fs.rm(volume, { recursive: true, force: true }));
  const store = createFileStore({ root: "", fallback: volume, ownStorage: async () => null, settle: async () => {}, explain: async () => {} });
  const { call, moved } = filesRoutes({ store, records });

  const homeId = await home("Rossi", [anna, ben]);
  const [tripbot, chef] = [await bot(homeId, "Tripbot"), await bot(homeId, "Chef")];
  const family = await seedChat(knex, { homeId, kind: "public", title: "Family", people: [anna, ben], bots: [tripbot, chef] });
  // Anna's private chat with Tripbot, which Ben can't open, and Chef isn't in.
  const plans = await seedChat(knex, { homeId, kind: "private", title: "Plans", people: [anna], bots: [tripbot] });
  // Another home, where Anna has her own chat with its bot.
  const awayId = await home("Away", [anna]);
  const awayBot = await bot(awayId, "Away");
  const away = await seedChat(knex, { homeId: awayId, kind: "public", people: [anna], bots: [awayBot] });
  const secret = await store.resolve(store.placeFor({ homeId, chatId: plans.id, chatKind: "private" }), "/files/chat/plan.txt");
  await fs.mkdir(path.dirname(secret), { recursive: true });
  await fs.writeFile(secret, "Rome in May");

  const folders = (userId, query) => call("GET", "/folders", { homeId, userId, query });
  // What each may open shows its own folders.
  const opened = await Promise.all([
    folders(anna, { chat: plans.id, bot: tripbot }), folders(anna, { chat: plans.id }), folders(ben, { chat: family.id, bot: chef }),
    folders(ben, { bot: tripbot }), folders(ben, {})
  ]);
  assert.deepEqual(opened.map((answer) => [answer.status, Object.keys(answer.body).sort()]), [
    [200, ["bot", "chat", "shared"]], [200, ["chat", "shared"]], [200, ["bot", "chat", "shared"]], [200, ["bot", "shared"]], [200, ["shared"]]
  ]);
  const content = await call("GET", "/content", { homeId, userId: anna, query: { chat: plans.id, path: "/files/chat/plan.txt" } });
  assert.deepEqual([content.status, String(content.body)], [200, "Rome in May"]);

  // Every other place is the same 404, whoever asks and whatever for.
  const refused = [
    [ben, { chat: plans.id }, "a private chat Ben isn't in"],
    [ben, { chat: plans.id, bot: tripbot }, "nor with its bot"],
    [anna, { chat: plans.id, bot: chef }, "a bot not in the chat"],
    [anna, { chat: away.id }, "another home's chat, though Anna is in it"],
    [anna, { chat: away.id, bot: awayBot }, "nor with its bot"],
    [anna, { bot: awayBot }, "another home's bot"],
    [anna, { chat: "x" }, "a chat id that isn't one"],
    [anna, { chat: plans.id, bot: "1e3" }, "a bot id that isn't one"]
  ];
  const answers = await Promise.all(refused.map(([userId, query]) => folders(userId, query)));
  const said = (answer) => ({ error: answer.body?.error, code: answer.body?.code });
  assert.deepEqual(answers.map((answer, index) => [refused[index][2], answer.status, said(answer)]), refused.map(([, , why]) => [why, 404, NOT_HERE]));
  // Nor does a file of the chat show, or move, for someone who can't open it.
  const peek = await call("GET", "/content", { homeId, userId: ben, query: { chat: plans.id, path: "/files/chat/plan.txt" } });
  assert.deepEqual([peek.status, said(peek)], [404, NOT_HERE]);
  const taken = await call("POST", "/move", { homeId, userId: ben, query: { chat: plans.id, bot: tripbot }, body: { from: "/files/chat/plan.txt", to: "/files/shared/plan.txt" } });
  assert.deepEqual([taken.status, said(taken)], [404, NOT_HERE]);
  assert.equal(await fs.readFile(secret, "utf8"), "Rome in May");

  // What Anna does in her private chat is her own doing: it takes the bot's and the home's folders (D13).
  const shared = await call("POST", "/move", { homeId, userId: anna, query: { chat: plans.id, bot: tripbot }, body: { from: "/files/chat/plan.txt", to: "/files/bot/Trips/plan.txt" } });
  assert.deepEqual([shared.status, shared.body], [200, { path: "/files/bot/Trips/plan.txt" }]);
  assert.deepEqual(moved, [{ homeId, botId: tripbot, from: "/files/chat/plan.txt", to: "/files/bot/Trips/plan.txt" }]);
  assert.equal((await call("POST", "/folder", { homeId, userId: anna, query: { chat: plans.id }, body: { path: "/files/shared/Trips" } })).status, 200);
  const listed = await call("GET", "/folders", { homeId, userId: ben, query: { chat: family.id, bot: tripbot } });
  assert.deepEqual([listed.body.bot, listed.body.shared], [["/files/bot/Trips"], ["/files/shared/Trips"]], "and everyone in the home sees it there");
});
