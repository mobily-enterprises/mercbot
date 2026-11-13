// Mercbot's stand-in model: a local stand-in for every kind of AI (D-72), answering deterministically, so nothing a test
// copy asks of its AI reaches a provider and nothing waits on a real call failing (D-83). Every Preview and Test Preview
// runs on it (previewAi.mjs, from bin/develop.js and tests/support/start-test-app.mjs), and so does the bot templates'
// end-to-end check in the database suite (tests/server/templateCheck.integration.js). It lives in tools/, which a
// composition of Mercbot keeps, so a Preview of one runs on it too. startStandInModel() serves it on a local port; with
// MERCBOT_TEST_AI_URL naming that address, the app sends every kind's requests there instead of to its provider
// (outside production and the live copy, packages/account/src/server/providers/index.js), through Mercbot's own
// provider layers, metering and agent loop. A text kind's chat API (/<kind>/chat/completions) gets an OpenAI-style
// answer, streamed when asked for; the images kind's Gemini API (/images/models/<model>:generateContent) gets a small
// picture, or the contact details it was asked to read.
//
// It answers Mercbot's own one-shot writing (botWriting.js, approvals.js) in the shape each asks for: a new bot's
// greeting and its first question card, a message's status line, which rules apply. It plays a template's bot by its
// setup interview: on the person's first answer it reads the skill, then asks each "Ask" step in turn (on a question
// card when the step says so), then saves a memory, creates the template's routines paused and asks whether to start
// them, and starts them only on a yes. It plays the template check's person and judge (tests/support/templateCheck.mjs)
// and Mercbot's own checks too; any other bot says the copy runs on a stand-in model. `misbehave` makes a template's bot
// break a rule on purpose, to prove the check catches it: "skip-question" leaves out its second question,
// "routine-running" creates its routines running, and "send" has something sent as the setup ends (the test copy's line
// for it, D-69, written by the stand-in itself, since the check's home has no app to send through).
import { createServer } from "node:http";
import { logSimulatedSideEffect } from "@jskit-ai/kernel/server/runtime/sideEffects";
import { GALLERY, setupSkillOf } from "@local/bots/server/templates";

/** What the template check's person player answers once the setup is over (tests/support/templateCheck.mjs). */
export const DONE = "[DONE]";
// The first line of each of the template check's players' instructions, which the stand-in recognises.
export const PERSON_PLAYER = "You play a person trying out a new Mercbot bot, in its setup interview.";
export const JUDGE = "You check a Mercbot bot's setup interview against the questions it must ask.";
// The picture the images kind draws: the smallest PNG there is, one transparent pixel.
const PICTURE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

/** The questions a template's setup interview must ask: its numbered steps that start with "Ask". */
export function setupQuestions(template) {
  return setupSkillOf(template).instructions.split("\n")
    .filter((line) => /^\d+\.\s+Ask\b/u.test(line))
    .map((line) => line.replace(/^\d+\.\s*/u, ""));
}

const STATE_NOTE = "Current state, from the system";
// Mercbot's own one-shot writing (packages/bots/src/server/botWriting.js and approvals.js), known by its instructions.
const GREETING = /^You are (.+), a brand-new personal assistant bot in Mercbot\./u;
const FIRST_QUESTION = "You write one short question card for a new assistant bot.";
const ACTIVITY = "You label what an assistant is about to do";
const RULE_MATCHER = "You decide which of a person's plain-language rules apply";

/** A message's words, whether its content is a string or a list of parts. */
const textOf = (content) => (typeof content === "string" ? content : (content || []).map((part) => part.text || "").join(""));

