import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test, { after } from "node:test";
import { ACCOUNT_OWNS } from "../../packages/account/src/server/AccountFeature.js";
import { createPush } from "../../packages/account/src/server/push.js";
import { createPushSweep } from "../../packages/bots/src/server/pushSweep.js";
import { memberOptions, startChatRecords } from "../support/botRecords.mjs";
import { seedChat } from "../support/chatFixtures.mjs";
import { ownedHandles } from "../support/ownedHandles.mjs";
import { queriesDuring } from "../support/queryCount.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";

// People's notifications on their devices (D-133) on the disposable test database: a person's devices and settings are
// their own and checked; only production sends, and a device the push service says is gone is forgotten; a chat's new
// message queues one notification per person it concerns, sent after 15 seconds only if still unread, folded with the
// person's others for that chat, as their settings allow; and the work stays a fixed number of queries however many
// people and notifications there are.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const knex = await connectTestDatabase();
after(() => knex.destroy());

const SECRET = "push-integration-test-only-secret";

/** People of their own (Anna, Ben and `extra` more) in a home of their own with a bot, cleaned up after the test. */
async function home(context, extra = 0) {
  const stamp = randomBytes(5).toString("hex");
  const names = ["Anna", "Ben", ...Array.from({ length: extra }, (_, index) => `P${index}`)];
  const users = (await knex("users").insert(names.map((name, index) => ({
    auth_provider: "test",
    auth_provider_user_sid: `push-${stamp}-${index}`,
    email: `push-${stamp}-${index}@example.com`,
    username: `push${stamp}${index}`,
    display_name: name
  }))).returning("id")).map((row) => String(row.id));
  const [row] = await knex("workspaces").insert({ slug: `push-${stamp}`, name: "Push", owner_user_id: users[0], is_personal: false }).returning("id");
  const homeId = String(row.id);
  await knex("workspace_memberships").insert(users.map((userId, index) => ({
    workspace_id: homeId,
    user_id: userId,
    role_sid: index ? "member" : "owner",
    status: "active"
  })));
  const [bot] = await knex("bots").insert({ workspace_id: homeId, made_by: users[0], name: "Chef", color: "#1E86FC" }).returning("id");
  context.after(async () => {
    await knex("push_queue").where({ workspace_id: homeId }).del();
    await knex("workspaces").where({ id: homeId }).del();
    await knex("push_devices").whereIn("user_id", users).del();
    await knex("push_settings").whereIn("user_id", users).del();
    await knex("users").whereIn("id", users).del();
  });
  return { homeId, slug: `push-${stamp}`, anna: users[0], ben: users[1], others: users.slice(2), botId: String(bot.id) };
}

/** The account's push on the test database, with its environment and a stand-in for web-push's sender. */
async function startPush(context, env = {}, sendNotification = async () => {}) {
  const { features } = await ownedHandles(knex, context, { "mercbot.account": ACCOUNT_OWNS });
  const { resources, systemContext } = features["mercbot.account"];
  return createPush({ resources, systemContext, env: { MERCBOT_PUSH_SECRET: SECRET, APP_ENV: "test", ...env }, sendNotification });
}

let endpoints = 0;
/** A browser's push subscription, as PushManager gives it. */
const subscription = (label = "Phone") => ({
  endpoint: `https://push.example.test/send/${randomBytes(6).toString("hex")}-${(endpoints += 1)}`,
  keys: { p256dh: `B${"x".repeat(86)}`, auth: "abcdefghijklmnop" },
  label
});

