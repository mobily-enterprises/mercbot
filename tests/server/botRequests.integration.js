import assert from "node:assert/strict";
import test from "node:test";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { createBotsService } from "../../packages/bots/src/server/botsService.js";
import { buildTools } from "../../packages/bots/src/server/botTools.js";
import { testBot } from "./testHome.js";
import { serviceDoubles, turnDoubles } from "../support/botDoubles.mjs";
import { memberOptions, startBotParts } from "../support/botRecords.mjs";

// Bots asking bots (D-46, step 1), against the disposable test database, with scripted replies
// in place of the model: a request goes to the other bot, its answer comes back, questions go
// back and forth, the person approves anything a bot asked for, and the limits hold.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const FAST = { retryMs: 200, resumeMs: 200, nextTurnMs: 200 };

async function setup(context, names) {
  const knex = await connectTestDatabase();
  const userId = (await knex("users").first())?.id;
  assert.ok(userId, "the test database needs a user row");
  const tag = Date.now().toString(36);
  const bots = {};
  for (const name of names) bots[name] = await testBot(knex, userId, { name: `${name} ${tag}` });
  context.after(async () => {
    await knex("bots").whereIn("id", Object.values(bots).map((bot) => bot.id)).del();
    await knex.destroy();
  });
  // Requests between bots run in the bots' system context, each step for its person in the bots' home.
  const parts = await startBotParts(knex, context);
  /** The person's request in the bots' home, as the bots routes make its options. */
  const as = (person) => memberOptions({ userId: person, homeId: Object.values(bots)[0].workspace_id });
  return { knex, parts, as, userId, bots, name: (key) => `${key} ${tag}` };
}

// Every due step runs until nothing is left to do. A step due later (a short retry, the pause
// before the next turn, a lease running out) is waited for until the moment it can be claimed, by
// the database's clock (botRequests.js claim: run_after and lease_until past); 10 s of waiting in all.
async function settle(service, knex, ids) {
  let waited = 0;
  for (let round = 0; round < 40; round += 1) {
    await service.drain(10000);
    await service.requests.runDue();
    await service.drain(10000);
    const { pending, ms } = await knex("bot_requests")
      .where((query) => query.whereIn("from_bot_id", ids).orWhereIn("to_bot_id", ids))
      .whereNotNull("next_step")
      .first(
        knex.raw("count(*)::int as pending"),
        knex.raw("ceil(greatest(0, extract(epoch from min(greatest(run_after, coalesce(lease_until, run_after))) - now()) * 1000))::int as ms")
      );
    if (!pending) return;
    if (waited + ms > 10_000) break;
    waited += ms;
    await new Promise((resolve) => setTimeout(resolve, ms + 1));
  }
  const stuck = await knex("bot_requests").where((query) => query.whereIn("from_bot_id", ids).orWhereIn("to_bot_id", ids)).select("status", "next_step", "turns", "questions", "attempts", "last_error", "lease_until", "run_after");
  assert.fail(`requests didn't settle: ${JSON.stringify(stuck)}`);
}

const lastText = async (knex, bot) => (await knex("bot_messages").where({ conversation_id: bot.conversation_id, kind: "text", role: "bot" }).orderBy("id", "desc").first())?.body.text;
const card = async (knex, bot) => (await knex("bot_messages").where({ conversation_id: bot.conversation_id, kind: "bot_request" }).orderBy("id", "desc").first())?.body;

