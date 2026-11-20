import assert from "node:assert/strict";
import test from "node:test";
import { changeDraftPrompt, draftSystem, fromBotPrompt, newDraftPrompt, readDraft } from "../../packages/bots/src/server/templateDrafts.js";
import { LIBRARY, LIBRARY_TAGS } from "../../packages/bots/src/server/templates.js";
import { templateProblems } from "../../packages/bots/src/shared/templateBody.js";

// What one drafting call sends (D-98, amended 20 November), as each of its three prompts is assembled from fixtures: a
// home with Mercbot's library and five templates of its own, one of Mercbot's templates as a bot's, its person's
// summary at the most a draft reads, and that template as the draft on the page. The character counts are reported,
// for the cost per call in docs/decisions.md (at about 4 characters a token).

const HOME_TAGS = ["garden", "pond", "bills", "kids", "trips"];
const PANTRY = LIBRARY.get("weekly-meal-planner");
const SUMMARY = "Pat plans vegetarian dinners for four, shops on Saturdays and asks for a list grouped by aisle. ".repeat(16).slice(0, 1500);
const ROUTINES = [{ name: "Weekly plan", schedule: "Sundays at 5pm (Europe/London)" }, { name: "Shopping list", schedule: "Saturdays at 8am (Europe/London)" }];

test("the three drafting prompts, assembled from fixtures, and their sizes", (context) => {
  const system = draftSystem(new Set([...LIBRARY_TAGS, ...HOME_TAGS]));
  const prompts = {
    system,
    new: newDraftPrompt("keep track of our garden: what to water, when to feed the plants and what needs doing each season"),
    "from-bot": fromBotPrompt({ name: "Kitchen", template: PANTRY, summary: SUMMARY, routines: ROUTINES }),
    "from-bot, 20,000 characters of additions folded in": fromBotPrompt({ name: "Kitchen", template: PANTRY, summary: SUMMARY, routines: ROUTINES, additions: "a".repeat(20000) }),
    change: changeDraftPrompt(PANTRY, "Make it plan lunches too, and keep the shopping list by aisle.")
  };
  const sizes = Object.fromEntries(Object.entries(prompts).map(([name, text]) => [name, text.length]));
  for (const [name, size] of Object.entries(sizes)) context.diagnostic(`${name}: ${size.toLocaleString("en")} characters (about ${Math.round(size / 4).toLocaleString("en")} tokens)`);

  // The system prompt names every taken tag and shows one of Mercbot's templates whole.
  for (const tag of [...LIBRARY_TAGS, ...HOME_TAGS]) assert.match(system, new RegExp(`[ ,]${tag}[,.]`, "u"), tag);
  assert.ok(system.includes(JSON.stringify(LIBRARY.get("blog-article-desk").instructions)), "the example's instructions");
  // A new template's message is its sentence; a bot's carries its template, summary and routines; a change, the draft.
  assert.ok(sizes.new < 200);
  assert.ok(prompts["from-bot"].includes(JSON.stringify(PANTRY.instructions)) && prompts["from-bot"].includes(SUMMARY));
  assert.ok(prompts.change.includes(JSON.stringify(PANTRY.greeting)));
  // The sizes the cost per call is worked from: the system prompt about 2,100 tokens, a template about 1,450.
  assert.ok(sizes.system > 6000 && sizes.system < 10000, `system ${sizes.system}`);
  assert.ok(sizes.change > 4000 && sizes.change < 9000, `change ${sizes.change}`);
  assert.ok(sizes["from-bot"] - sizes.change > 1000 && sizes["from-bot"] - sizes.change < 2000, "the summary and routines");
});

test("an answer is read as a draft: its JSON, wherever it is in the answer, and the problems with it", () => {
  const taken = new Set(LIBRARY_TAGS);
  const body = { tag: "garden", description: "Keeps the garden.", greeting: "Hi {firstName}.", instructions: "You keep the garden.",
    skills: [{ name: "Setup interview", description: "What to ask.", instructions: "1. Ask what grows." }] };
  assert.deepEqual(readDraft(`Here it is:\n\`\`\`json\n${JSON.stringify({ ...body, extra: 1 })}\n\`\`\``, taken), { draft: body, problems: [] });
  assert.deepEqual(readDraft("No.", taken).problems, [{ field: "answer", text: "It isn't one JSON object." }]);
  assert.deepEqual(readDraft("[1, 2]", taken).problems, [{ field: "answer", text: "It isn't one JSON object." }]);
  assert.deepEqual(readDraft(JSON.stringify({ ...body, tag: "meals" }), taken).problems, [{ field: "tag", text: "Another template already has this tag." }]);
  // The rules are a library template's, with a home's one-line description of at most 120 characters.
  assert.deepEqual(templateProblems({ ...body, description: "x".repeat(121) }).map((problem) => problem.field), ["description"]);
  assert.deepEqual(templateProblems({ ...body, description: "Two\nlines." }).map((problem) => problem.field), ["description"]);
  const seven = Array.from({ length: 7 }, (_, index) => ({ ...body.skills[0], name: index ? `Skill ${index}` : "Setup interview" }));
  assert.deepEqual(templateProblems({ ...body, skills: seven }).map((problem) => problem.field), ["skills"]);
  assert.deepEqual(templateProblems({ ...body, skills: [{ ...body.skills[0], name: "Weekly plan" }] }).map((problem) => problem.field), ["setup"]);
  assert.deepEqual(templateProblems({ ...body, skills: [{ name: "Setup interview", description: "", instructions: "x".repeat(6001) }] }).map((problem) => problem.field), [
    "skills.0.description",
    "skills.0.instructions"
  ]);
});
