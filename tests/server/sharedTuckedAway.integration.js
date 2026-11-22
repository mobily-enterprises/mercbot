import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test, { after } from "node:test";
import { createChatMembers } from "../../packages/bots/src/server/chatMembers.js";
import { registerRoutes } from "../../packages/bots/src/server/registerRoutes.js";
import { memberOptions, startChatRecords } from "../support/botRecords.mjs";
import { queriesDuring } from "../support/queryCount.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";

// A card's "Show hidden and archived" (GET …/chats/shared): the caller's own hidden or archived chats that one bot or
// one person is in too, narrowed in the query, newest chat first, 20 a page, each page read in the same statements
// however many such chats there are; a bot of another home and a person not in the home are 404, and naming neither or
// both is 400.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const knex = await connectTestDatabase();
after(() => knex.destroy());

/** A home with Anna (owner) and Ben, Carla not in it, the bots Chef and Shopper; and another home with its own bot. */
async function home(context) {
  const [anna, ben, carla] = (await knex("users").orderBy("id").limit(3).pluck("id")).map(String);
  assert.ok(carla, "the test database needs three users");
  const homeOf = async (owner, name) => {
    const [row] = await knex("workspaces").insert({ slug: `shared-${randomBytes(5).toString("hex")}`, name, owner_user_id: owner, is_personal: false }).returning("id");
    context.after(() => knex("workspaces").where({ id: row.id }).del());
    return String(row.id);
  };
  const homeId = await homeOf(anna, "Rossi");
  const elsewhere = await homeOf(carla, "Bianchi");
  await knex("workspace_memberships").insert([
    { workspace_id: homeId, user_id: anna, role_sid: "owner", status: "active" },
    { workspace_id: homeId, user_id: ben, role_sid: "member", status: "active" },
    { workspace_id: elsewhere, user_id: carla, role_sid: "owner", status: "active" }
  ]);
  const bot = async (workspaceId, name) => String((await knex("bots").insert({ workspace_id: workspaceId, made_by: anna, name, color: "#1E86FC" }).returning("id"))[0].id);
  return { homeId, anna, ben, carla, chef: await bot(homeId, "Chef"), shopper: await bot(homeId, "Shopper"), stranger: await bot(elsewhere, "Stranger") };
}

/**
 * Chats written straight to the tables, in order: each `{ title, kind?, archived?, people: [[userId, hidden?]], bots }`.
 * One many-row write per table, however many.
 */
async function seed(homeId, madeBy, chats) {
  const ids = (await knex("conversations").insert(chats.map((chat) => ({
    workspace_id: homeId,
    kind: chat.kind ?? "public",
    title: chat.title,
    made_by: madeBy,
    ...(chat.archived ? { archived_at: new Date() } : {})
  }))).returning("id")).map((row) => String(row.id));
  const places = chats.flatMap((chat, index) => chat.people.map(([userId, hidden = false]) => ({ workspace_id: homeId, conversation_id: ids[index], user_id: userId, hidden })));
  const seats = chats.flatMap((chat, index) => chat.bots.map((botId, position) => ({ workspace_id: homeId, conversation_id: ids[index], bot_id: botId, position })));
  if (places.length) await knex("chat_people").insert(places);
  if (seats.length) await knex("chat_bots").insert(seats);
  return ids;
}

function chatService({ records, systemContext }) {
  return createChatMembers({
    records,
    systemContext,
    notices: { publishEach: async () => {} },
    computer: { chatRemoved: async () => {} },
    pauseWork: async () => {},
    forget: async () => {}
  });
}

/** GET …/chats/shared as a request in the home with `options`, through the bots' routes: its status and body. */
function sharedRoute(chats, records, options) {
  const routes = new Map();
  registerRoutes({ router: { register: (method, path, _options, handler) => routes.set(`${method} ${path}`, handler) } }, {
    bots: { chats },
    approvals: {},
    notices: {},
    meter: { track: (_who, work) => work(), pausedMessage: async () => null },
    records,
    streams: new Set()
  });
  const handler = routes.get("GET /api/w/:workspaceSlug/chats/shared");
  assert.ok(handler, "GET …/chats/shared is a route");
  return async (query) => {
    const answer = {};
    const reply = {
      code(status) {
        answer.status = status;
        return reply;
      },
      send(sent) {
        answer.body = sent;
        return reply;
      }
    };
    await handler({ method: "GET", params: {}, query, user: {}, workspace: {}, callOptions: async () => options }, reply);
    return answer;
  };
}