test("a bot asks another, waits, and carries on with its answer; both cards show it", async (context) => {
  const { knex, parts, as, userId, bots, name } = await setup(context, ["Asker", "Builder"]);
  const prompts = [];
  const service = createBotsService(serviceDoubles({
    knex,
    ...parts,
    approvals: { decide: async () => "allow" },
    requestLimits: FAST,
    reply: async (current, _history, tools, _state, prompt) => {
      prompts.push([current.name, prompt]);
      if (String(current.id) === String(bots.Asker.id)) {
        if (prompt.includes("finished what you asked")) return { text: `Done: I used it. ${prompt.match(/"([^"]+)"\. Carry/u)?.[1]}`, transcript: [] };
        // "...made the app" reads as a claim, so the reply check sends it back, with only its note as the prompt.
        if (prompt.includes("Check from Mercbot")) return { text: "Done: I used it. I made the app Plant Watering.", transcript: [] };
        const asked = await tools.askBot.execute({ bot: name("Builder"), brief: "Make a small app to track plant watering, then tell me its name." });
        assert.equal(asked.status, "asked");
        return { text: "I've asked the Builder and will carry on when it answers.", transcript: [] };
      }
      assert.ok(prompt.includes("A request from your fellow bot"), "the asked bot gets the request");
      assert.ok(prompt.includes("isn't") && prompt.includes("own words"), "and is told it isn't the person's words");
      assert.ok(tools.answerRequest && tools.askBack, "with the tools to answer");
      await tools.answerRequest.execute({ answer: "I made the app Plant Watering." });
      return { text: "Sent it back.", transcript: [] };
    }
  }));
  const sent = await service.sendMessage(bots.Asker.id, { text: "Get the Builder to make me a plant watering app", clientId: `ask-${Date.now()}` }, as(userId));
  await service.replyTo(bots.Asker.id, { afterMessageId: sent.messages[0].id }, undefined, as(userId));
  assert.equal((await card(knex, bots.Asker))?.side, "asker", "the asking bot's card shows at once");
  await settle(service, knex, [bots.Asker.id, bots.Builder.id]);

  const request = await knex("bot_requests").where({ from_bot_id: bots.Asker.id }).first();
  assert.equal(request.status, "done");
  assert.equal(request.answer, "I made the app Plant Watering.");
  assert.equal((await card(knex, bots.Asker)).status, "done");
  const theirs = await card(knex, bots.Builder);
  assert.equal(theirs.side, "target");
  assert.equal(theirs.status, "done");
  assert.equal(theirs.other.name, name("Asker"));
  assert.match(await lastText(knex, bots.Asker), /Done: I used it\. I made the app Plant Watering\./u);
  assert.equal(await knex("agent_runs").whereIn("bot_id", [bots.Asker.id, bots.Builder.id]).first(), undefined, "no turn is left claimed");
});

test("the asked bot puts a question back, the asking bot answers, and the work goes on", async (context) => {
  const { knex, parts, as, userId, bots, name } = await setup(context, ["Asker", "Builder"]);
  const service = createBotsService(serviceDoubles({
    knex,
    ...parts,
    approvals: { decide: async () => "allow" },
    requestLimits: FAST,
    reply: async (current, _history, tools, _state, prompt) => {
      if (String(current.id) === String(bots.Asker.id)) {
        if (prompt.includes("asks about what you asked")) {
          assert.ok(tools.answerBot, "the asking bot can answer the question");
          await tools.answerBot.execute({ answer: "Green, please." });
          return { text: "Answered the Builder.", transcript: [] };
        }
        if (prompt.includes("finished what you asked")) return { text: "All done.", transcript: [] };
        await tools.askBot.execute({ bot: name("Builder"), brief: "Make a plant app in my favourite colour." });
        return { text: "Asked.", transcript: [] };
      }
      if (prompt.includes('answered your last question: "Green, please."')) {
        await tools.answerRequest.execute({ answer: "A green plant app." });
        return { text: "Finished.", transcript: [] };
      }
      await tools.askBack.execute({ question: "Which colour should it be?" });
      return { text: "I asked which colour.", transcript: [] };
    }
  }));
  const sent = await service.sendMessage(bots.Asker.id, { text: "Have the Builder make a plant app", clientId: `q-${Date.now()}` }, as(userId));
  await service.replyTo(bots.Asker.id, { afterMessageId: sent.messages[0].id }, undefined, as(userId));
  await settle(service, knex, [bots.Asker.id, bots.Builder.id]);
  const request = await knex("bot_requests").where({ from_bot_id: bots.Asker.id }).first();
  assert.equal(request.status, "done");
  assert.equal(request.questions, 1);
  assert.equal(request.answer, "A green plant app.");
  const event = await knex("bot_messages").where({ conversation_id: bots.Builder.conversation_id, kind: "event" }).orderBy("id", "desc").first();
  assert.match(event.body.detail, /Green, please\./u, "the answer shows in the asked bot's chat");
  assert.equal(await lastText(knex, bots.Asker), "All done.");
});

