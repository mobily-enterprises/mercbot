import assert from "node:assert/strict";
import test from "node:test";
import { buildTools } from "../../packages/bots/src/server/botTools.js";
import { turnDoubles } from "../support/botDoubles.mjs";
import { memberOptions } from "../support/botRecords.mjs";
import { seedChat } from "../support/chatFixtures.mjs";
import { botsOf, homeOfPeople, startChatTurns } from "./turnKit.mjs";

// Bots asking bots (D-46, O22), against the disposable test database, with scripted replies in place of the model: a
// request goes to the other bot, which works on the brief alone, its answer comes back, questions go back and forth,
// the person approves anything a bot asked for, and the limits hold. What the asked bot posts and its cards are in the
// asking chat, where the request's one card shows it.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const FAST = { retryMs: 200, resumeMs: 200, nextTurnMs: 200 };

/**
 * Pat's home with Pat's bots of `names` (`${name} ${tag}`), and the turns, whose model is `options.reply`. The asking
 * chat is Pat's direct chat with the first bot, or, with `together`, a chat of Pat and every bot, where Pat names the
 * first: an asked bot in it has a seat there, so it can pass the job on.
 */
async function setup(context, names, { together = false, ...options }) {
  const kit = await startChatTurns(context, { requestLimits: FAST, ...options });
  const { homeId, people: [pat] } = await homeOfPeople(kit, ["Pat"]);
  const tag = Date.now().toString(36);
  const ids = await botsOf(kit, homeId, pat, names.map((key) => `${key} ${tag}`));
  const bots = Object.fromEntries(names.map((key, index) => [key, { id: ids[index] }]));
  const { id: chat, chatBotIds } = together
    ? await seedChat(kit.knex, { homeId, people: [pat], bots: ids })
    : await seedChat(kit.knex, { homeId, direct: { userId: pat, botId: ids[0] } });
  const seats = [...chatBotIds.values()];
  /** Pat says `text` to the first bot in the asking chat, and it answers. */
  async function ask(text) {
    const options = kit.as(pat, homeId);
    const sent = await kit.turns.chat.sendMessage(chat, { text: together ? `<@bot:${ids[0]}> ${text}` : text, clientId: `r-${Date.now()}-${Math.random()}` }, options);
    await kit.turns.chat.reply(chat, { afterMessageId: sent.messages.at(-1).id }, undefined, options);
  }
  return { ...kit, homeId, pat, bots, chat, seats, ask, as: kit.as(pat, homeId), name: (key) => `${key} ${tag}` };
}

