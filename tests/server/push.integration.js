import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test, { after } from "node:test";
import { ACCOUNT_OWNS } from "../../packages/account/src/server/AccountFeature.js";
import { createPush } from "../../packages/account/src/server/push.js";
import { createPushSweep } from "../../packages/bots/src/server/pushSweep.js";
import { memberOptions, startChatRecords } from "../support/botRecords.mjs";
import { seedChat, seedMessages } from "../support/chatFixtures.mjs";
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
  endpoint: `https://fcm.googleapis.com/fcm/send/${randomBytes(6).toString("hex")}-${(endpoints += 1)}`,
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
  await assert.rejects(push.addDevice(anna, { ...subscription(), endpoint: "http://fcm.googleapis.com/fcm/send/x" }), { code: "account_push_endpoint" });
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

test("forgetting this browser's device takes its push address alone, the same statements however many devices, and never another person's", async (context) => {
  const { anna, ben } = await home(context);
  const push = await startPush(context);
  const annas = subscription("This browser");
  const bens = subscription("Ben's laptop");
  await push.addDevice(anna, annas);
  await push.addDevice(ben, bens);

  // Ben's device at Anna's sign-out: not hers, so nothing is forgotten.
  assert.deepEqual(await push.forgetDevice(anna, bens.endpoint), { forgotten: false });
  assert.equal((await push.mine(ben)).devices.length, 1, "Ben's device stays");
  assert.deepEqual(await push.forgetDevice(anna, annas.endpoint), { forgotten: true });
  assert.deepEqual((await push.mine(anna)).devices, []);
  for (const endpoint of [undefined, 42, "", "x".repeat(2001)]) {
    await assert.rejects(push.forgetDevice(anna, endpoint), { statusCode: 400, code: "account_push_endpoint" }, String(endpoint));
  }

  // As many statements (the owner's locked delete) for a person with one device as with more than the 20 they keep.
  const counts = [];
  for (const size of [1, 200]) {
    const endpoints = Array.from({ length: size }, () => subscription().endpoint);
    await knex("push_devices").insert(endpoints.map((endpoint) => ({ user_id: anna, endpoint, p256dh: `B${"x".repeat(86)}`, auth: "abcdefghijklmnop", failures: 0 })));
    counts.push(await queriesDuring(knex, () => push.forgetDevice(anna, endpoints[size - 1])));
  }
  assert.equal(counts[1], counts[0], `the same statements at 1 device and at 200 (${counts.join(", ")})`);
});

test("a device's push address is a known push service's, a non-object body is refused, and a label is one line", async (context) => {
  const { anna, ben } = await home(context);
  const push = await startPush(context);
  const keys = { p256dh: `B${"x".repeat(86)}`, auth: "abcdefghijklmnop" };
  // The server POSTs to a device's address when it sends: never to one inside its own network, or anyone else's.
  for (const endpoint of [
    "https://127.0.0.1:3001/api/health",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/x",
    "https://db.internal/x",
    "https://fcm.googleapis.com.evil.example/fcm/send/x",
    "https://fcm.googleapis.com:8443/fcm/send/x",
    "https://user:secret@fcm.googleapis.com/fcm/send/x"
  ]) {
    await assert.rejects(push.addDevice(anna, { endpoint, keys }), { statusCode: 400, code: "account_push_endpoint" }, endpoint);
  }
  for (const endpoint of [
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/abc",
    "https://wns2-par02p.notify.windows.com/w/?token=abc"
  ]) {
    await push.addDevice(anna, { endpoint, keys });
  }
  assert.equal((await push.mine(anna)).devices.length, 4, "Chrome's, Firefox's, Safari's and Edge's push services are taken");

  // Someone else's device can't be taken by its address alone: only the same browser (the same keys) moves to them.
  const annas = "https://fcm.googleapis.com/fcm/send/annas-phone";
  await push.addDevice(anna, { endpoint: annas, keys });
  await assert.rejects(push.addDevice(ben, { endpoint: annas, keys: { p256dh: `C${"y".repeat(86)}`, auth: "zzzzzzzzzzzzzzzz" } }), {
    statusCode: 409,
    code: "account_push_device_taken"
  });
  assert.ok((await push.mine(anna)).devices.some((device) => device.endpoint === annas), "Anna keeps her phone");
  await push.addDevice(ben, { endpoint: annas, keys });
  assert.ok((await push.mine(ben)).devices.some((device) => device.endpoint === annas), "signed in as Ben on that browser, it's his");

  for (const body of ["hello", 42, ["results"], true]) {
    await assert.rejects(push.saveSettings(anna, body), { statusCode: 400, code: "account_push_setting" }, JSON.stringify(body));
    await assert.rejects(push.addDevice(anna, body), { statusCode: 400 }, JSON.stringify(body));
  }
  const labelled = await push.addDevice(anna, { endpoint: "https://fcm.googleapis.com/fcm/send/labelled", keys, label: "Phone\nAPP_ENV=production\u0007" });
  assert.equal(labelled.devices.find((device) => device.endpoint.endsWith("/labelled")).label, "Phone APP_ENV=production");
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
  // A device kept before addresses were checked, inside the server's own network: never called, and forgotten.
  await knex("push_devices").insert({ user_id: anna, endpoint: "https://127.0.0.1:3001/api/health", p256dh: `B${"x".repeat(86)}`, auth: "abcdefghijklmnop" });
  calls.length = 0;
  await live.send([note(anna)]);
  assert.deepEqual(calls.filter((call) => call.target.endpoint.includes("127.0.0.1")), [], "no request inside the network");
  assert.equal(await knex("push_devices").where({ endpoint: "https://127.0.0.1:3001/api/health" }).first(), undefined, "and the device is forgotten");
  for (let attempt = 1; attempt < 4; attempt += 1) await live.send([note(anna)]);
  assert.equal(await knex("push_devices").where({ endpoint: flaky.endpoint }).first(), undefined, "five failures in a row and it's forgotten");
});