test("work another bot asked for never counts as the person's own request", async (context) => {
  const { userId, bots } = await setup(context, ["Asker"]);
  const seen = [];
  const approvals = { decide: async (_what, { reversible } = {}) => { seen.push(reversible); return reversible ? "allow" : "ask"; } };
  const args = { title: "Lunch", start: "2026-11-02T12:00", guests: 0, account: "me@example.com", personAsked: true };

  const byPerson = buildTools(turnDoubles({ approvals, computer: null, userId, botId: bots.Asker.id, conversationId: bots.Asker.conversation_id }));
  const byBot = buildTools(turnDoubles({ approvals, computer: null, userId, botId: bots.Asker.id, conversationId: bots.Asker.conversation_id, viaBot: true, workingRequestId: "42" }));
  await assert.rejects(byPerson.attempt("delete_calendar_event", args), "the person's own request runs (and fails here without a calendar)");
  const parked = await byBot.attempt("delete_calendar_event", args);
  assert.deepEqual(seen, [true, false], "the same request is only reversible when the person asked");
  assert.equal(parked.status, "waiting_for_approval");
  assert.equal(byBot.after[0].body.requestId, "42", "the card belongs to the request");
  const sending = await byBot.tools.sendDraft?.execute({});
  if (sending) assert.match(sending.error, /Only the person can send/u);
});

test("an approval asked during a request waits for the person, then the work carries on", async (context) => {
  const { knex, parts, as, userId, bots, name } = await setup(context, ["Asker", "Builder"]);
  let builderTurns = 0;
  const service = createBotsService(serviceDoubles({
    knex,
    ...parts,
    approvals: { decide: async () => "ask" },
    requestLimits: FAST,
    reply: async (current, _history, tools, _state, prompt) => {
      if (String(current.id) === String(bots.Asker.id)) {
        if (!prompt) await tools.askBot.execute({ bot: name("Builder"), brief: "Set up a daily 9am check of the plants." });
        return { text: "OK.", transcript: [] };
      }
      builderTurns += 1;
      if (builderTurns === 1) {
        await tools.createRoutine.execute({ name: "Plant check", schedule: "Every day at 9:00 (UTC)", timezone: "UTC", instructions: "Check the plants.", cron: "0 9 * * *", acknowledgement: "Setting it up" });
        return { text: "It's waiting for the person's OK.", transcript: [] };
      }
      await tools.answerRequest.execute({ answer: "Set up after the person's OK." });
      return { text: "Done.", transcript: [] };
    }
  }));
  const sent = await service.sendMessage(bots.Asker.id, { text: "Ask the Builder for a daily plant check", clientId: `ap-${Date.now()}` }, as(userId));
  await service.replyTo(bots.Asker.id, { afterMessageId: sent.messages[0].id }, undefined, as(userId));
  await settle(service, knex, [bots.Asker.id, bots.Builder.id]);
  let request = await knex("bot_requests").where({ from_bot_id: bots.Asker.id }).first();
  assert.equal(request.status, "waiting_approval");
  assert.equal((await card(knex, bots.Asker)).status, "waiting_approval");
  const approval = await knex("bot_messages").where({ conversation_id: bots.Builder.conversation_id, kind: "choice" }).orderBy("id", "desc").first();
  assert.equal(approval.body.requestId, String(request.id));
  await service.answerChoice(bots.Builder.id, approval.id, [approval.body.options[0]], as(userId));
  await settle(service, knex, [bots.Asker.id, bots.Builder.id]);
  request = await knex("bot_requests").where({ id: request.id }).first();
  assert.equal(request.status, "done");
  assert.equal(builderTurns, 2);
});

