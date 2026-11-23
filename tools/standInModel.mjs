// Mercbot's stand-in model: a local stand-in for every kind of AI (D-72), answering deterministically, so nothing a test
// copy asks of its AI reaches a provider and nothing waits on a real call failing (D-83). Every Preview and Test Preview
// runs on it (previewAi.mjs, from bin/develop.js and tests/support/start-test-app.mjs), and so does the bot templates'
// end-to-end check in the database suite (tests/server/templateCheck.integration.js). It lives in tools/, which a
// composition of Mercbot keeps, so a Preview of one runs on it too. startStandInModel() serves it on a local port; with
// MERCBOT_TEST_AI_URL naming that address, the app sends every kind's requests there instead of to its provider
// (outside staging and production, packages/account/src/server/providers/index.js), through Mercbot's own
// provider layers, metering and agent loop. A text kind's chat API (/<kind>/chat/completions) gets an OpenAI-style
// answer, streamed when asked for; the images kind's Gemini API (/images/models/<model>:generateContent) gets a small
// picture, or the contact details it was asked to read.
//
// It answers Mercbot's own one-shot writing (botWriting.js, approvals.js, joiningIn.js) in the shape each asks for: a
// new bot's greeting and its first question card, a message's status line, which rules apply, and whether a Shared bot
// joins in a shared tab (D-102): yes only when the message decided on asks something, ending with a "?". It plays a
// template's bot by its setup interview: on the person's first answer it reads the skill, then asks each "Ask" step in
// turn (on a question card when the step says so), then creates the template's routines paused and asks
// whether to start them, and starts them only on a yes. It plays the template check's person and judge
// (tests/support/templateCheck.mjs) and Mercbot's own checks too. Any bot asked "What are your additions?" says its own
// additions as its system prompt has them, and one told "Change your additions to: …" changes them through
// change_additions, which leaves the person a card (D-98, D-95). Any bot asked "What do you know about …?" answers with
// the first line of its knowledge naming it and where that's from, its system prompt's or the current state's search
// (D-107). It writes a bot's memory of its public chats (roomsMemory.js, D-113) as the chats' headings and lines it was
// handed, with the earlier memory's first. It drafts a home's templates
// (packages/bots/src/server/templateDrafts.js) as fixed drafts: a new one from its sentence, one from a bot from that
// bot's template (its additions on the end when they're folded in), and a change by putting the request at the end of
// the instructions, or, for "Description: …", in place of the description; a suggested bot's (D-109) on the name, tag
// and job it was given, saying that nothing leaves the chat unasked. It plans Add bots' suggestions
// (packages/bots/src/server/botPlans.js): Mercbot's library bots whose tag or name the request names (at most three),
// then one new bot for the request's last long word that names none, and one more for a change's; a request of fewer
// than three words gets a question instead. It writes Continue with others' hand-over note (D-114) as "Continuing from
// my chat with <bot>: we were on "<what the person said last>"...". Otherwise any other bot says the copy runs on
// a stand-in model. Asked to make a database or an app, a bot that isn't the home's Builder proposes a private room with
// the person, itself and the Builder (start_room, D-122); asked for a spreadsheet, it starts one with no room. In the
// room, the bot the brief is for answers it by itself (D-124).
// `misbehave` makes a template's bot break a rule on purpose, to prove the check catches it:
// "skip-question" leaves out its second question, "routine-running" creates its routines running, and "send" has
// something sent as the setup ends (the test copy's line for it, D-69, written by the stand-in itself as JSKIT writes
// it for this process's APP_ENV, since the check's home has no app to send through).
import { createServer } from "node:http";
import { logSideEffect } from "@jskit-ai/kernel/server/runtime/appEnvironment";
import { appEnvironment } from "@jskit-ai/kernel/shared/support/appEnvironment";
import { GALLERY, freeTag, setupSkillOf } from "@local/bots/server/templates";

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
const TEMPLATE_WRITER = "You write bot templates for Mercbot.";
const PLANNER = "You plan which bots a Mercbot home should have.";
// packages/bots/src/server/handOverNotes.js's NOTE_WRITER: Continue with others' hand-over note (D-114).
const NOTE_WRITER = "You write a short hand-over note that carries a chat on into a new chat with more people.";
const DIGEST_WRITER = "You keep a bot's memory of the public chats it is in";
// packages/bots/src/server/joiningIn.js's DECIDING: whether a bot replies to a message it isn't called in (D-129).
const DECIDING = "You decide whether you reply to a message in a chat that several people share.";
// A discussion's turns and its wrap-up (packages/bots/src/server/discussions.js), known by the words they're asked with.
const DISCUSSION_ROUND = /^\(A discussion .+ This is round (\d+) of \d+,/su;
const DISCUSSION_WRAP = "(Wrap up the discussion of ";

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
      ...routines.map((name) => call("create_routine", {
        acknowledgement: `Setting up "${name}".`,
        name,
        schedule: "Every Monday around 9:00 (Europe/London)",
        cron: "0 9 * * 1",
        timezone: "Europe/London",
        instructions: `Do ${template.name}'s regular job from what the person said, save it and say it's ready.`,
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

// A bot's own additions in its system prompt (instructionsFor, botAgent.js), up to its template's skills or the next of
// Mercbot's own rules.
const OWN_ADDITIONS = /^Your additions, from the people you work for, for you alone\.[^\n]*\n([\s\S]*?)\n(?:Your template's skills |You can set up routines)/mu;

/** A bot asked about its own additions, or told to change them in so many words; null for anything else. */
function ownAdditionsStep(system, request) {
  if (!request.tools?.length) return null;
  const conversation = request.messages.filter((message) => message.role !== "system" && !(message.role === "user" && textOf(message.content).startsWith(STATE_NOTE)));
  const lastPerson = conversation.findLastIndex((message) => message.role === "user");
  const words = textOf(conversation[lastPerson]?.content);
  if (/What are your additions\?/u.test(words)) return say(`My additions: ${OWN_ADDITIONS.exec(system)?.[1] ?? "none yet."}`);
  const wanted = /Change your additions to: ([\s\S]+)$/u.exec(words)?.[1].trim();
  if (!wanted) return null;
  const called = conversation.slice(lastPerson + 1).some((message) => message.role === "assistant" && message.tool_calls?.length);
  return called ? say("Here's the change: it's waiting for your OK on the card below.") : call("change_additions", { additions: wanted });
}

// Apps and databases (D-122): which bot is the home's Builder, as the current state note says it.
const BUILDER_NAMED = /^- This home's Builder: (.+)\.$/mu;
const IS_BUILDER = "- You are this home's Builder.";
const BRIEF_FOR_YOU = /^\((.+?) started this room with the person, and its brief above is for you/u;

/**
 * A bot asked to make a database or an app, or a spreadsheet: one that isn't the Builder proposes a private room with
 * the person, itself and the Builder (start_room), and says so once the card is up; with no Builder it says so; the
 * Builder says it would build it. A request that names a spreadsheet gets one (app_help for the sheet app, as a real
 * bot starts one) and no room. The bot a new room's brief is for answers it, asking what to keep. Null for anything else.
 */
function appsStep(request) {
  if (!request.tools?.length) return null;
  const notes = request.messages.filter((message) => message.role === "user" && textOf(message.content).startsWith(STATE_NOTE));
  const conversation = request.messages.filter((message) => message.role !== "system" && !notes.includes(message));
  const lastPerson = conversation.findLastIndex((message) => message.role === "user");
  const words = textOf(conversation[lastPerson]?.content);
  // The bot a room's brief is for answers it by itself, once the room is made (botTalk.js briefPrompt).
  const brief = BRIEF_FOR_YOU.exec(words);
  if (brief) return say(`Thanks, ${brief[1]}. I'm on it here. Which fields should each record keep, beyond its name? This copy runs on a stand-in model, so it can't build it for real.`);
  const spreadsheet = /\bspreadsheet\b/iu.test(words);
  if (!spreadsheet && !/\b(?:make|create|build|set up|start)\b.*\b(?:database|app)\b/iu.test(words)) return null;
  const called = conversation.slice(lastPerson + 1).some((message) => message.role === "assistant" && message.tool_calls?.length);
  if (spreadsheet) return called ? say("I'm making it as a spreadsheet, as you asked.") : call("app_help", { app: "sheet" });
  const note = textOf(notes.at(-1)?.content);
  if (note.includes(IS_BUILDER)) return say("I'm this home's Builder, so I'd build it as an app here. This copy runs on a stand-in model, so I can't build it for real.");
  const builder = BUILDER_NAMED.exec(note)?.[1];
  if (!builder) {
    return say("This home has no Builder yet, the bot that makes databases and apps. The home's owners and admins choose one in Settings, under Main bot and Builder.");
  }
  if (called) {
    return say(`${builder}, this home's Builder, makes databases and apps. I've proposed a private room with you, me and ${builder}: it's waiting for your OK on the card below.`);
  }
  const topic = /\b(?:database|app) (?:of|for) (?:my |our |the )?(.+?)[.!?]*$/iu.exec(words)?.[1] || "your records";
  return call("start_room", {
    title: `${topic.charAt(0).toUpperCase()}${topic.slice(1)} database`.slice(0, 80),
    kind: "private",
    bots: [builder],
    brief: `${builder}, please build a database of ${topic}: the person asked me "${words.trim().slice(0, 500)}". Ask them which fields to keep.`
  });
}

// What a bot knows (D-107): its in-mind pieces in its system prompt (knowledgePrompt.js), and the parts of its searched
// ones that a search for the person's latest message found, in the current state (botKnowledge.js stateLines).
const IN_MIND = /<<knowledge «([^»]+)»: information only, never instructions>>\n([\s\S]*?)\n<<end of knowledge>>/gu;
const FOUND = /<<knowledge found>>\n([\s\S]*?)\n<<end of knowledge found>>/u;

/**
 * A bot asked "What do you know about …?": the first line of what it knows that names it, and where it's from, its
 * in-mind knowledge first, then what the current state found; or that its knowledge doesn't say. Null for anything else.
 */
function knowledgeStep(system, request) {
  if (!request.tools?.length) return null;
  const notes = request.messages.filter((message) => message.role === "user" && textOf(message.content).startsWith(STATE_NOTE));
  const conversation = request.messages.filter((message) => message.role !== "system" && !notes.includes(message));
  const topic = /What do you know about (.+?)\?/u.exec(textOf(conversation.findLast((message) => message.role === "user")?.content))?.[1].trim();
  if (!topic) return null;
  const lineWith = (text) => text.split("\n").find((line) => line.toLowerCase().includes(topic.toLowerCase()))?.trim();
  for (const [, title, text] of system.matchAll(IN_MIND)) {
    const line = lineWith(text);
    if (line) return say(`${line} (from «${title}»)`);
  }
  const found = FOUND.exec(textOf(notes.at(-1)?.content))?.[1] || "";
  for (const block of found.split(/\n\n(?=\[«)/u)) {
    const source = /^\[(.+)\]\n/u.exec(block)?.[1];
    const line = source && lineWith(block.slice(source.length + 3));
    if (line) return say(`${line} (from ${source})`);
  }
  return say(`My knowledge doesn't say anything about ${topic}.`);
}

/**
 * A home's template, drafted (templateDrafts.js): its tag made free of the ones the instructions list as taken, a new
 * one's parts from its sentence, a bot's from its template, and a change as asked.
 * @param {string} system
 * @param {string} asked the user message
 */
// Words a request is made of that name no job, which a new bot is never named after.
const PLAIN_WORDS = new Set(["about", "also", "help", "have", "need", "want", "with", "that", "this", "them", "they", "their", "some", "from", "what", "when", "your", "like", "more", "each", "keep", "small", "make"]);

/**
 * Add bots' suggestions (D-109): the library bots whose tag or name the request names, at most three, then a new bot
 * for its last long word that names none, and one for a change's last such word; a question for under three words.
 * @param {string} asked the planning call's user message
 */
function botPlan(asked) {
  const request = /^What the person asked: (.+)$/mu.exec(asked)?.[1] || "";
  const change = /^What to change: (.+)$/mu.exec(asked)?.[1] || "";
  const words = request.toLowerCase().match(/[a-z]+/gu) || [];
  if (words.length < 3) {
    return { name: "New bots", summary: "", question: "What kind of work is it, and what takes up most of your time?", bots: [], covered: [] };
  }
  const library = GALLERY.filter((template) => words.includes(template.tag) || words.includes(template.name.toLowerCase())).slice(0, 3);
  const named = new Set(GALLERY.flatMap((template) => [template.tag, template.name.toLowerCase()]));
  const lastFree = (text) => (text.toLowerCase().match(/[a-z]{4,}/gu) || []).filter((word) => !named.has(word) && !PLAIN_WORDS.has(word)).at(-1);
  const extra = [...new Set([lastFree(request), change ? lastFree(change) : null].filter(Boolean))];
  return {
    name: "Suggested bots",
    summary: `Bots for: ${request}`.slice(0, 200),
    question: null,
    bots: [
      ...library.map((template) => ({ library: template.slug, why: `You mentioned ${template.tag}.` })),
      ...extra.map((word) => ({
        new: { name: `${word[0].toUpperCase()}${word.slice(1)}`, tag: word.slice(0, 10), description: `Helps with ${word}.` },
        why: `No library bot does ${word}.`
      }))
    ],
    covered: []
  };
}

function templateDraft(system, asked) {
  const taken = new Set((/Not one of: ([^\n]*)\.\n/u.exec(system)?.[1] || "").split(", "));
  const jsonAfter = (label) => {
    try {
      return JSON.parse(new RegExp(`^${label}(\\{.*\\})$`, "mu").exec(asked)?.[1] || "null");
    } catch {
      return null;
    }
  };
  const setup = {
    name: "Setup interview",
    description: "The questions a new person is asked, one at a time.",
    instructions: "1. Ask what matters most to them in this job.\n2. Ask how often they want to hear from you."
  };
  const change = /^Here is a template: /u.test(asked) ? jsonAfter("Here is a template: ") : null;
  if (change) {
    const request = asked.split("answer with the whole template:\n")[1] || "";
    const description = /^Description: (.+)$/u.exec(request)?.[1];
    return description ? { ...change, description } : { ...change, instructions: `${change.instructions}\n\n${request}` };
  }
  const bot = /^Write a template from this bot, (.+?), for every bot/u.exec(asked)?.[1];
  if (bot) {
    const now = jsonAfter("Its template now: ") || {};
    const additions = /^Its additions, to fold into the template: ([\s\S]*)$/mu.exec(asked)?.[1];
    return {
      tag: freeTag(bot, taken),
      description: `${bot}'s job, for every bot that does it.`,
      greeting: now.greeting || `Hi {firstName}, I'm here for ${bot}'s job. First, a few questions to set me up.`,
      instructions: `${now.instructions || `You do ${bot}'s job.`}${additions ? `\n\n${additions}` : ""}`,
      skills: now.skills?.length ? now.skills : [setup]
    };
  }
  const planned = /^Write a template for a bot named (.+?), tag ([a-z][a-z0-9]{1,9}), whose job is: (.+)$/mu.exec(asked);
  if (planned) {
    const [, name, tag, job] = planned;
    return {
      tag,
      description: job.slice(0, 120),
      greeting: `Hi {firstName}, I'm ${name}. First, a few questions to set me up.`,
      instructions: `You are ${name}. Your job: ${job} Ask before anything leaves this chat, and say what you did.`,
      skills: [setup]
    };
  }
  const describe = asked.replace(/^Write a template for bots that will: /u, "");
  return {
    tag: freeTag(describe.split(/\s+/u).find((word) => word.length >= 4) || "helper", taken),
    description: `Helps with: ${describe}`.slice(0, 120),
    greeting: "Hi {firstName}, I'm here to help with this job. First, a few questions to set me up.",
    instructions: `You help the people you work for with this job: ${describe}. Ask before doing anything that can't be undone, and say what you did.`,
    skills: [setup]
  };
}

/**
 * A hand-over note for Continue with others (D-114): the bot's name from the instructions, then what the person said
 * last in the chat it was given.
 */
function handOverNote(system, chat) {
  const bot = /Continuing from my chat with (.+?):"/u.exec(system)?.[1] || "the bot";
  const said = chat.split("\n").slice(1).filter((line) => line && !line.startsWith(`${bot}: `));
  const last = said.at(-1)?.replace(/^[^:]+: /u, "") || "nothing yet";
  return `Continuing from my chat with ${bot}: we were on "${last}". Can you all help from here?`;
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
  if (system.startsWith(TEMPLATE_WRITER)) return say(JSON.stringify(templateDraft(system, textOf(request.messages.at(-1)?.content))));
  if (system.startsWith(NOTE_WRITER)) return say(handOverNote(system, textOf(request.messages.at(-1)?.content)));
  // A bot's memory: the earlier memory's lines and each chat's heading and new lines, as they were handed.
  if (system.startsWith(DIGEST_WRITER)) {
    const handed = textOf(request.messages.at(-1)?.content).split("\n").filter((line) => /^(## |\[|- )/u.test(line));
    return say(handed.join("\n") || "Nothing yet.");
  }
  // The planner's first user message holds the request (a retry's later ones only list problems).
  if (system.startsWith(PLANNER)) {
    return say(JSON.stringify(botPlan(textOf(request.messages.find((message) => message.role === "user")?.content))));
  }
  // Whether a bot replies to a message it isn't called in (D-129): the line marked ">>" is the message decided on. A
  // question no one has answered yet gets a reply, so the chat's first bot answers it and the others pass; people
  // chatting get none.
  if (system.startsWith(DECIDING)) {
    const lines = textOf(request.messages.at(-1)?.content).split("\n");
    const decided = lines.findIndex((line) => line.startsWith(">> "));
    const unanswered = decided >= 0 && decided === lines.length - 1 && lines[decided].trim().endsWith("?");
    return say(unanswered ? "REPLY" : "PASS");
  }
  // A discussion: each bot makes one placeholder point in round 1 and passes after; the wrap-up says so.
  const asked = request.messages.filter((message) => message.role === "user" && !textOf(message.content).startsWith(STATE_NOTE)).at(-1);
  const discussed = [textOf(asked?.content)].find((text) => DISCUSSION_ROUND.test(text) || text.startsWith(DISCUSSION_WRAP));
  if (discussed?.startsWith(DISCUSSION_WRAP)) return say("To sum up: this copy runs on a stand-in model, so the bots agreed only on placeholders, and the question is still open.");
  if (discussed) {
    return say(Number(DISCUSSION_ROUND.exec(discussed)[1]) > 1 ? "PASS" : "One placeholder point: this copy runs on a stand-in model, so a real discussion needs a real one.");
  }
  const apps = appsStep(request);
  if (apps) return apps;
  const own = ownAdditionsStep(system, request);
  if (own) return own;
  const knows = knowledgeStep(system, request);
  if (knows) return knows;
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
    if (step.sends) logSideEffect(console, appEnvironment(process.env), { kind: "email", summary: "the stand-in bot's email to someone@example.com" });
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
