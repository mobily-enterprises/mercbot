// The end-to-end check of a bot template (D-43, D-79): a person adds the bot through Mercbot's own routes, plays its
// setup interview, and the check reads what happened. It runs on an app booted in the same process (createServer,
// app.inject), so every send the test copy simulates (D-69) is heard here. `npm run check:templates`
// (scripts/check-templates.mjs) runs it with real AI keys; tests/server/templateCheck.integration.js proves it on the
// stand-in model (tools/standInModel.mjs, which defines the players' words it knows). The person and the judge are
// AI-played, on the economy kind of AI (D-72); the stand-in answers them deterministically.
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chatModel, generateOnce } from "@jskit-ai/agent/server";
import { AI_KINDS, aiKind, modelSettings } from "../../packages/account/src/server/providers/index.js";
import { DONE, JUDGE, PERSON_PLAYER, setupQuestions } from "../../tools/standInModel.mjs";
import { browser } from "./browser.mjs";

/** What the person says first, after the bot's greeting: a yes to its setup interview. */
export const OPENING = "Yes, let's set you up. Ask me your questions.";
const PICKS = "Reply with the options you pick, exactly as written, one per line.";
// D-69's line for each send a test copy simulates.
const SIMULATED = /was simulated, not sent/u;
// How long one reply may take before the check gives up on it (a real model's longest turns take a few minutes).
const REPLY_BOUND_MS = 6 * 60 * 1000;
const PASSWORD = "Template-check-password-2026!";
const JSON_API = "application/vnd.api+json";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The settings the checked Mercbot runs on: `database`, a copy of the test database, as a test copy (SIDE_EFFECTS not
 * live, D-69), so connected apps never send. Its files, uploads and computers stay in
 * `dataDir`, never in this checkout's own .data, whose homes and bots have the same numbers. The files folder is made
 * with the marker a mounted one has.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 * @param {{ database: string, dataDir: string }} copy
 */
export async function checkCopyEnv(env, { database, dataDir }) {
  const files = path.join(dataDir, "files");
  await mkdir(files, { recursive: true });
  await writeFile(path.join(files, ".mercbot-files"), "");
  return Object.freeze({
    ...env,
    DB_NAME: database,
    TEST_DB_NAME: database,
    SIDE_EFFECTS: "",
    MERCBOT_HUB_URL: "",
    AUTH_LOCAL_EMAIL_CONFIRMATION: "false",
    MERCBOT_DATA_DIR: dataDir,
    MERCBOT_FILES_DIR: files,
    JSKIT_STORAGE_FS_BASE_PATH: path.join(dataDir, "storage"),
    SERVER_SURFACE: "all"
  });
}

/** An answer the check needs, or an error saying which call failed and how. */
function needed(answer, what) {
  if (answer.status >= 200 && answer.status < 300) return answer.body;
  throw new Error(`${what} answered ${answer.status}: ${JSON.stringify(answer.body).slice(0, 300)}`);
}

/**
 * A new person who signs up with a password (which signs them in), with their first home, as the routes give it.
 * @param {import("fastify").FastifyInstance} app
 * @param {{ email?: string }} [options] their address; a new one by default
 */
export async function signUpPerson(app, { email = `template-check-${randomUUID()}@example.test` } = {}) {
  const request = browser(app);
  needed(await request("GET", "/api/session"), "The session");
  needed(await request("POST", "/api/register", { json: { email, password: PASSWORD } }), "Signing up");
  const homes = needed(await request("GET", "/api/workspaces", { headers: { accept: JSON_API } }), "The person's homes");
  const home = homes?.data?.[0]?.attributes?.slug;
  if (!home) throw new Error("The new person has no home.");
  return { request, home };
}

/** The app's commit, for the record; "unknown" outside a checkout. */
export function appCommit() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}

/** The provider and model each text kind of AI runs on, for the record. */
export function modelsOf(env) {
  return Object.fromEntries(["premium", "economy"].map((kind) => {
    const ai = aiKind(env, kind);
    return [kind, ai ? `${ai.layer.id} ${ai.layer.model}` : "not set up"];
  }));
}

/**
 * Whether both text kinds of AI have their settings (D-72); the real check needs them, and refuses without. A kind on
 * the stand-in model (MERCBOT_TEST_AI_URL, D-83) isn't the real AI, so it counts as missing.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 */
export function missingAiSettings(env) {
  return ["premium", "economy"].flatMap((kind) => {
    const { providerSetting, keySetting } = AI_KINDS[kind];
    const ai = aiKind(env, kind);
    return ai?.apiKey && !ai.standIn ? [] : [`${providerSetting} and ${keySetting}`];
  });
}

/**
 * The AI-played person and the judge, on the economy kind of AI (D-72), the way the Builder's replies run.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 */
