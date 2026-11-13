import assert from "node:assert/strict";
import test from "node:test";
import { APICallError, RetryError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { registerRoutes } from "../../packages/bots/src/server/registerRoutes.js";
import { BotsError } from "../../packages/bots/src/server/botsError.js";
import { ONBOARDING_STEPS } from "../../packages/bots/src/server/onboarding.js";
import { requestContextOptions } from "../support/requestContextOptions.mjs";

// A model call that fails while a bot route works (2026-11-11 review): the page gets our own refusal, 502
// bots_model_failed with a plain message, never the provider's status (401 for a refused key, 429 for its limit,
// 5xx), which it would read as its own: a 401 as being signed out. The status and the error's message are logged in
// one line, never the error, which carries the request with the person's message. Steps that fall back on their
// standard words (a new bot's welcome and first question) log the failure the same way.

const PERSON = "Book my flight to Rome";
// As a provider's client throws them: the request it sent goes with each.
const failure = (statusCode, message, isRetryable = false) => new APICallError({
  message,
  url: "https://models.example/v1/chat/completions",
  requestBodyValues: { messages: [{ role: "user", content: PERSON }] },
  statusCode,
  isRetryable
});
const refused = () => failure(401, "Invalid API key");
const limited = () => new RetryError({
  message: "Failed after 7 attempts. Last error: Too Many Requests",
  reason: "maxRetriesExceeded",
  errors: [failure(429, "Too Many Requests", true), failure(429, "Too Many Requests", true)]
});
const unavailable = () => failure(503, "Service Unavailable", true);

// The bots routes with a Stop teaching that throws `thrown`, called as the page calls them.
function stopThrowing(thrown) {
  const routes = new Map();
  const http = { router: { register: (method, path, _options, handler) => routes.set(`${method} ${path}`, handler) } };
  registerRoutes(http, {
    bots: { stopTeaching: async () => { throw thrown; } },
    approvals: {},
    notices: {},
    meter: { track: (_meta, work) => work(), pausedMessage: async () => null },
    records: { directory: { findBot: async (botId) => ({ id: botId }) } },
    streams: new Set()
  });
  return async () => {
    const path = "/api/w/:workspaceSlug/bots/:botId/teach/stop";
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
    const request = {
      method: "POST",
      url: "/api/w/home-3/bots/12/teach/stop",
      routeOptions: { url: path },
      params: { workspaceSlug: "home-3", botId: "12" },
      body: {},
      user: { id: "7" },
      workspace: { id: "3", slug: "home-3" },
      membership: { roleSid: "member" },
      permissions: []
    };
    request.callOptions = async () => requestContextOptions(request);
    await routes.get(`POST ${path}`)(request, reply);
    return answer;
  };
}

test("a bot route whose model call fails answers our own refusal, and logs the provider's status in one line", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  for (const thrown of [refused(), limited(), unavailable()]) {
    const answer = await stopThrowing(thrown)();
    assert.equal(answer.status, 502);
    assert.deepEqual(answer.body, {
      error: "The AI provider couldn't answer just now. Try again in a moment.",
      code: "bots_model_failed",
      params: {}
    });
  }
  const lines = warn.mock.calls.map((call) => call.arguments);
  assert.deepEqual(lines, [
    ["POST /api/w/:workspaceSlug/bots/:botId/teach/stop: its model call failed (status 401): Invalid API key"],
    ["POST /api/w/:workspaceSlug/bots/:botId/teach/stop: its model call failed (status 429): Failed after 7 attempts. Last error: Too Many Requests"],
    ["POST /api/w/:workspaceSlug/bots/:botId/teach/stop: its model call failed (status 503): Service Unavailable"]
  ]);
  assert.ok(!JSON.stringify(lines).includes(PERSON), "the person's message stays out of the log");
});

test("a bot route's own refusals keep their status, and anything else goes to JSKIT's error handler", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const closed = await stopThrowing(new BotsError(409, "That draft has already been dealt with.", { code: "bots_draft_closed" }))();
  assert.equal(closed.status, 409);
  assert.equal(closed.body.code, "bots_draft_closed");
  await assert.rejects(stopThrowing(new TypeError("broken"))(), { name: "TypeError", message: "broken" });
  assert.equal(warn.mock.callCount(), 0);
});

// A model whose every call fails with `error`, as the AI SDK passes it on.
const failingModel = (error) => new MockLanguageModelV4({
  doGenerate: async () => {
    throw error;
  }
});

test("a new bot's welcome and first question fall back on their standard words when the model fails, and say why in the log", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const bot = { id: "21", name: "Juno" };
  const greeted = await ONBOARDING_STEPS["intro-greet"]({ firstName: "Ada", bot, model: failingModel(refused()) });
  assert.deepEqual(greeted.messages.map((message) => message.body.text), ["Hi Ada, I'm Juno. Happy to get started whenever you are."]);
  const asked = await ONBOARDING_STEPS["intro-ask"]({ bot, model: failingModel(refused()) });
  assert.equal(asked.messages[0].body.question, "Where should I start helping?");
  assert.deepEqual(warn.mock.calls.map((call) => call.arguments), [
    ["Bot 21's welcome is the standard one: its model call failed (status 401): Invalid API key"],
    ["Bot 21's first question is the standard one: its model call failed (status 401): Invalid API key"]
  ]);
});
