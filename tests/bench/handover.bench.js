// Real-model regression checks for hand-overs (D-14). They call DeepSeek, so they run
// on demand with `npm run bench`, not in `npm run verify`. Each case runs several times.
import assert from "node:assert/strict";
import test from "node:test";
import { generateReply } from "../../packages/bots/src/server/botAgent.js";
import { buildTools } from "../../packages/bots/src/server/botTools.js";
import { createChatModel } from "../../packages/bots/src/server/model.js";
import { turnDoubles } from "../support/botDoubles.mjs";

const RUNS = Number(process.env.BENCH_RUNS) || 3;
const bot = { id: "bench", name: "Muse" };

function state({ awake = false, url = "", waiting = "" } = {}) {
  return [
    "Current state, from the system. It is the truth; earlier messages may be out of date:",
    `- Your computer: ${awake ? `awake, showing ${url || "a blank page"}` : "asleep"}.`,
    `- Hand-over: ${waiting ? `waiting for the person to: ${waiting}` : "none pending. The person can't reach your screen right now; if they want it, call ask_for_help, because saying it in words does nothing"}.`,
    "- Waiting for their approval: nothing.",
    "- Your routines: none."
  ].join("\n");
}

const user = (text) => ({ kind: "text", role: "user", body: { text } });
const said = (text) => ({ kind: "text", role: "bot", body: { text } });

async function run(timeline, currentState) {
  const calls = [];
  const computer = {
    screenshot: async () => null,
    hold: () => {},
    browse: async (_botId, url) => { calls.push("browse"); return { url, title: "GitHub", text: "Sign in to GitHub", screenshot: "x" }; },
    act: async () => { calls.push("act"); return { success: true, message: "", url: "", title: "", screenshot: "x" }; }
  };
  const tools = buildTools(turnDoubles({ approvals: { decide: async () => "allow" }, computer, userId: 1, botId: "bench" }));
  await generateReply(bot, timeline, tools.tools, currentState, "", { languageModel: createChatModel(process.env) });
  return { handover: tools.after.some((message) => message.kind === "handover"), calls };
}

const CASES = [
  {
    name: "a fresh request for the screen hands over",
    timeline: [user("Open github.com/login and hand me the screen so I can sign in.")],
    state: state(),
    expect: true
  },
  {
    name: "asking again after a skip hands over, despite earlier text-only claims",
    timeline: [
      user("Open github.com/login and hand me the screen so I can sign in."),
      said("The GitHub sign-in page is open and the screen is yours now."),
      { kind: "handover", role: "bot", body: { task: "Sign in to GitHub", status: "skipped" } },
      user("I'm skipping that for now; I didn't do it."),
      said("No problem, I've left that. The page is still open on my computer."),
      user("Hand me the screen again so I can sign in to GitHub now."),
      said("Here's the screen again — the GitHub sign-in page is open. Go ahead and sign in."),
      user("Hand me the screen again so I can sign in to GitHub now.")
    ],
    state: state({ awake: true, url: "https://github.com/login" }),
    expect: true
  },
  {
    name: "a long history of earlier hand-overs, all skipped, still hands over again",
    timeline: [
      user("Open github.com/login and hand me the screen so I can sign in."),
      ...Array.from({ length: 6 }, (_, index) => [
        said("Here's the screen — the GitHub sign-in page is open. Go ahead and sign in."),
        { id: `card-${index}`, kind: "handover", role: "bot", body: { task: "Sign in to GitHub", status: "skipped" } },
        said("No problem, I've left that. The page is still open on my computer."),
        user("Hand me the screen again so I can sign in to GitHub now.")
      ]).flat()
    ],
    state: state({ awake: true, url: "https://github.com/login" }),
    expect: true
  },
  {
    name: "with the page already open, a request still hands over",
    timeline: [user("The GitHub login is already on your screen. Let me take over and sign in.")],
    state: state({ awake: true, url: "https://github.com/login" }),
    expect: true
  },
  {
    name: "an unrelated question doesn't hand over",
    timeline: [user("What's the capital of Portugal?")],
    state: state({ awake: true, url: "https://github.com/login" }),
    expect: false
  }
];

for (const benchCase of CASES) {
  test(benchCase.name, { timeout: 180000 }, async () => {
    const results = [];
    for (let attempt = 0; attempt < RUNS; attempt += 1) results.push((await run(benchCase.timeline, benchCase.state)).handover);
    assert.deepEqual(results, results.map(() => benchCase.expect), `hand-over per run: ${JSON.stringify(results)}`);
  });
}