export function aiPlayers(env) {
  const model = chatModel(modelSettings(env, "build"));
  const ask = (system, content) => generateOnce({ model, system, messages: [{ role: "user", content }], maxOutputTokens: 600 });
  const persona = (template) => [
    PERSON_PLAYER,
    `You just added the bot "${template.name}": ${template.description}`,
    "Answer its questions briefly and naturally, as a real person would, with plausible made-up details that stay consistent. Never use real people's names, email addresses or phone numbers; if one is needed, make one up at example.com.",
    "Don't ask the bot for anything beyond its setup. When it asks whether to start a routine, say not yet: leave it paused. When it offers to do a first piece of work now, say not now, thanks.",
    `When the bot has finished its setup and asks you nothing more, reply with exactly ${DONE}.`
  ].join("\n");
  return {
    /** The person's next message, or DONE. */
    async say(template, transcript) {
      const text = String(await ask(persona(template), `The conversation so far:\n${transcript}\n\nWrite your next message to ${template.name}, or ${DONE}.`)).trim();
      return text.includes(DONE) ? DONE : text;
    },
    /** The person's picks on a question card. */
    async pick(template, transcript, card) {
      const listed = card.options.map((option, at) => `${at + 1}. ${option}`).join("\n");
      const text = await ask(persona(template), `The conversation so far:\n${transcript}\n\n${template.name} asks with a card: ${card.question}\nOptions:\n${listed}\n${card.multi ? "You may pick several. " : "Pick one. "}${PICKS}`);
      const said = String(text).split("\n").map((line) => line.replace(/^\s*(?:\d+[.)]|-)\s*/u, "").trim().toLowerCase());
      const picked = card.options.filter((option) => said.includes(option.toLowerCase()));
      return (card.multi ? picked : picked.slice(0, 1)).length ? (card.multi ? picked : picked.slice(0, 1)) : [card.options[0]];
    },
    /** For each setup question, whether the bot asked it. */
    async judge(template, transcript) {
      const questions = setupQuestions(template);
      const system = [
        JUDGE,
        "A question counts as asked when the bot asked it in its own words, in a message or on a question card, alone or together with another question. A question it only answered for the person, or skipped, wasn't asked.",
        "Reply with JSON only: {\"asked\": [true or false for each question, in order], \"why\": [for each question, in order, one short sentence: where the bot asked it, or what it did instead]}."
      ].join("\n");
      const text = await ask(system, `Setup questions:\n${questions.map((question, at) => `${at + 1}. ${question}`).join("\n")}\n\nConversation:\n${transcript}`);
      const { asked, why } = JSON.parse(String(text).replace(/^\s*```(?:json)?|```\s*$/gu, "").trim());
      if (!Array.isArray(asked) || asked.length !== questions.length) throw new Error(`The judge's answer didn't fit the ${questions.length} questions: ${String(text).slice(0, 200)}`);
      // The judge's reason for each question, kept with a failed result (D-79); a judge that gives
      // none, or not one per question, leaves them out.
      const reasons = Array.isArray(why) && why.length === questions.length ? why : [];
      return questions.map((question, at) => ({ question, asked: asked[at] === true, why: typeof reasons[at] === "string" ? reasons[at].trim() : "" }));
    }
  };
}

/**
 * Every line the test copy writes about a send it simulated (D-69), from now until `stop()`.
 * @returns {{ lines: string[], stop: () => void }}
 */
export function watchSends() {
  const lines = [];
  const methods = ["log", "info", "warn", "error"];
  const originals = Object.fromEntries(methods.map((method) => [method, console[method]]));
  for (const method of methods) {
    console[method] = (...args) => {
      const text = args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ");
      if (SIMULATED.test(text)) lines.push(text);
      return originals[method].apply(console, args);
    };
  }
  return { lines, stop: () => Object.assign(console, originals) };
}

/** A chat's messages as the person and the judge read them. */
function transcriptOf(messages) {
  return messages.flatMap((message) => {
    const { kind, role, body = {} } = message;
    if (kind === "text" && role === "bot") return [`${body.speaker?.name || "Bot"}: ${body.text}`];
    if (kind === "text" && role === "user") return [`Person: ${body.text}`];
    if (kind === "choice") {
      const asked = `Bot asks with a card: ${body.question} [${body.options.join(" | ")}]`;
      return body.chosen ? [asked, `Person picks: ${[].concat(body.chosen).join(", ")}`] : [asked];
    }
    if (kind === "event") return [`(Mercbot: ${body.text})`];
    if (kind === "draft") return [`(A draft card: ${body.subject || body.text || ""}, ${body.status})`];
    return [];
  }).join("\n");
}

/** The answer to an approval card: creating a paused routine is part of the setup; anything else waits (D-43). */
function approvalPick(card) {
  const action = card.body.action || {};
  return action.id === "create_routine" && action.args?.paused === "true" ? "Go ahead" : "Don't do it";
}

/**
 * Plays one template's setup interview in a home of `person`'s and says what it found.
 * @param {object} options
 * @param {{ request: ReturnType<typeof browser>, home: string }} options.person a signed-in person and their home
 * @param {object} options.template the template's file, as parsed, with its `fingerprint`
 * @param {ReturnType<typeof aiPlayers>} options.players
 * @param {{ commit: string, behaviour: string, models: Record<string, string>, date?: string }} options.run the app's
 *   commit, how its bots behave (behaviourFingerprint, worked out once for the run) and the models
 * @param {number} [options.maxTurns]
 */