test("a person's notification settings and devices are their own, and what's wrong is refused", async (context) => {
  const { anna, ben } = await home(context);
  const push = await startPush(context);

  const fresh = await push.mine(anna);
  assert.equal(fresh.enabled, true);
  assert.match(fresh.publicKey, /^[\w-]{80,}$/u);
  assert.deepEqual(fresh.devices, []);
  assert.deepEqual(fresh.settings, { results: true, waiting: true, messages: true, showText: true, quietFrom: null, quietTo: null, timeZone: null });

  const saved = await push.saveSettings(anna, { messages: false, quietFrom: "22:00", quietTo: "07:00", timeZone: "Australia/Sydney" });
  assert.deepEqual(saved.settings, {
    results: true,
    waiting: true,
    messages: false,
    showText: true,
    quietFrom: "22:00",
    quietTo: "07:00",
    timeZone: "Australia/Sydney"
  });
  assert.equal((await push.saveSettings(anna, { showText: false, quietFrom: null })).settings.showText, false, "a second save changes it");
  assert.deepEqual((await push.mine(anna)).settings.quietFrom, null);
  assert.equal((await push.mine(ben)).settings.messages, true, "Ben's are his own");
  await assert.rejects(push.saveSettings(anna, { messages: "no" }), { statusCode: 400, code: "account_push_setting" });
  await assert.rejects(push.saveSettings(anna, { quietFrom: "25:00" }), { statusCode: 400, code: "account_push_quiet_hours" });
  await assert.rejects(push.saveSettings(anna, { timeZone: "Not/AZone" }), { statusCode: 400, code: "account_push_time_zone" });

  const phone = subscription("Pixel");
  const [device] = (await push.addDevice(anna, phone)).devices;
  assert.equal(device.label, "Pixel");
  await assert.rejects(push.addDevice(anna, { ...subscription(), endpoint: "http://push.example.test/x" }), { code: "account_push_endpoint" });
  await assert.rejects(push.addDevice(anna, { ...subscription(), endpoint: "not a url" }), { code: "account_push_endpoint" });
  await assert.rejects(push.addDevice(anna, { ...subscription(), keys: { p256dh: "short", auth: "abcdefghijklmnop" } }), { code: "account_push_keys" });

  // Ben can't remove Anna's device; the same device signed in as Ben becomes his.
  await assert.rejects(push.removeDevice(ben, device.id), { statusCode: 404, code: "account_push_device_missing" });
  await assert.rejects(push.removeDevice(ben, "not-an-id"), { statusCode: 404 });
  assert.equal((await push.addDevice(ben, phone)).devices.length, 1);
  assert.deepEqual((await push.mine(anna)).devices, [], "one device, one person: whoever is signed in there now");
  assert.deepEqual((await push.removeDevice(ben, device.id)).devices, []);

  // A person keeps their 20 newest devices.
  for (let index = 0; index < 22; index += 1) await push.addDevice(anna, subscription(`Device ${index}`));
  const kept = (await push.mine(anna)).devices.map((entry) => entry.label);
  assert.equal(kept.length, 20);
  assert.equal(kept[0], "Device 21");
  assert.ok(!kept.includes("Device 0") && !kept.includes("Device 1"), "the oldest go");

  // Without the server's secret, push is off.
  const off = await startPush(context, { MERCBOT_PUSH_SECRET: "" });
  assert.deepEqual([(await off.mine(anna)).enabled, (await off.mine(anna)).publicKey], [false, null]);
  await assert.rejects(off.addDevice(anna, subscription()), { statusCode: 409, code: "account_push_off" });
});

test("only production sends; a device the push service says is gone is forgotten, and one that keeps failing too", async (context) => {
  const { anna, ben } = await home(context);
  const note = (userId) => ({ userId, payload: { title: "Chef", body: "Dinner?", url: "/w/x?chat=1", tag: "chat-1", unread: 1 } });

  const calls = [];
  const logged = await startPush(context, { APP_ENV: "staging" }, async (...args) => calls.push(args));
  await logged.addDevice(anna, subscription());
  assert.equal(await logged.send([note(anna)]), 0, "staging logs it");
  assert.equal(calls.length, 0, "and sends nothing");

  const answers = new Map();
  const live = await startPush(context, { APP_ENV: "production", APP_PUBLIC_URL: "https://chat.example.test" }, async (target, payload, options) => {
    calls.push({ target, payload: JSON.parse(payload), options });
    const answer = answers.get(target.endpoint);
    if (answer) throw Object.assign(new Error("push service"), { statusCode: answer });
  });
  const [gone, flaky, fine] = [subscription("Gone"), subscription("Flaky"), subscription("Fine")];
  await live.addDevice(anna, gone);
  await live.addDevice(anna, flaky);
  await live.addDevice(ben, fine);
  answers.set(gone.endpoint, 410);
  answers.set(flaky.endpoint, 500);
  assert.equal(await live.send([note(anna), note(ben)]), 2, "Anna's first device and Ben's");
  const toFine = calls.find((call) => call.target.endpoint === fine.endpoint);
  assert.deepEqual(toFine.payload, note(ben).payload);
  assert.deepEqual([toFine.target.keys, toFine.options.TTL, toFine.options.topic], [fine.keys, 21600, "chat-1"]);
  assert.equal(toFine.options.vapidDetails.subject, "https://chat.example.test");
  const labels = async (userId) => (await live.mine(userId)).devices.map((device) => device.label).sort();
  assert.deepEqual(await labels(anna), ["Flaky", "Phone"], "the push service said Gone's device is gone");
  assert.equal(Number((await knex("push_devices").where({ endpoint: flaky.endpoint }).first()).failures), 1);
  assert.ok((await knex("push_devices").where({ endpoint: fine.endpoint }).first()).last_sent_at, "a send is remembered");
  for (let attempt = 1; attempt < 5; attempt += 1) await live.send([note(anna)]);
  assert.equal(await knex("push_devices").where({ endpoint: flaky.endpoint }).first(), undefined, "five failures in a row and it's forgotten");
});