test("only the caller's own hidden or archived chats that the bot or person is in, newest first", async (context) => {
  const parts = await startChatRecords(knex, context);
  const { homeId, anna, ben, chef, shopper } = await home(context);
  const chats = chatService(parts);
  const asAnna = memberOptions({ userId: anna, homeId, role: "owner" });
  const asBen = memberOptions({ userId: ben, homeId });
  const [archivedRoom, hiddenByAnna, inUse, hiddenByBen, notAnnas, shopperOnly, bensSecret] = await seed(homeId, anna, [
    { title: "Archived room", archived: true, people: [[anna], [ben]], bots: [chef] },
    { title: "Hidden by Anna", kind: "private", people: [[anna, true], [ben]], bots: [chef] },
    { title: "In use", people: [[anna], [ben]], bots: [chef] },
    { title: "Hidden by Ben", people: [[anna], [ben, true]], bots: [chef] },
    { title: "Archived, Anna not in it", archived: true, people: [[ben]], bots: [chef] },
    { title: "Archived with Shopper", archived: true, people: [[anna]], bots: [shopper] },
    { title: "Ben's hidden private", kind: "private", people: [[ben, true]], bots: [chef] }
  ]);
  const ids = (page) => page.chats.map((chat) => chat.id);

  const withChef = await chats.sharedTuckedAway({ withBot: chef }, asAnna);
  assert.deepEqual(ids(withChef), [hiddenByAnna, archivedRoom], "hers, hidden or archived, with Chef: not one in use, hidden by Ben, she isn't in, or without Chef");
  assert.equal(withChef.next, null);
  const [hidden, archived] = withChef.chats;
  assert.equal(hidden.place.hidden, true, "each a chat view with her place");
  assert.equal(archived.archivedAt !== null, true);
  assert.deepEqual(archived.bots.map((bot) => bot.botId), [chef]);
  assert.deepEqual(archived.people.map((person) => person.userId).sort(), [anna, ben].sort());

  assert.deepEqual(ids(await chats.sharedTuckedAway({ withPerson: ben }, asAnna)), [hiddenByAnna, archivedRoom], "with Ben the same");
  assert.deepEqual(ids(await chats.sharedTuckedAway({ withBot: shopper }, asAnna)), [shopperOnly]);
  assert.deepEqual(
    ids(await chats.sharedTuckedAway({ withBot: chef }, asBen)),
    [bensSecret, notAnnas, hiddenByBen, archivedRoom],
    "Ben's own: what he hid, and the archived ones he's in, never what Anna hid"
  );
  assert.ok(!ids(await chats.sharedTuckedAway({ withBot: chef }, asAnna)).includes(inUse));
});

test("names one bot or person of the home, else 400 or 404, through the route", async (context) => {
  const parts = await startChatRecords(knex, context);
  const { homeId, anna, ben, carla, chef, stranger } = await home(context);
  const [archivedRoom] = await seed(homeId, anna, [{ title: "Archived room", archived: true, people: [[anna], [ben]], bots: [chef] }]);
  const asked = sharedRoute(chatService(parts), parts.records, memberOptions({ userId: anna, homeId, role: "owner" }));

  const found = await asked({ withBot: chef });
  assert.equal(found.status, 200);
  assert.deepEqual(found.body.chats.map((chat) => chat.id), [archivedRoom]);
  assert.equal((await asked({ withPerson: ben })).body.chats[0].id, archivedRoom);
  for (const query of [{}, { withBot: chef, withPerson: ben }]) {
    const refused = await asked(query);
    assert.equal(refused.status, 400, JSON.stringify(query));
    assert.equal(refused.body.code, "bots_shared_needs_one");
  }
  const otherHomes = await asked({ withBot: stranger });
  assert.equal(otherHomes.status, 404, "another home's bot");
  assert.equal(otherHomes.body.code, "bots_bot_not_found");
  assert.equal((await asked({ withBot: "nope" })).status, 404);
  const notHere = await asked({ withPerson: carla });
  assert.equal(notHere.status, 404, "someone not in the home");
  assert.equal(notHere.body.code, "bots_person_not_found");
});

test("is read 20 a page, every chat once, each page in the same statements at 5 and at 500", async (context) => {
  const parts = await startChatRecords(knex, context);
  const { homeId, anna, ben, chef } = await home(context);
  const chats = chatService(parts);
  const asAnna = memberOptions({ userId: anna, homeId, role: "owner" });
  /** `count` archived chats Anna, Ben and Chef share, and as many in use, which no page holds. */
  const more = async (count) => seed(homeId, anna, Array.from({ length: count * 2 }, (_, index) => ({
    title: `Chat ${index}`,
    archived: index % 2 === 0,
    people: [[anna], [ben]],
    bots: [chef]
  }))).then((ids) => ids.filter((_, index) => index % 2 === 0));
  /** Every page, and the statements of each. */
  const everyPage = async () => {
    const ids = [];
    const statements = [];
    let afterId = null;
    do {
      let page;
      statements.push(await queriesDuring(knex, async () => { page = await chats.sharedTuckedAway({ withBot: chef, after: afterId }, asAnna); }));
      assert.ok(page.chats.length <= 20, "20 a page at most");
      ids.push(...page.chats.map((chat) => chat.id));
      afterId = page.next;
    } while (afterId);
    return { ids, statements };
  };

  const firstFive = await more(5);
  const few = await everyPage();
  assert.deepEqual(few.ids, [...firstFive].reverse(), "newest chat first");
  assert.equal(few.statements.length, 1, "one page");

  const all = [...firstFive, ...(await more(495))];
  const many = await everyPage();
  assert.equal(many.ids.length, 500, "no chat left out");
  assert.deepEqual(many.ids, [...all].reverse(), "none twice, newest first, in an order that holds while paging");
  assert.equal(many.statements.length, 25);
  assert.deepEqual(many.statements, Array(25).fill(few.statements[0]), "each page read alike, as the page of 5");
  const { chats: [newest], next } = await chats.sharedTuckedAway({ withBot: chef }, asAnna);
  assert.equal(newest.id, all.at(-1));
  assert.equal(next, all.at(-20), "next is the page's last chat");
});
