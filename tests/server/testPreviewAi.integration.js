import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { createServer } from "../../server.js";
import { AI_KINDS } from "../../packages/account/src/server/providers/index.js";
import { checkCopyEnv, signUpPerson } from "../support/templateCheck.mjs";
import { startPreviewAi } from "../../tools/previewAi.mjs";

// The Test Preview's AI, as start-test-app.mjs gives it to the app (tools/previewAi.mjs), never reaches a provider: every
// model call goes to the stand-in model. A new bot's welcome is two of them, its greeting and its first question card
// (onboarding.js), and the stand-in answers both. On 2026-11-12 the welcome went to Together AI with a key no provider
// accepts, was refused with 401, and fell back to the standard words, so the browser suites passed only because a
// real call failed.
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must be this file's own test database copy: run it in the database suite.");

// Every provider Mercbot's kinds of AI can name, by host.
const PROVIDER_HOSTS = new Set(
  Object.values(AI_KINDS).flatMap((kind) => Object.values(kind.types)).map((layer) => new URL(layer.baseURL).host)
);

const original = globalThis.fetch;
// Each request that tried to reach a provider, refused here before it left.
const reached = [];
let ai;
let app;
let person;
let dataDir;

before(async () => {
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (PROVIDER_HOSTS.has(url.host)) {
      reached.push(`${init?.method || "GET"} ${url.origin}${url.pathname}`);
      throw new Error(`A test copy's AI tried to reach ${url.host}.`);
    }
    return original(input, init);
  };
  dataDir = await mkdtemp(path.join(os.tmpdir(), "mercbot-preview-ai-"));
  ai = await startPreviewAi();
  const env = { ...process.env, ...ai.env, AUTH_LOCAL_SESSION_SECRET: "test-preview-ai-test-only-session-secret", NODE_ENV: "test", HOST: "127.0.0.1", PORT: "3001" };
  app = await createServer({ runtimeEnv: await checkCopyEnv(env, { database: process.env.DB_NAME, dataDir }) });
  person = await signUpPerson(app);
});

after(async () => {
  await app?.close();
  await ai?.stop();
  globalThis.fetch = original;
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

test("a new bot's welcome, its greeting and its first question, comes from the stand-in model and reaches no provider", async () => {
  const { request, home } = person;
  const base = `/api/w/${home}`;
  const made = await request("POST", `${base}/bots`, { json: { name: "Wren", color: "#1E86FC" } });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const advance = async (step) => {
    const answer = await request("POST", `${base}/bots/${made.body.bot.id}/onboarding/advance`, { json: { step } });
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    return answer.body.messages;
  };
  const [greeting] = await advance("intro-greet");
  const [card] = await advance("intro-ask");

  assert.deepEqual(reached, [], "no request went to an AI provider");
  assert.match(greeting.body.text, /^Hi .+, I'm Wren\. This copy runs on a stand-in model/u, "the stand-in's greeting, not the standard one");
  assert.equal(card.body.question, "What should I help with first?", "the stand-in's question, not the standard one");
  assert.equal(card.body.options.length, 3);
  assert.deepEqual(ai.standIn.requests.map((asked) => asked.kind), ["premium", "premium"], "both on the premium AI's stand-in");
});