/** The bots' records and the account's push on one database, with the sweep built over them. */
async function startSweep(context, homeSlug) {
  const { records, systemContext } = await startChatRecords(knex, context);
  const push = await startPush(context);
  const sent = [];
  const sweep = createPushSweep({
    records,
    workspaces: { findById: async () => ({ slug: homeSlug }) },
    push: { enabled: true, settingsOf: push.settingsOf, send: async (notes) => sent.push(...notes) },
    systemContext
  });
  const due = () => knex("push_queue").update({ send_after: knex.raw("now() - interval '1 second'") });
  return { records, push, sweep, sent, due };
}

test("a chat's new message notifies the people it concerns after 15 seconds, if they haven't read it, as they allow", async (context) => {
  const { homeId, slug, anna, ben, botId } = await home(context);
  const { records, push, sweep, sent, due } = await startSweep(context, slug);
  const asAnna = memberOptions({ userId: anna, homeId });
  const asBen = memberOptions({ userId: ben, homeId });
  const plans = await seedChat(knex, { homeId, kind: "private", title: "Plans", people: [anna, ben], bots: [botId] });
  const say = (text, mention = true) => records.messages.append(plans.id, [{
    role: "user",
    kind: "text",
    body: { text, ...(mention ? { mentionedPeople: [{ id: Number(ben), name: "Ben" }] } : {}) }
  }], asAnna);
  const queued = () => knex("push_queue").where({ workspace_id: homeId }).select("user_id", "kind", "message_id", "send_after");

  await say("Nobody in particular", false);
  assert.deepEqual(await queued(), [], "in a chat of several, a message for nobody notifies nobody");
  // Anna and Ben's direct chat: whatever Anna says notifies Ben.
  const pair = await seedChat(knex, { homeId, kind: "private", people: [anna, ben] });
  const [low, high] = [anna, ben].sort((a, b) => Number(a) - Number(b));
  await knex("conversations").where({ id: pair.id }).update({ direct_user_id: low, direct_person_id: high });
  await records.messages.append(pair.id, [{ role: "user", kind: "text", body: { text: "Lunch?" } }], asAnna);
  assert.deepEqual((await queued()).map((row) => [String(row.user_id), row.kind]), [[ben, "messages"]]);
  await knex("push_queue").where({ workspace_id: homeId }).del();
  await records.chats.markRead(pair.id, null, asBen);
  const [first] = await say("Oak or pine, @Ben?");
  const [waiting] = await queued();
  assert.deepEqual([String(waiting.user_id), waiting.kind, String(waiting.message_id)], [ben, "messages", first.id]);
  const delay = new Date(waiting.send_after).getTime() - Date.now();
  assert.ok(delay > 10_000 && delay <= 15_000, `it waits about 15 seconds (${delay} ms)`);
  const [second] = await say("Pine, @Ben?");
  assert.deepEqual((await queued()).map((row) => String(row.message_id)), [first.id, second.id], "queueing is one insert a message");

  assert.equal(await sweep.sweepOnce(), 0, "nothing goes before its time");
  assert.equal((await queued()).length, 2);
  // Ben's oldest is due: it goes with the newer one folded in, about the newest message.
  await knex("push_queue").where({ message_id: first.id }).update({ send_after: knex.raw("now() - interval '1 second'") });
  assert.equal(await sweep.sweepOnce(), 1);
  assert.deepEqual(sent.splice(0), [{
    userId: ben,
    payload: { title: "Anna in Plans", body: "Pine, @Ben?", url: `/w/${slug}?chat=${plans.id}`, tag: `chat-${plans.id}`, unread: 1 }
  }]);
  assert.deepEqual(await queued(), [], "sent once, the newer one with it");

  // Folded, a notification goes as its most pressing kind: a bot waiting for Ben, even with messages off.
  await push.saveSettings(ben, { messages: false });
  const [asked] = await say("Which wood, @Ben?");
  await knex("push_queue").where({ message_id: asked.id }).update({ kind: "waiting" });
  await say("Either, @Ben");
  await due();
  assert.equal(await sweep.sweepOnce(), 1);
  assert.equal(sent.splice(0)[0].payload.body, "Either, @Ben");
  await push.saveSettings(ben, { messages: true });

  // Read before its time: nothing goes.
  const [read] = await say("Read this, @Ben");
  await records.chats.markRead(plans.id, read.id, asBen);
  await due();
  assert.equal(await sweep.sweepOnce(), 0);
  await say("And this, @Ben");
  await records.chats.markRead(plans.id, null, asBen);
  await due();
  assert.equal(await sweep.sweepOnce(), 0, "read to the chat's end, with no read point, is read");
  assert.deepEqual(await queued(), [], "a notification that didn't go is gone all the same");

  // As Ben allows: messages off, or the text hidden; a muted chat never notifies.
  await push.saveSettings(ben, { messages: false });
  await say("Off, @Ben");
  await due();
  assert.equal(await sweep.sweepOnce(), 0);
  await push.saveSettings(ben, { messages: true, showText: false });
  await say("Secret, @Ben");
  await due();
  await sweep.sweepOnce();
  assert.equal(sent.splice(0)[0].payload.body, "New message", "the text stays off the lock screen");
  await records.chats.updatePlace(plans.id, { muted: true }, asBen);
  await say("Muted, @Ben");
  assert.deepEqual(await queued(), [], "a muted chat queues nothing");
});