/** The bots' records and the account's push on one database, with the sweep built over them. */
async function startSweep(context, homeSlug, slugs = new Map()) {
  const { records, systemContext } = await startChatRecords(knex, context);
  const push = await startPush(context);
  const sent = [];
  const homeReads = [];
  const sweep = createPushSweep({
    records,
    // JSKIT's homes repository, as the sweep uses it: every home's address is `homeSlug`'s, or its own when it has one.
    workspaces: {
      findById: async (id) => {
        homeReads.push([id]);
        return { id: String(id), slug: slugs.get(String(id)) || homeSlug };
      },
      listByIds: async (ids) => {
        homeReads.push(ids);
        return ids.map((id) => ({ id: String(id), slug: slugs.get(String(id)) || homeSlug }));
      }
    },
    push: { enabled: true, settingsOf: push.settingsOf, send: async (notes) => sent.push(...notes) },
    systemContext
  });
  const due = () => knex("push_queue").update({ send_after: knex.raw("now() - interval '1 second'") });
  return { records, push, sweep, sent, due, homeReads };
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
  await records.messages.append(pair.id, [{ role: "user", kind: "text", body: { text: "Sure" } }], asBen);
  await due();
  assert.equal(await sweep.sweepOnce(), 2);
  // Each is named after the other person, whichever of the pair has the lower id.
  assert.deepEqual(sent.splice(0).map((note) => [note.userId, note.payload.title]).sort(), [[anna, "Ben"], [ben, "Anna"]].sort());
  await records.chats.markRead(pair.id, null, asBen);
  await records.chats.markRead(pair.id, null, asAnna);
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

test("folding takes every one of a person's notifications for the chat, however many others share the batch's people and chats", async (context) => {
  const { homeId, slug, anna, ben, botId } = await home(context);
  const { sweep, sent } = await startSweep(context, slug);
  const kitchen = await seedChat(knex, { homeId, kind: "private", title: "Kitchen", people: [anna, ben], bots: [botId] });
  const garden = await seedChat(knex, { homeId, kind: "private", title: "Garden", people: [anna, ben], bots: [botId] });
  const [older, newer, other] = await seedMessages(knex, { homeId, chatId: kitchen.id, rows: [
    { userId: anna, body: { text: "Oak?" } },
    { userId: anna, body: { text: "Pine?" } },
    { userId: anna, body: { text: "Garden" } }
  ] });
  const row = (userId, chatId, messageId, due) => ({
    workspace_id: homeId,
    user_id: userId,
    chat_id: chatId,
    kind: "messages",
    message_id: messageId,
    send_after: knex.raw(due ? "now() - interval '1 second'" : "now() + interval '1 minute'")
  });
  // Ben in the garden, not due: 1,000 of them, older than anything else, beside the due people's own.
  await knex("push_queue").insert(Array.from({ length: 1000 }, () => row(ben, garden.id, other, false)));
  await knex("push_queue").insert([row(ben, kitchen.id, older, true), row(anna, garden.id, other, true), row(ben, kitchen.id, newer, false)]);
  await knex("chat_people").whereIn("conversation_id", [kitchen.id, garden.id]).update({ unread: true });

  // The places read for them are the due people's own: Ben's in the kitchen and Anna's in the garden.
  const placesRead = [];
  const counting = (response, query) => {
    if (/from "chat_people"/u.test(query.sql) && /"read_up_to"/u.test(query.sql)) placesRead.push(response.length);
  };
  knex.on("query-response", counting);
  try {
    assert.equal(await sweep.sweepOnce(), 2);
  } finally {
    knex.removeListener("query-response", counting);
  }
  assert.deepEqual(placesRead, [2], "only the due people's own places are read");
  assert.deepEqual(sent.splice(0).map((note) => [note.userId, note.payload.body]).sort(), [[anna, "Garden"], [ben, "Pine?"]].sort());
  const left = await knex("push_queue").where({ workspace_id: homeId }).select("user_id", "chat_id");
  assert.equal(left.filter((entry) => String(entry.chat_id) === kitchen.id).length, 0, "Ben's newer one in the kitchen went with the older");
  assert.equal(left.length, 1000, "Ben's in the garden wait for their own time");
});

test("a sweep reads the homes it names once, and sends the same few statements for 2 notifications as for 20", async (context) => {
  const homes = [await home(context), await home(context), await home(context)];
  const { records, sweep, sent, homeReads } = await startSweep(context, homes[0].slug, new Map(homes.map((one) => [one.homeId, one.slug])));
  for (const one of homes) {
    const chat = await seedChat(knex, { homeId: one.homeId, kind: "private", title: "Plans", people: [one.anna, one.ben], bots: [one.botId] });
    await records.messages.append(chat.id, [{ role: "user", kind: "text", body: { text: "Hi", mentionedPeople: [{ id: Number(one.ben) }] } }],
      memberOptions({ userId: one.anna, homeId: one.homeId }));
  }
  await knex("push_queue").whereIn("workspace_id", homes.map((one) => one.homeId)).update({ send_after: knex.raw("now() - interval '1 second'") });
  assert.equal(await sweep.sweepOnce(), 3);
  assert.deepEqual(sent.splice(0).map((note) => note.payload.url.split("?")[0]).sort(), homes.map((one) => `/w/${one.slug}`).sort());
  assert.equal(homeReads.length, 1, "three homes, one read");

  // Sending in production: each device's outcome is written in a few statements, however many devices.
  const live = await startPush(context, { APP_ENV: "production", APP_PUBLIC_URL: "https://chat.example.test" }, async (target) => {
    if (target.endpoint.endsWith("-gone")) throw Object.assign(new Error("gone"), { statusCode: 410 });
    if (target.endpoint.endsWith("-flaky")) throw Object.assign(new Error("flaky"), { statusCode: 500 });
  });
  const people = homes.flatMap((one) => [one.anna, one.ben]);
  const devices = async (count) => {
    await knex("push_devices").whereIn("user_id", people).del();
    const kinds = ["fine", "gone", "flaky"];
    for (let index = 0; index < count; index += 1) {
      await live.addDevice(people[index % people.length], { ...subscription(`Device ${index}`), endpoint: `https://fcm.googleapis.com/fcm/send/${index}-${kinds[index % 3]}` });
    }
    return Array.from({ length: count }, (_, index) => ({ userId: people[index % people.length], payload: { title: "T", body: "B", url: "/", tag: `chat-${index}` } }));
  };
  const few = await devices(3);
  const fewStatements = await queriesDuring(knex, () => live.send(few));
  const many = await devices(30);
  const manyStatements = await queriesDuring(knex, () => live.send(many));
  assert.equal(manyStatements, fewStatements, `30 devices take the statements 3 do (${fewStatements})`);
  const kept = await knex("push_devices").whereIn("user_id", people).select("endpoint", "failures", "last_sent_at");
  assert.equal(kept.filter((device) => device.endpoint.endsWith("-gone")).length, 0, "a gone device is forgotten");
  assert.ok(kept.filter((device) => device.endpoint.endsWith("-flaky")).every((device) => Number(device.failures) === 1));
  assert.ok(kept.filter((device) => device.endpoint.endsWith("-fine")).every((device) => device.last_sent_at));
});

test("a sweep sends everything due, however much: 250 due notifications go in one sweep, in batches", async (context) => {
  const { homeId, slug, anna, others, botId } = await home(context, 249);
  const { sweep, sent } = await startSweep(context, slug);
  const people = [anna, ...others];
  const chat = await seedChat(knex, { homeId, kind: "private", title: "Everyone", people, bots: [botId] });
  const [message] = await seedMessages(knex, { homeId, chatId: chat.id, rows: [{ botId, body: { text: "Results" } }] });
  await knex("chat_people").where({ conversation_id: chat.id }).update({ unread: true });
  await knex("push_queue").insert(people.map((userId) => ({
    workspace_id: homeId,
    user_id: userId,
    chat_id: chat.id,
    kind: "results",
    message_id: message,
    send_after: knex.raw("now() - interval '1 second'")
  })));
  assert.equal(await sweep.sweepOnce(), 250);
  assert.equal(new Set(sent.map((note) => note.userId)).size, 250);
  assert.equal(Number((await knex("push_queue").where({ workspace_id: homeId }).count("* as n").first()).n), 0, "nothing due is left for later");
});

test("a notification's unread count is the person's unread chats in its own home, as the open app counts them", async (context) => {
  const here = await home(context);
  const elsewhere = await home(context);
  const { sweep, sent } = await startSweep(context, here.slug);
  const plans = await seedChat(knex, { homeId: here.homeId, kind: "private", title: "Plans", people: [here.anna, here.ben], bots: [here.botId] });
  const [message] = await seedMessages(knex, { homeId: here.homeId, chatId: plans.id, rows: [{ userId: here.anna, body: { text: "Hi" } }] });
  // Ben has unread chats in another home too: they're that home's, not this one's.
  await knex("workspace_memberships").insert({ workspace_id: elsewhere.homeId, user_id: here.ben, role_sid: "member", status: "active" });
  for (let index = 0; index < 3; index += 1) {
    await seedChat(knex, { homeId: elsewhere.homeId, kind: "private", title: `Other ${index}`, people: [elsewhere.anna, here.ben] });
  }
  await knex("chat_people").whereIn("workspace_id", [here.homeId, elsewhere.homeId]).where({ user_id: here.ben }).update({ unread: true });
  await knex("push_queue").insert({
    workspace_id: here.homeId,
    user_id: here.ben,
    chat_id: plans.id,
    kind: "messages",
    message_id: message,
    send_after: knex.raw("now() - interval '1 second'")
  });
  assert.equal(await sweep.sweepOnce(), 1);
  assert.equal(sent[0].payload.unread, 1, "this home's one unread chat");
});

test("the database refuses what the notification tables must never hold", async (context) => {
  const { homeId, anna, botId } = await home(context);
  const chat = await seedChat(knex, { homeId, kind: "private", title: "Plans", people: [anna], bots: [botId] });
  const [message] = await seedMessages(knex, { homeId, chatId: chat.id, rows: [{ botId, body: { text: "Hi" } }] });
  const device = { user_id: anna, endpoint: "https://fcm.googleapis.com/fcm/send/constraints", p256dh: `B${"x".repeat(86)}`, auth: "abcdefghijklmnop" };
  const queued = { workspace_id: homeId, user_id: anna, chat_id: chat.id, kind: "messages", message_id: message, send_after: new Date() };
  const refused = async (table, row, constraint) => {
    await assert.rejects(knex(table).insert(row), (error) => error.constraint === constraint || error.code === "23502", `${table}: ${constraint}`);
  };
  await knex("push_devices").insert(device);
  await refused("push_devices", device, "ux_push_devices_endpoint");
  await refused("push_devices", { ...device, endpoint: "https://fcm.googleapis.com/fcm/send/other", failures: -1 }, "ck_push_devices_failures");
  await refused("push_devices", { ...device, endpoint: "https://fcm.googleapis.com/fcm/send/nobody", user_id: 0 }, "push_devices_user_id_fkey");
  await knex("push_settings").insert({ user_id: anna });
  await refused("push_settings", { user_id: anna }, "ux_push_settings_user");
  await refused("push_settings", { user_id: anna, quiet_from: "25:00" }, "ck_push_settings_quiet_from");
  await refused("push_queue", { ...queued, kind: "other" }, "ck_push_queue_kind");
  await refused("push_queue", { ...queued, chat_id: 0 }, "push_queue_chat_id_fkey");
  // A chat deleted takes its waiting notifications with it; a person deleted, their devices and settings.
  await knex("push_queue").insert(queued);
  await knex("conversations").where({ id: chat.id }).del();
  assert.equal(await knex("push_queue").where({ user_id: anna }).first(), undefined);
});