test("limits: no asking a bot already in the job, no second open request, and turns run out", async (context) => {
  const { knex, parts, as, userId, bots, name } = await setup(context, ["Asker", "Middle", "Last"]);
  const results = {};
  const service = createBotsService(serviceDoubles({
    knex,
    ...parts,
    approvals: { decide: async () => "allow" },
    requestLimits: { ...FAST, turns: 2 },
    reply: async (current, _history, tools, _state, prompt) => {
      if (String(current.id) === String(bots.Asker.id)) {
        if (!prompt) {
          results.first = await tools.askBot.execute({ bot: name("Middle"), brief: "Find out the plan." });
          results.second = await tools.askBot.execute({ bot: name("Middle"), brief: "And another thing." });
        }
        return { text: "OK.", transcript: [] };
      }
      if (String(current.id) === String(bots.Middle.id)) {
        if (!results.back) {
          results.back = await tools.askBot.execute({ bot: name("Asker"), brief: "Ask the asker back." });
          results.onward = await tools.askBot.execute({ bot: name("Last"), brief: "Help with the plan." });
        }
        return { text: "Still thinking.", transcript: [] };
      }
      return { text: "Still thinking too.", transcript: [] };
    }
  }));
  const sent = await service.sendMessage(bots.Asker.id, { text: "Ask Middle for the plan", clientId: `lim-${Date.now()}` }, as(userId));
  await service.replyTo(bots.Asker.id, { afterMessageId: sent.messages[0].id }, undefined, as(userId));
  await settle(service, knex, [bots.Asker.id, bots.Middle.id, bots.Last.id]);
  assert.equal(results.first.status, "asked");
  assert.match(results.second.error, /already asked/u);
  assert.match(results.back.error, /already working on this job/u);
  assert.equal(results.onward.status, "asked", "passing it on a second time is allowed");
  const first = await knex("bot_requests").where({ from_bot_id: bots.Asker.id }).first();
  assert.equal(first.status, "failed", "a request that never answers stops after its turns");
  assert.equal(first.turns, 2);
  const onward = await knex("bot_requests").where({ from_bot_id: bots.Middle.id }).first();
  assert.equal(onward.depth, 1);
  assert.deepEqual(onward.chain.map(String), [String(bots.Asker.id), String(bots.Middle.id)]);
});

