import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ACTIONS } from "../../packages/bots/src/server/botActions.js";
import { buildTools } from "../../packages/bots/src/server/botTools.js";
import { buildDraftTools } from "../../packages/bots/src/server/draftTools.js";
import { sendSednaMessage } from "../../packages/bots/src/server/sednaActions.js";
import { SEDNA_READS, SEDNA_WRITES } from "../../packages/bots/src/server/sednaTools.js";
import { startFakeSedna } from "../support/fakeSedna.mjs";
import { turnDoubles } from "../support/botDoubles.mjs";
import { accessOf } from "../support/appKey.mjs";
import { testServerEnv } from "../support/testEnv.mjs";

// Sedna's writes (D-94), against the stand-in Sedna (fakeSedna.mjs) over HTTP: always as the person's own Sedna user from
// one of their teams, only on messages in their teams, through approvals, in any chat they ask in (D-77 as amended by
// D-112: the asker's own Sedna user), and real only in a live copy.
const PAT = { id: "201", name: "Pat Doe", email: "pat@acme.example", teams: [{ id: "11", name: "Chartering" }] };
const LIVE = { ...testServerEnv(), APP_ENV: "production" };
const TEST_COPY = { ...testServerEnv(), APP_ENV: "test" };

async function setup(context) {
  const fake = await startFakeSedna();
  const folder = await mkdtemp(path.join(tmpdir(), "sedna-writes-"));
  context.after(async () => {
    await fake.close();
    await rm(folder, { recursive: true, force: true });
  });
  const api = `${fake.url}/acme/platform/2019-01-01`;
  const mint = async () => {
    const form = new URLSearchParams({ grant_type: "client_credentials", client_id: fake.clientId, client_secret: fake.clientSecret });
    return (await (await fetch(`${fake.url}/acme/platform/oauth/token`, { method: "POST", body: form })).json()).access_token;
  };
  let key = await mint();
  const integrations = (who) => ({
    reachableAccounts: async () => [{ id: "9", pluginId: "sedna", name: "", label: "Acme Shipping", status: "connected", home: true }],
    app: (id) => (id === "sedna" ? { id: "sedna", name: "Sedna", credentials: { home: true } } : null),
    connections: {
      accessToken: async (_id, _call, { refused = "" } = {}) => {
        if (refused) key = await mint();
        return { ...accessOf(key), api };
      },
      appPerson: async () => who
    }
  });
  // The bot's files: a plain folder, as fileStore.js resolves /files/chat/… for the bot in its chat.
  const real = (virtual) => path.join(folder, virtual.replace(/^\/files\//u, ""));
  const files = {
    store: {
      placeFor: () => ({ homeId: "1", botId: "3", userId: "7" }),
      resolve: async (_place, virtual) => real(virtual),
      existingFile: async (_place, virtual) => ({ real: real(virtual), stat: await stat(real(virtual)) }),
      settle: async () => {}
    }
  };
  const putFile = async (virtual, data) => {
    await mkdir(path.dirname(real(virtual)), { recursive: true });
    await writeFile(real(virtual), data);
    return virtual;
  };

  /** One reply's tools for a person, with what approvals decided and the cards under the reply. */
  function turn({ person = PAT, who = null, decide = "allow", env = LIVE, routineRun = false, routine = null, chatKind = "public", viaBot = false, removed = [] } = {}) {
    const decisions = [];
    const run = buildTools(turnDoubles({
      approvals: {
        decide: async (description, options) => {
          decisions.push({ description, ...options });
          return typeof decide === "function" ? decide(description, options) : decide;
        }
      },
      integrations: integrations(who || { person, via: "email" }),
      files,
      env,
      // Pat's turn with bot 3 in chat 5 of home 1 (its seat 11).
      seat: { id: "3", workspace_id: "1", user_id: "7", chat_id: "5", chat_bot_id: "11", chat: { id: "5", kind: chatKind } },
      place: files.store.placeFor(),
      routineRun,
      routine,
      viaBot,
      toolSwitches: { skip: {}, removed, connected: ["sedna"] }
    }));
    return { ...run, decisions };
  }
  /** An action's context as an approval card's or a draft card's Send gives it. */
  const contextOf = ({ person = PAT, env = LIVE } = {}) => ({
    integrations: integrations({ person, via: "email" }), call: {}, env, files, place: files.store.placeFor()
  });
  const writes = () => fake.requests.filter((entry) => entry.method !== "GET" && entry.route !== "/oauth/token");
  return { fake, turn, contextOf, writes, putFile, real };
}

/** What `work` answers, and the side-effect lines a test copy logs (D-69). */
async function logged(context, work) {
  const info = context.mock.method(console, "info", () => {});
  try {
    const result = await work();
    return { result, lines: info.mock.calls.map((call) => call.arguments).filter(([fields]) => fields?.appEnv) };
  } finally {
    info.mock.restore();
  }
}

test("a reply is a card first, and Send sends it as the person from their team, quoting the message; a test copy only logs it", async (context) => {
  const { fake, turn, contextOf, writes } = await setup(context);
  const { tools, after } = turn();
  const shown = await tools.sednaDraft.execute({ replyTo: "1001", text: "Kim,\n\nLaycan works <for us>.\n\nPat" });
  assert.equal(shown.status, "waiting_for_send");
  assert.match(shown.note, /may show outside that conversation's thread in Sedna/u);
  const card = after.find((message) => message.kind === "draft").body;
  assert.deepEqual(
    [card.to, card.subject, card.from, card.sedna.team, card.sedna.replyTo, card.inReplyTo.subject],
    ["Kim Broker <kim@brokers.example>", "Re: Fixture recap VOY-101", "Pat Doe · Chartering (Sedna)", { id: "11", name: "Chartering" }, "1001", "Fixture recap VOY-101"]
  );
  assert.deepEqual(writes(), [], "a card writes nothing in Sedna");
  assert.deepEqual(await tools.sednaDraft.execute({ replyTo: "1001", text: "Again" }), { status: "already shown" }, "one card a reply");

  // The card's Send, as botCards.js settleDraft makes it.
  const args = { team: card.sedna.team.id, to: card.to, subject: card.subject, text: card.text, replyTo: card.sedna.replyTo };
  const copy = await logged(context, () => sendSednaMessage(contextOf({ env: TEST_COPY }), args));
  assert.deepEqual([writes(), fake.sent], [[], []], "a test copy sends nothing");
  assert.equal(copy.lines.length, 1);
  assert.deepEqual([copy.lines[0][0].appEnv, copy.lines[0][0].kind, copy.lines[0][0].team, copy.lines[0][0].to], ["test", "Sedna message", "Chartering", ["kim@brokers.example"]]);
  assert.match(copy.result.body.detail, /This is a test copy, so it was logged, not done in Sedna/u);

  const live = await logged(context, () => sendSednaMessage(contextOf(), args));
  assert.deepEqual(live.lines, []);
  assert.equal(fake.sent.length, 1);
  const [sent] = fake.sent;
  assert.deepEqual([sent.from, sent.team, sent.to, sent.subject], ["201", "11", [{ email: "kim@brokers.example", name: "Kim Broker" }], "Re: Fixture recap VOY-101"]);
  assert.match(sent.html, /^<p>Kim,<\/p><p>Laycan works &lt;for us&gt;\.<\/p><p>Pat<\/p>/u, "the text is escaped, never markup");
  assert.match(sent.html, /<blockquote[^>]*><p>Recap attached\. Laycan 3-5 Dec\.<\/p><\/blockquote>$/u, "the answered message is quoted");
  assert.deepEqual(writes().map((entry) => `${entry.method} ${entry.route}`), ["POST /2019-01-01/message/send"]);
  assert.equal(writes()[0].query.currentTeamId, "11");
  assert.match(live.result.body.detail, /Sedna's API has no field for answering a message/u);
});

test("never as anyone else: the person's own user, their teams, their messages, their drafts, in any chat", async (context) => {
  const { fake, turn, writes } = await setup(context);
  const { tools, after } = turn();
  // Another team's message is refused before any card or change, and nothing of it is shown.
  const elsewhere = await tools.sednaDraft.execute({ replyTo: "1002", text: "Hi" });
  assert.match(elsewhere.error, /isn't in any of the person's Sedna teams/u);
  assert.doesNotMatch(JSON.stringify(elsewhere), /Bunkers/u);
  for (const [tool, input] of [
    ["sednaMail", { action: "send", replyTo: "1002", text: "Hi", personAsked: true }],
    ["sednaSort", { action: "tag", id: "1002", tag: "Fixtures" }],
    ["sednaAssign", { action: "assign", id: "1002", to: "Lee" }],
    ["sednaAttachments", { action: "list", id: "1002" }]
  ]) assert.match((await tools[tool].execute(input)).error, /isn't in any of the person's Sedna teams/u, tool);
  // A team that isn't theirs, and a fromUser the bot names, are never used.
  assert.match((await tools.sednaMail.execute({ action: "send", team: "Operations", to: "kim@brokers.example", text: "Hi", personAsked: true })).error, /isn't one of the person's Sedna teams/u);
  await tools.sednaMail.execute({ action: "send", to: "kim@brokers.example", subject: "Hello", text: "Hi", fromUser: "203", personAsked: true });
  assert.deepEqual(fake.sent.map((entry) => [entry.from, entry.team]), [["201", "11"]], "always Pat's own user and team");
  // Another person's draft, and a message already sent, aren't changed or sent.
  assert.match((await tools.sednaMail.execute({ action: "update_draft", id: "1005", text: "Mine now" })).error, /doesn't say that draft is the person's own/u);
  assert.match((await tools.sednaMail.execute({ action: "send_draft", id: "1001", personAsked: true })).error, /already sent or received/u);
  assert.equal(writes().length, 1, "only the one send");
  assert.equal(after.filter((message) => message.kind === "draft").length, 0);

  // A person who is no one in Sedna changes nothing, and is told what to do.
  const nobody = turn({ who: { person: null, asked: null } });
  assert.match((await nobody.tools.sednaDraft.execute({ to: "kim@brokers.example", text: "Hi" })).error, /isn't matched to a Sedna user/u);
  assert.match((await nobody.tools.sednaSort.execute({ action: "tag", id: "1001", tag: "Fixtures" })).error, /isn't matched to a Sedna user/u);
  // A chat others are in too, Public or private, has the same Sedna tools: they work as the asker's own Sedna user.
  for (const chatKind of ["public", "private"]) {
    const sedna = Object.values(turn({ chatKind }).tools).map((tool) => tool.id).filter((id) => id.startsWith("sedna")).sort();
    assert.deepEqual(sedna, Object.values(tools).map((tool) => tool.id).filter((id) => id.startsWith("sedna")).sort(), chatKind);
  }
  assert.equal(writes().length, 1);
});

test("sends and assignments ask first unless the person asked; a routine's run always asks unless a rule allows", async (context) => {
  const { fake, turn, writes } = await setup(context);
  const asking = turn({ decide: "ask" });
  const waiting = await asking.tools.sednaMail.execute({ action: "send", to: "kim@brokers.example", subject: "Laycan", text: "Hi" });
  assert.equal(waiting.status, "waiting_for_approval");
  const card = asking.after.find((message) => message.kind === "choice").body;
  assert.deepEqual([card.action.id, card.action.args.team, card.action.args.personAsked], ["sedna_mail.send", "Chartering", false]);
  assert.equal(card.question, 'Shall I send "Laycan" to kim@brokers.example from Sedna (Chartering)?');
  assert.deepEqual(asking.decisions.map((entry) => [entry.reversible, entry.strict]), [[false, false]]);
  await asking.tools.sednaAssign.execute({ action: "assign", id: "1001", to: "Sam" });
  assert.match(asking.decisions[1].description, /assign the Sedna message "Fixture recap VOY-101" to Sam, who Sedna tells/u);
  assert.equal(asking.decisions[1].reversible, false);
  assert.deepEqual([writes(), fake.sent], [[], []], "nothing went out while it waits");

  // Asked in so many words: theirs, so only their own rules make it ask.
  const asked = turn();
  await asked.tools.sednaMail.execute({ action: "send", to: "kim@brokers.example", text: "Hi", personAsked: true });
  assert.equal(asked.decisions[0].reversible, true);
  // Work another bot asked for, and a routine's run, never count as the person asking; a routine asks even with auto-review off.
  const viaBot = turn({ viaBot: true });
  await viaBot.tools.sednaMail.execute({ action: "send", to: "kim@brokers.example", text: "Hi", personAsked: true });
  assert.equal(viaBot.decisions[0].reversible, false);
  const routine = turn({ routineRun: true, decide: "ask" });
  await routine.tools.sednaMail.execute({ action: "send", to: "kim@brokers.example", text: "Hi", personAsked: true });
  await routine.tools.sednaAssign.execute({ action: "assign", id: "1001", to: "Sam", personAsked: true });
  await routine.tools.sednaSort.execute({ action: "tag", id: "1003", tag: "Fixtures" });
  assert.deepEqual(routine.decisions.map((entry) => [entry.reversible, entry.strict]), [[false, true], [false, true], [true, false]]);
  assert.equal(routine.after.filter((message) => message.kind === "choice").length, 3, "each leaves a card");
  // A saved draft a routine would send waits for a card too.
  assert.match((await routine.tools.sednaMail.execute({ action: "send_draft", id: "1004", personAsked: true })).status, /waiting_for_approval/u);
  // And a routine never presses Send on a Sedna draft card for the person.
  const settled = [];
  const cards = buildDraftTools({
    turns: { latestMessage: async () => ({ id: "77", body: { status: "pending", to: "kim@brokers.example", text: "Hi", sedna: { team: { id: "11", name: "Chartering" } } } }) },
    call: {}, conversationId: "5", viaBot: false, routineRun: true, appFor: () => ({}), after: [],
    settleDraft: async (id) => {
      settled.push(id);
      return { messages: [] };
    }
  });
  assert.match((await cards.sendDraft.execute({})).error, /A routine never sends a Sedna draft/u);
  assert.deepEqual(settled, []);
});

test("tags and job references on the person's messages; a job reference is made only when asked; Sedna's 409 finds the one there", async (context) => {
  const { fake, turn, contextOf, writes } = await setup(context);
  const { tools } = turn();
  assert.equal((await tools.sednaSort.execute({ action: "tag", id: "1003", tag: "fixtures" })).status, "done");
  assert.deepEqual(fake.messages.find((message) => message.id === "1003").tags, ["301"]);
  assert.equal((await tools.sednaSort.execute({ action: "untag", id: "1003", tag: "301" })).status, "done");
  assert.deepEqual(fake.messages.find((message) => message.id === "1003").tags, []);
  // Another team's tag, by name or by id, isn't used.
  assert.match((await tools.sednaSort.execute({ action: "tag", id: "1003", tag: "Ops only" })).error, /No Sedna tag called Ops only in the person's teams/u);
  assert.match((await tools.sednaSort.execute({ action: "tag", id: "1003", tag: "302" })).error, /isn't one of the person's teams'/u);
  assert.equal((await tools.sednaSort.execute({ action: "link_job", id: "1003", job: "VOY-101" })).status, "done");
  assert.deepEqual(fake.messages.find((message) => message.id === "1003").jobs, ["401"]);
  assert.equal((await tools.sednaSort.execute({ action: "unlink_job", id: "1003", job: "VOY-101" })).status, "done");
  assert.match((await tools.sednaSort.execute({ action: "link_job", id: "1003", job: "VOY-202" })).error, /No Sedna job reference called VOY-202/u);

  assert.match((await tools.sednaSort.execute({ action: "create_job", name: "VOY-303" })).error, /only when the person asks for a new one/u);
  assert.equal((await tools.sednaSort.execute({ action: "create_job", name: "VOY-303", type: "voyage", personAsked: true })).status, "done");
  const made = writes().at(-1);
  assert.deepEqual([made.route, made.body.data.attributes, made.body.data.relationships.team.data], ["/2019-01-01/job-reference", { name: "VOY-303", type: "voyage" }, [{ type: "team", id: "11" }]]);
  const again = await ACTIONS["sedna_sort.create_job"].run(contextOf(), { name: "VOY-101" });
  assert.deepEqual([again.result.made, again.result.id, again.body.text], [false, "401", "Job reference VOY-101 was already there"]);
  assert.equal(fake.jobs.length, 3, "nothing made twice");

  // In a test copy every check still runs, and nothing changes in Sedna.
  const before = writes().length;
  const copy = await logged(context, () => ACTIONS["sedna_sort.tag"].run(contextOf({ env: TEST_COPY }), { id: "1003", tag: "Fixtures" }));
  assert.equal(writes().length, before);
  assert.deepEqual(copy.lines.map(([fields]) => [fields.kind, fields.message]), [["Sedna change", "1003"]]);
  await assert.rejects(ACTIONS["sedna_sort.tag"].run(contextOf({ env: TEST_COPY }), { id: "1002", tag: "Fixtures" }), /isn't in any of the person's Sedna teams/u);
});

test("a message is assigned only to an active colleague in its team; Sedna's API can't unassign", async (context) => {
  const { fake, turn } = await setup(context);
  const { tools } = turn();
  assert.equal((await tools.sednaAssign.execute({ action: "assign", id: "1001", to: "Sam Poe", personAsked: true })).status, "done");
  assert.deepEqual(fake.assignments.get("1001"), ["203"]);
  assert.match((await tools.sednaAssign.execute({ action: "assign", id: "1001", to: "Lee", personAsked: true })).error, /No active Sedna user called Lee is in the message's team/u);
  assert.match((await tools.sednaAssign.execute({ action: "assign", id: "1001", to: "Ann", personAsked: true })).error, /No active Sedna user called Ann/u);
  assert.match(tools.sednaAssign.description, /can't take an assignment off/u);
  const read = await tools.sednaMessages.execute({ action: "read", id: "1001" });
  assert.deepEqual(read.result.assignedTo, ["Sam Poe"]);
});

test("attachments are saved into the bot's files from Sedna's signed link, and the bot's files go out with a message or a draft", async (context) => {
  const { fake, turn, contextOf, writes, putFile, real } = await setup(context);
  const { tools } = turn();
  const listed = await tools.sednaAttachments.execute({ action: "list", id: "1001" });
  assert.deepEqual(listed.result.documents.map((entry) => [entry.id, entry.name]), [["701", "recap.pdf"]]);
  const saved = await tools.sednaAttachments.execute({ action: "save", id: "1001", document: "recap.pdf" });
  assert.deepEqual(saved.result.saved, ["/files/chat/Sedna/Fixture recap VOY-101/recap.pdf"]);
  assert.equal(String(await readFile(real(saved.result.saved[0]))), "%PDF-1.4 recap of VOY-101");
  const signed = fake.requests.find((entry) => entry.route.startsWith("/signed/"));
  assert.equal(signed.auth, false, "the signed link is fetched without Sedna's key");
  assert.match((await tools.sednaAttachments.execute({ action: "save", id: "1001", document: "other.pdf" })).error, /Say which attachment/u);

  const notes = await putFile("/files/chat/notes.txt", "Laycan notes");
  const big = await putFile("/files/chat/big.bin", Buffer.alloc(10 * 1024 * 1024 + 1));
  assert.match((await tools.sednaMail.execute({ action: "save_draft", to: "kim@brokers.example", text: "See attached", attach: [big] })).error, /over 10 MB/u);
  assert.match((await tools.sednaMail.execute({ action: "save_draft", to: "kim@brokers.example", text: "See attached", attach: ["/files/chat/none.txt"] })).error, /There's no file/u);
  assert.equal(writes().length, 0, "nothing is written for a file that can't go");
  const draft = await tools.sednaMail.execute({ action: "save_draft", to: "kim@brokers.example", subject: "Notes", text: "See attached", attach: [notes] });
  assert.equal(draft.status, "done");
  const made = fake.messages.at(-1);
  assert.deepEqual([made.draft, made.sender, made.documents.map((doc) => [doc.name, String(doc.bytes)])], [true, "201", [["notes.txt", "Laycan notes"]]]);
  // A card with attachments: a draft, its files, then sent.
  await sendSednaMessage(contextOf(), { to: "kim@brokers.example", subject: "Recap", text: "Attached", files: [notes] });
  assert.deepEqual(writes().slice(-3).map((entry) => `${entry.method} ${entry.route.replace(/\/message\/\d+/u, "/message/N")}`), ["POST /2019-01-01/message", "POST /2019-01-01/message/N/document", "POST /2019-01-01/message/N/send"]);
  assert.deepEqual(fake.sent.at(-1).documents, ["notes.txt"]);
  // Pat's own draft can be changed, given a file and sent.
  assert.equal((await tools.sednaMail.execute({ action: "update_draft", id: "1004", text: "Kim, can owners do 5-7 Dec?" })).status, "done");
  assert.equal((await tools.sednaMail.execute({ action: "attach", id: "1004", attach: [notes] })).status, "done");
  assert.equal((await tools.sednaMail.execute({ action: "send_draft", id: "1004", personAsked: true })).status, "done");
  assert.deepEqual([fake.sent.at(-1).id, fake.sent.at(-1).team, fake.sent.at(-1).documents], ["1004", "11", ["notes.txt"]]);
});

test("templates and contacts of the person's teams only; contacts change only when asked, keeping what isn't changed", async (context) => {
  const { fake, turn, writes } = await setup(context);
  const { tools, after } = turn();
  assert.deepEqual((await tools.sednaLists.execute({ action: "templates" })).result.map((entry) => entry.name), ["Fixture confirmation", "Signature"]);
  assert.match((await tools.sednaLists.execute({ action: "template", id: "802" })).error, /isn't one of the person's teams' templates/u);
  await tools.sednaDraft.execute({ template: "801", to: "owners@example.com" });
  const card = after.find((message) => message.kind === "draft").body;
  assert.deepEqual([card.subject, card.text, card.sedna.template], ["Fixture confirmed", "Dear owners,\nWe confirm the fixture.", "Fixture confirmation"]);

  assert.match((await tools.sednaLists.execute({ action: "contact", id: "502" })).error, /isn't one of the person's teams' contacts/u);
  assert.deepEqual((await tools.sednaLists.execute({ action: "contact", id: "501" })).result.emails, ["kim@brokers.example"]);
  assert.match((await tools.sednaContacts.execute({ action: "create", firstName: "Ana", company: "Owners Co" })).error, /only when the person asks/u);
  assert.equal((await tools.sednaContacts.execute({ action: "create", firstName: "Ana", company: "Owners Co", emails: ["ana@owners.example"], personAsked: true })).status, "done");
  assert.deepEqual(fake.contacts.at(-1).teams, ["11"]);
  assert.equal((await tools.sednaContacts.execute({ action: "update", id: "501", title: "Senior broker", personAsked: true })).status, "done");
  const kim = fake.contacts.find((contact) => contact.id === "501");
  assert.deepEqual([kim.title, kim.company, kim.emailAddresses, kim.teams], ["Senior broker", "Brokers Ltd", ["kim@brokers.example"], ["11"]], "a PUT keeps what wasn't changed");
  assert.match((await tools.sednaContacts.execute({ action: "update", id: "502", title: "x", personAsked: true })).error, /isn't one of the person's teams' contacts/u);
  assert.equal(writes().length, 2);
});

test("a change Sedna didn't answer or failed on is never tried again; a brief 429 is waited out once", async (context) => {
  const { fake, turn, writes } = await setup(context);
  const { tools } = turn();
  fake.state.failNext = 500;
  const failed = await tools.sednaMail.execute({ action: "send", to: "kim@brokers.example", text: "Hi", personAsked: true });
  assert.match(failed.error, /Sedna answered 500, so it isn't known whether the change was made/u);
  assert.equal(writes().length, 1, "never sent again by itself");
  fake.state.busy = 1;
  fake.state.retryAfter = "0";
  assert.equal((await tools.sednaMail.execute({ action: "send", to: "kim@brokers.example", text: "Hi", personAsked: true })).status, "done");
  assert.equal(writes().length, 3, "Sedna refused the first (429), so it was sent once more");
  assert.equal(fake.sent.length, 1);
});

test("a routine reads the events feed from where its last run got to, a bounded amount each run, nothing dropped", async (context) => {
  const { fake, turn } = await setup(context);
  assert.equal(turn().tools.sednaInbox, undefined, "only a routine's run reads the feed");
  const routine = { id: "4", runId: "run-1", createdAt: new Date(Date.now() - 60000).toISOString(), feeds: null };
  const runOnce = async () => {
    const run = turn({ routineRun: true, routine });
    const { result } = await run.tools.sednaInbox.execute({ action: "new" });
    routine.feeds = { ...routine.feeds, ...run.feeds() };
    return result;
  };
  // The first run starts now: older mail isn't new.
  const first = await runOnce();
  assert.deepEqual([first.messages, first.more], [[], false]);
  assert.deepEqual(Object.keys(routine.feeds), ["sedna:9"]);

  const mine = [fake.receive({ subject: "One" }), fake.receive({ team: "12", subject: "Not Pat's" }), fake.receive({ subject: "Two" })];
  const second = await runOnce();
  assert.deepEqual(second.messages.map((message) => message.id), [mine[0], mine[2]], "the person's teams' only, oldest first");
  assert.deepEqual((await runOnce()).messages, [], "nothing handed twice");

  const many = Array.from({ length: 13 }, (_, n) => fake.receive({ subject: `Many ${n}` }));
  const third = await runOnce();
  assert.deepEqual([third.messages.length, third.more], [10, true]);
  assert.match(third.note, /the next run carries on from here/u);
  const fourth = await runOnce();
  assert.deepEqual([...third.messages, ...fourth.messages].map((message) => message.id), many, "every one, once, in order");
  assert.equal(fourth.more, false);
});

test("every Sedna action is its own switch in plugin.json, and each write is an action", async () => {
  const plugin = JSON.parse(await readFile(new URL("../../plugins/sedna/plugin.json", import.meta.url), "utf8"));
  const listed = plugin.actions.map((action) => action.id).sort();
  const tools = Object.entries({ ...SEDNA_READS, ...SEDNA_WRITES }).flatMap(([tool, actions]) => actions.map((action) => `${tool}.${action}`));
  assert.deepEqual(listed, [...tools, "sedna_draft", "sedna_inbox.new"].sort());
  for (const [tool, actions] of Object.entries(SEDNA_WRITES)) for (const action of actions) assert.ok(ACTIONS[`${tool}.${action}`], `${tool}.${action}`);
});