/** What a setup step asks, as a short question. */
export function questionOf(step) {
  const asked = step
    .replace(/^Ask\s+(?:them\s+|the person\s+)?(?:with a question card\s+)?(?:about\s+)?/iu, "")
    .split(/\s*\(|[.:;]\s/u)[0]
    .replace(/[.?]$/u, "")
    .trim();
  const question = `${asked.charAt(0).toUpperCase()}${asked.slice(1)}?`;
  return question.length > 150 ? `${question.slice(0, 148).trim()}?` : question;
}

/** The answers a question card offers for a step: the weekdays, its examples in brackets, or a plain choice. */
function optionsOf(step) {
  if (/Monday to (?:Friday|Sunday)/u.test(step)) return ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  const listed = /\(([^)]*)\)/u.exec(step)?.[1].replace(/^for example\s+/iu, "").split(/,\s*|\s+or\s+/u).map((option) => option.trim())
    .filter((option) => option && option.length <= 60 && !/allowed|several/iu.test(option)) || [];
  return listed.length >= 2 ? listed.slice(0, 5) : ["Yes", "No", "Not sure"];
}

/** One step of a stand-in reply: words to say, or a tool to call. */
const say = (text) => ({ text });
const call = (tool, args) => ({ tool, args });

/** The bot's next step in its setup interview, from where the conversation is. */
function botStep(template, request, misbehave) {
  const conversation = request.messages.filter((message) => message.role !== "system" && !(message.role === "user" && textOf(message.content).startsWith(STATE_NOTE)));
  const lastPerson = conversation.findLastIndex((message) => message.role === "user");
  const stepsDone = conversation.slice(lastPerson + 1).filter((message) => message.role === "assistant" && message.tool_calls?.length).length;
  const answers = conversation.filter((message) => message.role === "user").length;
  const questions = setupQuestions(template).filter((_, at) => !(misbehave === "skip-question" && at === 1));
  const routines = template.routines.map((routine) => routine.name);
  let plan;
  if (answers <= questions.length) {
    const step = questions[answers - 1];
    const card = /question card/iu.test(step);
    plan = [
      ...(answers === 1 ? [call("read_skill", { acknowledgement: "Reading my setup interview.", name: setupSkillOf(template).name })] : []),
      ...(card ? [call("ask_with_options", { question: questionOf(step), options: optionsOf(step), multi: /several|any that/iu.test(step) }), say("Tap what fits, or write your own answer.")] : [say(questionOf(step))])
    ];
  } else if (answers === questions.length + 1) {
    plan = [
      call("remember", { fact: `${template.name}'s setup is done: ${questions.length} questions answered.` }),
      ...routines.map((name) => call("create_routine", {
        acknowledgement: `Setting up "${name}".`,
        name,
        schedule: "Every Monday around 9:00 (Europe/London)",
        cron: "0 9 * * 1",
        timezone: "Europe/London",
        instructions: `Do ${template.name}'s regular job from the saved facts, save it and say it's ready.`,
        ...(misbehave === "routine-running" ? {} : { paused: true })
      })),
      {
        ...say(routines.length
          ? `Thanks, that's everything I need. "${routines.join("\" and \"")}" is set up but paused: it won't run until you say so. Shall I start it?`
          : "Thanks, that's everything I need. Send me something whenever you're ready."),
        ...(misbehave === "send" ? { sends: true } : {})
      }
    ];
  } else {
    const words = textOf(conversation[lastPerson]?.content);
    const yes = /\b(?:yes|start|go ahead)\b/iu.test(words) && !/\b(?:not yet|no|don't|paused)\b/iu.test(words);
    plan = yes && routines.length
      ? [...routines.map((name) => call("update_routine", { acknowledgement: `Starting "${name}".`, routine: name, running: true })), say("Started.")]
      : [say(routines.length ? "All right: it stays paused until you say so." : "All right.")];
  }
  return plan[Math.min(stepsDone, plan.length - 1)];
}

/** The template check's person: a yes to the interview, plain answers, the first option on a card, "not yet" to starting. */
function personStep(request) {
  const asked = textOf(request.messages.at(-1)?.content);
  if (/Reply with the options you pick/u.test(asked)) return say(/^Options:\n1\. (.*)$/mu.exec(asked)?.[1] || "Yes");
  // What the bot said since the person last spoke, without Mercbot's own lines.
  const conversation = asked.split("\n\nWrite your next message")[0];
  const latest = conversation.slice(Math.max(conversation.lastIndexOf("\nPerson: "), conversation.lastIndexOf("\nPerson picks: "), 0))
    .split("\n").filter((line) => line && !line.startsWith("Person") && !line.startsWith("(")).join("\n");
  if (/\bstart (?:it|them)\b/iu.test(latest)) return say("Not yet, please leave it paused.");
  if (!latest.includes("?")) return say(DONE);
  return say("For that: we keep it simple, the usual for a small household like ours.");
}

/**
 * The template check's judge: a question was asked when the bot's words hold the question the stand-in asks for it,
 * with a reason for each, as a real judge gives them.
 */
function judgeStep(request) {
  const asked = textOf(request.messages.at(-1)?.content);
  const [questionsPart, conversation = ""] = asked.split("\n\nConversation:\n");
  const questions = questionsPart.split("\n").filter((line) => /^\d+\. /u.test(line)).map((line) => line.replace(/^\d+\.\s*/u, ""));
  const botWords = conversation.split("\n").filter((line) => !line.startsWith("Person")).join("\n");
  const found = questions.map((question) => botWords.includes(questionOf(question)));
  const why = found.map((was) => (was ? "The bot asked it in its own words." : "The bot never asked it and went on to its next question."));
  return say(JSON.stringify({ asked: found, why }));
}

/** What the stand-in answers a request with: one step of a reply. */
function answerFor(request, misbehave) {
  const system = request.messages.filter((message) => message.role === "system").map((message) => textOf(message.content)).join("\n\n");
  if (system.includes(PERSON_PLAYER)) return personStep(request);
  if (system.includes(JUDGE)) return judgeStep(request);
  // The agent loop's check of a reply's claims (@jskit-ai/agent): nothing unsupported.
  if (system.includes("{\"unsupported\"")) return say("{\"unsupported\": []}");
  // A new bot's greeting and its first question card, a message's status line (no reaction) and the rules that apply.
  const greeting = GREETING.exec(system);
  if (greeting) {
    const person = /first message to (.+?):/u.exec(textOf(request.messages.at(-1)?.content))?.[1] || "there";
    return say(`Hi ${person}, I'm ${greeting[1]}. This copy runs on a stand-in model, so my answers here are placeholders.`);
  }
  if (system.includes(FIRST_QUESTION)) return say(JSON.stringify({ question: "What should I help with first?", options: ["Plan a trip", "Watch a price", "Sort out my email"] }));
  if (system.includes(ACTIVITY)) return say(JSON.stringify({ status: "Thinking it over", emoji: null }));
  if (system.includes(RULE_MATCHER)) return say(JSON.stringify({ matches: [] }));
  const template = request.tools?.length ? GALLERY.find((entry) => system.includes(entry.instructions)) : null;
  if (template) return botStep(template, request, misbehave[template.slug]);
  return say(request.tools?.length ? "This copy runs on a stand-in model, which only plays the bot templates' setup interviews." : "Done.");
}

let calls = 0;

/** The provider's answer for one step, in the OpenAI chat format, streamed when the request asks. */
function respond(request, step) {
  const id = `stand-in-${(calls += 1)}`;
  const created = Math.floor(Date.now() / 1000);
  const toolCalls = step.tool
    ? [{ id: `call_${id}`, type: "function", function: { name: toolName(request, step.tool), arguments: JSON.stringify(step.args) } }]
    : [];
  const finish = toolCalls.length ? "tool_calls" : "stop";
  const usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 };
  if (!request.stream) {
    const message = { role: "assistant", content: step.text ?? "", ...(toolCalls.length ? { tool_calls: toolCalls } : {}) };
    return Response.json({ id, object: "chat.completion", created, model: "stand-in", choices: [{ index: 0, message, finish_reason: finish }], usage });
  }
  const chunk = (delta, finishReason = null, extra = {}) => ({ id, object: "chat.completion.chunk", created, model: "stand-in", choices: [{ index: 0, delta, finish_reason: finishReason }], ...extra });
  const chunks = [
    ...(step.text ? [chunk({ role: "assistant", content: step.text })] : []),
    ...toolCalls.map((toolCall, index) => chunk({ role: "assistant", tool_calls: [{ index, ...toolCall }] })),
    chunk({}, finish, { usage })
  ];
  const body = `${chunks.map((part) => `data: ${JSON.stringify(part)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** A tool's name as this request offers it (by its id, however the loop spells it). */
function toolName(request, id) {
  const plain = (name) => name.replace(/[_-]/gu, "").toLowerCase();
  const offered = (request.tools || []).map((tool) => tool.function?.name).find((name) => name && plain(name) === plain(id));
  if (!offered) throw new Error(`The stand-in model wanted ${id}, which this reply doesn't offer.`);
  return offered;
}

/**
 * What the images kind's Gemini API answers: a small picture when it's asked to draw one, otherwise the fields its
 * schema names, read from the photo as a made-up contact.
 * @param {any} request
 */
function picturesAnswer(request) {
  if (request.generationConfig?.responseModalities?.includes("IMAGE")) {
    const parts = [{ inlineData: { mimeType: "image/png", data: PICTURE.toString("base64") } }];
    return { candidates: [{ content: { parts } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 1290 } };
  }
  const fields = Object.keys(request.generationConfig?.responseSchema?.properties || {});
  const read = Object.fromEntries(fields.map((field) => [field, field === "fullName" ? "Sam Example" : ""]));
  return { candidates: [{ content: { parts: [{ text: JSON.stringify(read) }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 } };
}

/**
 * The stand-in's answer to one request for `kind`: a text kind's chat API or the images kind's Gemini API; anything
 * else is a 404 saying what was asked.
 * @param {{ method: string, path: string, kind: string, body: string }} asked
 * @param {object[]} requests where each request is kept, with its kind
 * @param {Record<string, string>} misbehave
 */
function answerRequest({ method, path, kind, body }, requests, misbehave) {
  if (method === "POST" && path.endsWith("/chat/completions")) {
    const request = JSON.parse(body);
    requests.push({ kind, ...request });
    const step = answerFor(request, misbehave);
    if (step.sends) logSimulatedSideEffect(console, { kind: "email", summary: "the stand-in bot's email to someone@example.com" });
    return respond(request, step);
  }
  if (method === "POST" && path.endsWith(":generateContent")) {
    const request = JSON.parse(body);
    requests.push({ kind, ...request });
    return Response.json(picturesAnswer(request));
  }
  return Response.json({ error: { message: `The stand-in model doesn't answer ${method} ${path}.` } }, { status: 404 });
}

/**
 * Serves the stand-in on a local port until `stop()`. Point MERCBOT_TEST_AI_URL at `url`, and every kind of AI's
 * requests come here, under /<kind>; `requests` keeps each, with its `kind`.
 * @param {{ misbehave?: Record<string, "skip-question" | "routine-running" | "send"> }} [options]
 */
export async function startStandInModel({ misbehave = {} } = {}) {
  const requests = [];
  const server = createServer((incoming, outgoing) => {
    const chunks = [];
    incoming.on("data", (chunk) => chunks.push(chunk));
    incoming.on("end", async () => {
      const path = new URL(incoming.url, "http://stand-in").pathname;
      let response;
      try {
        response = answerRequest({ method: incoming.method, path, kind: path.split("/")[1], body: Buffer.concat(chunks).toString("utf8") }, requests, misbehave);
      } catch (error) {
        response = Response.json({ error: { message: `The stand-in model failed: ${error.message}` } }, { status: 500 });
      }
      outgoing.writeHead(response.status, { "content-type": response.headers.get("content-type") || "application/json" });
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    });
  });
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    stop: () => new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    })
  };
}