test("the person cancels a request; a late answer is ignored", async (context) => {
  const { knex, parts, as, userId, bots, name } = await setup(context, ["Asker", "Builder"]);
  let late = null;
  let cancelled = null;
  const service = createBotsService(serviceDoubles({
    knex,
    ...parts,
    approvals: { decide: async () => "allow" },
    requestLimits: FAST,
    reply: async (current, _history, tools, _state, prompt) => {
      if (String(current.id) === String(bots.Asker.id)) {
        if (!prompt) await tools.askBot.execute({ bot: name("Builder"), brief: "Make an app." });
        if (prompt.includes("cancelled")) cancelled = prompt;
        return { text: prompt.includes("cancelled") ? "Cancelled, as you asked." : "OK.", transcript: [] };
      }
      const request = await knex("bot_requests").where({ to_bot_id: bots.Builder.id }).first();
      await service.cancelRequest(request.id, as(userId));
      late = await tools.answerRequest.execute({ answer: "Too late." });
      return { text: "Hm.", transcript: [] };
    }
  }));
  const sent = await service.sendMessage(bots.Asker.id, { text: "Ask the Builder for an app", clientId: `c-${Date.now()}` }, as(userId));
  await service.replyTo(bots.Asker.id, { afterMessageId: sent.messages[0].id }, undefined, as(userId));
  await settle(service, knex, [bots.Asker.id, bots.Builder.id]);
  const request = await knex("bot_requests").where({ from_bot_id: bots.Asker.id }).first();
  assert.equal(request.status, "cancelled");
  assert.equal(request.answer, null);
  assert.equal(late.status, "closed");
  assert.ok(cancelled, "the asking bot hears it was cancelled");
  await assert.rejects(service.cancelRequest(request.id, as(userId + 999999)), /isn't yours/u);
});

test("a step whose server stopped is picked up by another server", async (context) => {
  const { knex, parts, as, userId, bots, name } = await setup(context, ["Asker", "Builder"]);
  const make = () => createBotsService(serviceDoubles({
    knex,
    ...parts,
    approvals: { decide: async () => "allow" },
    requestLimits: FAST,
    reply: async (current, _history, tools, _state, prompt) => {
      if (String(current.id) === String(bots.Builder.id)) {
        await tools.answerRequest.execute({ answer: "Made it." });
        return { text: "Sent.", transcript: [] };
      }
      if (!prompt) await tools.askBot.execute({ bot: name("Builder"), brief: "Make it." });
      return { text: "OK.", transcript: [] };
    }
  }));
  const first = make();
  const sent = await first.sendMessage(bots.Asker.id, { text: "Ask the Builder", clientId: `r-${Date.now()}` }, as(userId));
  await first.replyTo(bots.Asker.id, { afterMessageId: sent.messages[0].id }, undefined, as(userId));
  await first.drain(10000);
  // Pretend the first server took the next step and then stopped: its lease runs out.
  await knex("bot_requests").where({ from_bot_id: bots.Asker.id }).update({ status: "working", answer: null, next_step: "target_turn", lease_until: knex.raw("now() - interval '1 second'"), run_after: knex.fn.now() });
  await knex("agent_runs").whereIn("bot_id", [bots.Asker.id, bots.Builder.id]).del();
  const second = make();
  await settle(second, knex, [bots.Asker.id, bots.Builder.id]);
  const request = await knex("bot_requests").where({ from_bot_id: bots.Asker.id }).first();
  assert.equal(request.status, "done");
  assert.equal(request.answer, "Made it.");
});

test("a job is passed on at most twice, and a request past its time stops", async (context) => {
  const { knex, parts, as, userId, bots, name } = await setup(context, ["Asker", "Middle", "Last", "Extra"]);
  const results = {};
  const service = createBotsService(serviceDoubles({
    knex,
    ...parts,
    approvals: { decide: async () => "allow" },
    requestLimits: { ...FAST, turns: 1 },
    reply: async (current, _history, tools, _state, prompt) => {
      const is = (key) => String(current.id) === String(bots[key].id);
      if (is("Asker") && !prompt) results.first = await tools.askBot.execute({ bot: name("Middle"), brief: "Plan the week." });
      if (is("Middle") && !results.second) results.second = await tools.askBot.execute({ bot: name("Last"), brief: "Check the diary." });
      if (is("Last") && !results.third) results.third = await tools.askBot.execute({ bot: name("Extra"), brief: "And one more." });
      return { text: "Thinking.", transcript: [] };
    }
  }));
  const sent = await service.sendMessage(bots.Asker.id, { text: "Ask Middle to plan the week", clientId: `d-${Date.now()}` }, as(userId));
  await service.replyTo(bots.Asker.id, { afterMessageId: sent.messages[0].id }, undefined, as(userId));
  await settle(service, knex, Object.values(bots).map((bot) => bot.id));
  assert.equal(results.first.status, "asked");
  assert.equal(results.second.status, "asked", "passed on a second time");
  assert.match(results.third.error, /passed on as far as it can go/u, "but not a third");

  // A request whose 30 minutes ran out stops as Couldn't finish, and the asking bot hears so.
  const [late] = await knex("bot_requests").where({ from_bot_id: bots.Asker.id }).update({ status: "working", next_step: "target_turn", turns: 0, deadline_at: knex.raw("now() - interval '1 minute'"), lease_until: null, run_after: knex.fn.now() }).returning("*");
  await settle(service, knex, Object.values(bots).map((bot) => bot.id));
  assert.equal((await knex("bot_requests").where({ id: late.id }).first()).status, "failed");
  assert.equal((await card(knex, bots.Asker)).status, "failed");
});

test("an asked bot gets at most three questions back", async (context) => {
  const { knex, parts, as, userId, bots, name } = await setup(context, ["Asker", "Builder"]);
  const service = createBotsService(serviceDoubles({ knex, ...parts, approvals: { decide: async () => "allow" }, requestLimits: FAST, reply: async () => ({ text: "OK.", transcript: [] }) }));
  const fromRow = { ...bots.Asker, user_id: userId };
  const { request } = await service.requests.ask({ fromRow, name: name("Builder"), brief: "Make something." }, as(userId));
  await knex("bot_requests").where({ id: request.id }).update({ next_step: null });
  const answers = [];
  for (let count = 0; count < 4; count += 1) answers.push(await service.requests.askBack(request, `Question ${count + 1}?`, as(userId)));
  assert.deepEqual(answers.slice(0, 3).map((answer) => answer.status), ["asked", "asked", "asked"]);
  assert.match(answers[3].error, /enough questions/u);
  assert.equal((await knex("bot_requests").where({ id: request.id }).first()).questions, 3);
  await service.drain(10000);
});