export async function checkTemplateEndToEnd({ person, template, players, run, maxTurns }) {
  const { request, home } = person;
  const base = `/api/w/${home}`;
  const questions = setupQuestions(template);
  const turnsAllowed = maxTurns ?? Math.min(24, questions.length + 8);
  const reasons = [];
  const seen = new Map();
  const timeline = () => [...seen.values()].sort((a, b) => Number(a.id) - Number(b.id));
  const merge = (messages = []) => {
    for (const message of messages) if (/^\d+$/u.test(String(message.id))) seen.set(String(message.id), message);
  };
  const sends = watchSends();
  let turns = 0;
  let asked = [];
  try {
    // Add bot, as the preview does: the bot, then its paired app as a draft (the preview's box is ticked).
    const { bot } = needed(await request("POST", `${base}/bots/from-template`, { json: { slug: template.slug } }), "Adding the bot");
    if (template.appTemplate) needed(await request("POST", `${base}/apps-templates/${template.appTemplate}/install`, { json: {} }), `Setting up the ${template.appTemplate} app`);
    const chat = `${base}/bots/${bot.id}`;
    const read = async () => merge(needed(await request("GET", `${chat}/messages`), "Reading the chat").messages);
    await read();
    const greeting = timeline().find((message) => message.kind === "text" && message.role === "bot");
    if (!greeting || /\{firstName\}/u.test(greeting.body.text) || !greeting.body.text.includes(template.name)) {
      reasons.push("It didn't open with its own greeting.");
    }

    /** The bot's reply to what the person just did; false when it couldn't reply. */
    const replied = async () => {
      const json = { afterMessageId: timeline().at(-1)?.id || null, timeZone: "Europe/London", language: "en" };
      const ask = async () => needed(await request("POST", `${chat}/reply`, { json }), "The reply");
      const until = Date.now() + REPLY_BOUND_MS;
      let answer = await ask();
      while (answer.pending && Date.now() < until) {
        await sleep(1000);
        answer = await ask();
      }
      if (answer.pending) throw new Error(`${template.name}'s reply took longer than ${REPLY_BOUND_MS / 60000} minutes.`);
      merge(answer.messages);
      await read();
      return !answer.messages.some((message) => /something went wrong on my side/u.test(message.body?.text || ""));
    };
    const openCard = () => [...timeline()].reverse().find((message) => message.kind === "choice" && !message.body.chosen && !message.body.inactive) || null;

    let move = { say: OPENING };
    for (;;) {
      turns += 1;
      if (move.say) merge(needed(await request("POST", `${chat}/messages`, { json: { text: move.say, clientId: randomUUID() } }), "Sending a message").messages);
      else merge(needed(await request("POST", `${chat}/choices/${move.card.id}`, { json: { selected: move.picks } }), "Answering a card").messages);
      if (!(await replied())) {
        reasons.push(`Its reply failed on turn ${turns}: the AI provider or Mercbot, not necessarily the template.`);
        break;
      }
      const card = openCard();
      const transcript = transcriptOf(timeline());
      if (card) {
        const picks = card.body.purpose === "approval" ? [approvalPick(card)] : await players.pick(template, transcript, card.body);
        move = { card, picks };
      } else {
        const words = await players.say(template, transcript);
        if (words === DONE) break;
        move = { say: words };
      }
      if (turns >= turnsAllowed) {
        reasons.push(`Its setup didn't finish within ${turnsAllowed} turns.`);
        break;
      }
    }

    // Asked its setup questions (judged), made its routines paused, and sent nothing without a yes.
    asked = await players.judge(template, transcriptOf(timeline()));
    for (const { question, asked: wasAsked, why } of asked) if (!wasAsked) reasons.push(`It didn't ask: ${question}${why ? ` The judge: ${why}` : ""}`);
    const { routines } = needed(await request("GET", `${chat}/routines`), "Reading its routines");
    if (routines.length < template.routines.length) {
      reasons.push(`It set up ${routines.length} of its ${template.routines.length} routines (${template.routines.map((routine) => routine.name).join(", ")}).`);
    }
    for (const routine of routines) if (routine.enabled) reasons.push(`Its routine "${routine.name}" is running, but the person never said to start it.`);
    for (const line of sends.lines) reasons.push(`It sent something without a yes: ${line}`);
    for (const message of timeline()) {
      if (message.kind === "draft" && ["sending", "sent"].includes(message.body.status)) reasons.push(`It sent a draft without a yes: ${message.body.subject || "a message"}.`);
    }
  } catch (error) {
    reasons.push(`The check couldn't finish: ${error.message}`);
  } finally {
    sends.stop();
  }
  return {
    date: run.date || new Date().toISOString().slice(0, 10),
    commit: run.commit,
    behaviour: run.behaviour,
    template: template.fingerprint,
    models: run.models,
    passed: reasons.length === 0,
    reasons,
    turns,
    asked: `${asked.filter((entry) => entry.asked).length} of ${questions.length}`
  };
}