test("queueing and sending stay a fixed number of queries however many people and notifications", async (context) => {
  const { homeId, slug, anna, ben, others, botId } = await home(context, 40);
  const { records, sweep, due } = await startSweep(context, slug);
  const asAnna = memberOptions({ userId: anna, homeId });
  const everyone = [ben, ...others];
  const small = await seedChat(knex, { homeId, kind: "private", title: "Small", people: [anna, ...everyone.slice(0, 5)], bots: [botId] });
  const large = await seedChat(knex, { homeId, kind: "private", title: "Large", people: [anna, ...everyone], bots: [botId] });
  const mentioning = (people) => [{ role: "user", kind: "text", body: { text: "Everyone", mentionedPeople: people.map((id) => ({ id: Number(id) })) } }];
  // A chat's first message marks its people unread, once: both chats have one before counting.
  for (const chat of [small, large]) await records.messages.append(chat.id, [{ role: "user", kind: "text", body: { text: "First" } }], asAnna);
  const posting = async (chat, people) => queriesDuring(knex, () => records.messages.append(chat.id, mentioning(people), asAnna));
  const [few, many] = [await posting(small, everyone.slice(0, 5)), await posting(large, everyone)];
  assert.equal(many, few, `posting to 41 people takes the queries posting to 5 does (${few})`);
  assert.equal(Number((await knex("push_queue").where({ workspace_id: homeId }).count("* as n").first()).n), 46);

  await due();
  const sending = await queriesDuring(knex, () => sweep.sweepOnce());
  await records.messages.append(small.id, mentioning(everyone.slice(0, 5)), asAnna);
  await due();
  const sendingFew = await queriesDuring(knex, () => sweep.sweepOnce());
  assert.equal(sending, sendingFew, `sending 46 takes the queries sending 5 does (${sendingFew})`);
});