// Every due step runs until nothing is left to do. A step due later (a short retry, the pause
// before the next turn, a lease running out) is waited for until the moment it can be claimed, by
// the database's clock (botRequests.js claim: run_after and lease_until past); 10 s of waiting in all.
async function settle({ turns, drain, knex, chat }) {
  let waited = 0;
  for (let round = 0; round < 40; round += 1) {
    await drain(10000);
    await turns.requests.runDue();
    await drain(10000);
    const { pending, ms } = await knex("bot_requests")
      .where({ conversation_id: chat })
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
  const stuck = await knex("bot_requests").where({ conversation_id: chat }).select("status", "next_step", "turns", "questions", "attempts", "last_error", "lease_until", "run_after");
  assert.fail(`requests didn't settle: ${JSON.stringify(stuck)}`);
}

/** What a bot last said in the asking chat. */
const lastText = async ({ knex, chat }, bot) =>
  (await knex("messages").where({ conversation_id: chat, kind: "text", role: "bot", author_bot_id: bot.id }).orderBy("id", "desc").first())?.body.text;
/** The first request's card in the asking chat: one card for it, there and nowhere else. */
const card = async ({ knex, chat }) => {
  const first = await knex("bot_requests").where({ conversation_id: chat }).orderBy("id").first();
  if (!first) return undefined;
  const cards = await knex("messages").where({ kind: "bot_request" }).whereRaw("body->>'requestId' = ?", [String(first.id)]);
  assert.ok(cards.length === 1 && String(cards[0].conversation_id) === chat, "one card, in the asking chat");
  return cards[0].body;
};
const requestOf = ({ knex, chat }, where = {}) => knex("bot_requests").where({ conversation_id: chat, ...where }).orderBy("id").first();

test("a bot asks another, waits, and carries on with its answer; the asking chat's card shows it", async (context) => {
  const prompts = [];
  const f = await setup(context, ["Asker", "Builder"], {
    reply: async (current, history, tools, _state, prompt) => {
      prompts.push([current.name, prompt, history]);
      if (String(current.id) === String(f.bots.Asker.id)) {
        if (prompt.includes("finished what you asked")) return { text: `Done: I used it. ${prompt.match(/"([^"]+)"\. Carry/u)?.[1]}`, transcript: [] };
        // "...made the app" reads as a claim, so the reply check sends it back, with only its note as the prompt.
        if (prompt.includes("Check from Mercbot")) return { text: "Done: I used it. I made the app Plant Watering.", transcript: [] };
        const asked = await tools.askBot.execute({ bot: f.name("Builder"), brief: "Make a small app to track plant watering, then tell me its name." });
        assert.equal(asked.status, "asked");
        return { text: "I've asked the Builder and will carry on when it answers.", transcript: [] };
      }
      assert.ok(prompt.includes("A request from your fellow bot"), "the asked bot gets the request");
      assert.ok(prompt.includes("isn't") && prompt.includes("own words"), "and is told it isn't the person's words");
      assert.ok(tools.answerRequest && tools.askBack, "with the tools to answer");
      await tools.answerRequest.execute({ answer: "I made the app Plant Watering." });
      return { text: "Sent it back.", transcript: [] };
    }
  });
  await f.ask("Get the Builder to make me a plant watering app");
  assert.equal((await card(f))?.side, "asker", "the asking bot's card shows at once");
  await settle(f);

  const request = await requestOf(f);
  assert.equal(String(request.to_bot_id), f.bots.Builder.id);
  assert.equal(request.status, "done");
  assert.equal(request.answer, "I made the app Plant Watering.");
  assert.equal((await card(f)).status, "done");
  // The asked bot worked on the brief alone (O22): none of the asking chat was in what it read.
  const builderTurns = prompts.filter(([name]) => name === f.name("Builder"));
  assert.ok(builderTurns.length && builderTurns.every(([, , history]) => !history.some((message) => /plant watering app/iu.test(message.body?.text || ""))));
  assert.equal(await lastText(f, f.bots.Builder), "Sent it back.", "what it said is in the asking chat, under its name");
  assert.match(await lastText(f, f.bots.Asker), /Done: I used it\. I made the app Plant Watering\./u);
  assert.equal(await f.knex("agent_runs").whereIn("conversation_id", f.seats).first(), undefined, "no turn is left claimed");
});

test("the asked bot puts a question back, the asking bot answers, and the work goes on", async (context) => {
  const f = await setup(context, ["Asker", "Builder"], {
    reply: async (current, _history, tools, _state, prompt) => {
      if (String(current.id) === String(f.bots.Asker.id)) {
        if (prompt.includes("asks about what you asked")) {
          assert.ok(tools.answerBot, "the asking bot can answer the question");
          await tools.answerBot.execute({ answer: "Green, please." });
          return { text: "Answered the Builder.", transcript: [] };
        }
        if (prompt.includes("finished what you asked")) return { text: "All done.", transcript: [] };
        await tools.askBot.execute({ bot: f.name("Builder"), brief: "Make a plant app in my favourite colour." });
        return { text: "Asked.", transcript: [] };
      }
      if (prompt.includes('answered your last question: "Green, please."')) {
        await tools.answerRequest.execute({ answer: "A green plant app." });
        return { text: "Finished.", transcript: [] };
      }
      await tools.askBack.execute({ question: "Which colour should it be?" });
      return { text: "I asked which colour.", transcript: [] };
    }
  });
  await f.ask("Have the Builder make a plant app");
  await settle(f);
  const request = await requestOf(f);
  assert.equal(request.status, "done");
  assert.equal(request.questions, 1);
  assert.equal(request.answer, "A green plant app.");
  assert.equal(await lastText(f, f.bots.Asker), "All done.");
});

test("work another bot asked for never counts as the person's own request", async () => {
  const seen = [];
  const approvals = {
    decide: async (_what, { reversible } = {}) => {
      seen.push(reversible);
      return reversible ? "allow" : "ask";
    }
  };
  const args = { title: "Lunch", start: "2026-11-02T12:00", guests: 0, account: "me@example.com", personAsked: true };
  const seat = { id: "3", workspace_id: "1", user_id: "7", chat_id: "5", chat_bot_id: "11", chat: { id: "5", kind: "public" } };
  const byPerson = buildTools(turnDoubles({ approvals, computer: null, seat }));
  const byBot = buildTools(turnDoubles({ approvals, computer: null, seat, viaBot: true, workingRequestId: "42" }));
  await assert.rejects(byPerson.attempt("delete_calendar_event", args), "the person's own request runs (and fails here without a calendar)");
  const parked = await byBot.attempt("delete_calendar_event", args);
  assert.deepEqual(seen, [true, false], "the same request is only reversible when the person asked");
  assert.equal(parked.status, "waiting_for_approval");
  assert.equal(byBot.after[0].body.requestId, "42", "the card belongs to the request");
  const sending = await byBot.tools.sendDraft?.execute({});
  if (sending) assert.match(sending.error, /Only the person can send/u);
});

test("an approval asked during a request waits for the person, then the work carries on", async (context) => {
  let builderTurns = 0;
  const f = await setup(context, ["Asker", "Builder"], {
    together: true,
    approvals: { decide: async () => "ask" },
    reply: async (current, _history, tools, _state, prompt) => {
      if (String(current.id) === String(f.bots.Asker.id)) {
        if (!prompt) await tools.askBot.execute({ bot: f.name("Builder"), brief: "Set up a daily 9am check of the plants." });
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
  });
  await f.ask("Ask the Builder for a daily plant check");
  await settle(f);
  let request = await requestOf(f);
  assert.equal(request.status, "waiting_approval");
  assert.equal((await card(f)).status, "waiting_approval");
  // The asked bot's approval card is in the asking chat, for Pat (R4).
  const approval = await f.knex("messages").where({ conversation_id: f.chat, kind: "choice", author_bot_id: f.bots.Builder.id }).orderBy("id", "desc").first();
  assert.equal(approval.body.requestId, String(request.id));
  assert.equal(approval.body.for.id, f.pat);
  await f.turns.chat.answerChoice(f.chat, String(approval.id), [approval.body.options[0]], f.as);
  await settle(f);
  request = await requestOf(f, { id: request.id });
  assert.equal(request.status, "done");
  assert.equal(builderTurns, 2);
});

test("limits: no asking a bot already in the job, no second open request, and turns run out", async (context) => {
  const results = {};
  const f = await setup(context, ["Asker", "Middle", "Last"], {
    together: true,
    requestLimits: { ...FAST, turns: 2 },
    reply: async (current, _history, tools, _state, prompt) => {
      if (String(current.id) === String(f.bots.Asker.id)) {
        if (!prompt) {
          results.first = await tools.askBot.execute({ bot: f.name("Middle"), brief: "Find out the plan." });
          results.second = await tools.askBot.execute({ bot: f.name("Middle"), brief: "And another thing." });
        }
        return { text: "OK.", transcript: [] };
      }
      if (String(current.id) === String(f.bots.Middle.id)) {
        if (!results.back) {
          results.back = await tools.askBot.execute({ bot: f.name("Asker"), brief: "Ask the asker back." });
          results.onward = await tools.askBot.execute({ bot: f.name("Last"), brief: "Help with the plan." });
        }
        return { text: "Still thinking.", transcript: [] };
      }
      return { text: "Still thinking too.", transcript: [] };
    }
  });
  await f.ask("Ask Middle for the plan");
  await settle(f);
  assert.equal(results.first.status, "asked");
  assert.match(results.second.error, /already asked/u);
  assert.match(results.back.error, /already working on this job/u);
  assert.equal(results.onward.status, "asked", "passing it on a second time is allowed");
  const [asker, middle] = f.seats;
  const first = await requestOf(f, { from_chat_bot_id: asker });
  assert.equal(first.status, "failed", "a request that never answers stops after its turns");
  assert.equal(first.turns, 2);
  const onward = await requestOf(f, { from_chat_bot_id: middle });
  assert.equal(onward.depth, 1);
  assert.deepEqual(onward.chain.map(String), [f.bots.Asker.id, f.bots.Middle.id]);
});

test("an asked bot outside the asking chat can't pass the job on", async (context) => {
  let onward = null;
  const f = await setup(context, ["Asker", "Middle", "Last"], {
    reply: async (current, _history, tools, _state, prompt) => {
      if (String(current.id) === String(f.bots.Asker.id)) {
        if (!prompt) await tools.askBot.execute({ bot: f.name("Middle"), brief: "Find out the plan." });
        return { text: "OK.", transcript: [] };
      }
      if (String(current.id) === String(f.bots.Middle.id) && !onward) {
        onward = await tools.askBot.execute({ bot: f.name("Last"), brief: "Help with the plan." });
        await tools.answerRequest.execute({ answer: "The plan is Friday." });
      }
      return { text: "Done.", transcript: [] };
    }
  });
  await f.ask("Ask Middle for the plan");
  await settle(f);
  assert.match(onward.error, /can't pass this on from here/u, "it has no seat to ask from: its request would be no chat's");
  assert.equal(await f.knex("bot_requests").where({ to_bot_id: f.bots.Last.id }).first(), undefined);
});

test("the person cancels a request; a late answer is ignored", async (context) => {
  let late = null;
  let cancelled = null;
  const f = await setup(context, ["Asker", "Builder"], {
    reply: async (current, _history, tools, _state, prompt) => {
      if (String(current.id) === String(f.bots.Asker.id)) {
        if (!prompt) await tools.askBot.execute({ bot: f.name("Builder"), brief: "Make an app." });
        if (prompt.includes("cancelled")) cancelled = prompt;
        return { text: prompt.includes("cancelled") ? "Cancelled, as you asked." : "OK.", transcript: [] };
      }
      const request = await requestOf(f);
      await f.turns.cancelRequest(request.id, f.as);
      late = await tools.answerRequest.execute({ answer: "Too late." });
      return { text: "Hm.", transcript: [] };
    }
  });
  await f.ask("Ask the Builder for an app");
  await settle(f);
  const request = await requestOf(f);
  assert.equal(request.status, "cancelled");
  assert.equal(request.answer, null);
  assert.equal(late.status, "closed");
  assert.ok(cancelled, "the asking bot hears it was cancelled");
  // Someone else in the home can't cancel Pat's request.
  const { people: [kim] } = await homeOfPeople(f, ["Kim"]);
  await f.knex("workspace_memberships").insert({ workspace_id: f.homeId, user_id: kim, role_sid: "member", status: "active" });
  await assert.rejects(f.turns.cancelRequest(request.id, memberOptions({ userId: kim, homeId: f.homeId })), /isn't yours/u);
});

test("a step whose server stopped is picked up by another server", async (context) => {
  const f = await setup(context, ["Asker", "Builder"], {
    reply: async (current, _history, tools, _state, prompt) => {
      if (String(current.id) === String(f.bots.Builder.id)) {
        await tools.answerRequest.execute({ answer: "Made it." });
        return { text: "Sent.", transcript: [] };
      }
      if (!prompt) await tools.askBot.execute({ bot: f.name("Builder"), brief: "Make it." });
      return { text: "OK.", transcript: [] };
    }
  });
  await f.ask("Ask the Builder");
  await f.drain(10000);
  // Pretend the first server took the next step and then stopped: its lease runs out.
  await f.knex("bot_requests").where({ conversation_id: f.chat }).update({ status: "working", answer: null, next_step: "target_turn", lease_until: f.knex.raw("now() - interval '1 second'"), run_after: f.knex.fn.now() });
  await f.knex("agent_runs").whereIn("conversation_id", f.seats).del();
  await settle(f);
  const request = await requestOf(f);
  assert.equal(request.status, "done");
  assert.equal(request.answer, "Made it.");
});

test("a job is passed on at most twice, and a request past its time stops", async (context) => {
  const results = {};
  const f = await setup(context, ["Asker", "Middle", "Last", "Extra"], {
    together: true,
    requestLimits: { ...FAST, turns: 1 },
    reply: async (current, _history, tools, _state, prompt) => {
      const is = (key) => String(current.id) === String(f.bots[key].id);
      if (is("Asker") && !prompt) results.first = await tools.askBot.execute({ bot: f.name("Middle"), brief: "Plan the week." });
      if (is("Middle") && !results.second) results.second = await tools.askBot.execute({ bot: f.name("Last"), brief: "Check the diary." });
      if (is("Last") && !results.third) results.third = await tools.askBot.execute({ bot: f.name("Extra"), brief: "And one more." });
      return { text: "Thinking.", transcript: [] };
    }
  });
  await f.ask("Ask Middle to plan the week");
  await settle(f);
  assert.equal(results.first.status, "asked");
  assert.equal(results.second.status, "asked", "passed on a second time");
  assert.match(results.third.error, /passed on as far as it can go/u, "but not a third");

  // A request whose 30 minutes ran out stops as Couldn't finish, and the asking bot hears so.
  const [late] = await f.knex("bot_requests").where({ conversation_id: f.chat, from_chat_bot_id: f.seats[0] }).update({ status: "working", next_step: "target_turn", turns: 0, deadline_at: f.knex.raw("now() - interval '1 minute'"), lease_until: null, run_after: f.knex.fn.now() }).returning("*");
  await settle(f);
  assert.equal((await requestOf(f, { id: late.id })).status, "failed");
  const lateCard = await f.knex("messages").where({ conversation_id: f.chat, kind: "bot_request" }).whereRaw("body->>'requestId' = ?", [String(late.id)]).first();
  assert.equal(lateCard.body.status, "failed", "its card in the asking chat says so");
});

test("an asked bot gets at most three questions back", async (context) => {
  const answers = [];
  const f = await setup(context, ["Asker", "Builder"], {
    reply: async (current, _history, tools, _state, prompt) => {
      if (String(current.id) === String(f.bots.Asker.id)) {
        if (!prompt) await tools.askBot.execute({ bot: f.name("Builder"), brief: "Make something." });
        return { text: "OK.", transcript: [] };
      }
      if (!answers.length) {
        for (let count = 0; count < 4; count += 1) answers.push(await tools.askBack.execute({ question: `Question ${count + 1}?` }));
      }
      return { text: "Asked.", transcript: [] };
    }
  });
  await f.ask("Ask the Builder for something");
  await settle(f);
  assert.deepEqual(answers.slice(0, 3).map((answer) => answer.status), ["asked", "asked", "asked"]);
  assert.match(answers[3].error, /enough questions/u);
  assert.equal((await requestOf(f)).questions, 3);
});
