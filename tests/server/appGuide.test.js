import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { GUIDE_LIMIT, appGuide } from "../../packages/apps/src/shared/appGuide.js";

// The app guide (D-147): everything about an app in plain labelled text, written by Mercbot the same way for every app
// from the app itself (no AI, no clock), so its bot knows it fully from the cached start of its prompt.

const template = (key) => JSON.parse(readFileSync(new URL(`../../packages/apps/templates/${key}.json`, import.meta.url), "utf8"));

/** A template's tables as the registry hands them out (ids, labels, options), its personal ones with their Whose. */
function registryTables({ tables }) {
  return tables.map((table) => ({
    id: `t_${table.key}`,
    key: table.key,
    label: table.label || table.key.replace(/_/gu, " "),
    obsolete: false,
    fields: [...(table.personal ? [{ key: "whose", type: "person", label: "Whose", owner: true }] : []), ...table.fields].map(({ key, label, type, target, rollup, owner, ...options }) => ({
      id: `f_${table.key}_${key}`,
      key,
      label,
      type,
      obsolete: false,
      options: {
        ...options,
        ...(target ? { target: `t_${target}` } : {}),
        ...(owner ? { owner: true } : {}),
        ...(rollup ? { rollup: { ...rollup, from: `t_${rollup.from}`, link: `f_${rollup.from}_${rollup.link}`, ...(rollup.field ? { field: `f_${rollup.from}_${rollup.field}` } : {}) } } : {})
      }
    }))
  }));
}

const guideOf = (key, change = (definition) => definition) => {
  const app = template(key);
  return appGuide({ name: app.name, description: app.description, definition: change(app.definition), tables: registryTables(app), scripts: app.scripts || [] });
};

test("Learn to program's guide names its screens, what each reads, its buttons and forms, its tables and fields, and its scripts", () => {
  const lines = guideOf("learn_to_program").split("\n");
  for (const line of [
    "# The app guide of \"Learn to program\"",
    "It opens on learn (screen learn).",
    "### lesson (screen lesson)",
    "Opened with: id, mine",
    "- attempts: records of prog attempts (prog_attempts), where =lesson == params.id, sorted by -at, at most 1",
    "- mine: one record of prog progress (prog_progress) (the one =params.mine)",
    "- form on =data.mine: Your code (code)",
    "  - button Check my answer ▶️: runs the script check",
    "- button Back to the course: opens the screen course with {\"id\":\"=data.lesson.course\"}",
    "### prog progress (prog_progress), each person's own: everyone sees and changes only their own records",
    "- Whose (whose): person, whose record it is: each person sees only their own",
    "- Lesson (lesson): link, required, links to prog lessons (prog_lessons)",
    "- Status (status): choice, one of Writing, Fixing, New, Problem, Put away",
    "- Questions (questions): number, roll-up: the count of prog questions (prog_questions) by lesson",
    "- check (action, a button runs it): Runs the person's code with the lesson's tests on the computer, keeps the attempt, celebrates a pass, and has the bot explain a failure in plain words.",
    "- write_lessons (job, when prog_lessons records change (any), if =row.status == \"Writing\" && \"status\" in changed): Has the app's bot write each new lesson: its explanation, quiz, and an exercise with starting code, a solution and tests."
  ]) assert.ok(lines.includes(line), `the guide has the line: ${line}`);
});

test("the same app gives the same guide byte for byte, whatever order its definition's keys come back in", () => {
  // The database keeps an object's keys in its own order, never the order they were written in.
  const reversed = (value) => {
    if (Array.isArray(value)) return value.map(reversed);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).reverse().map(([key, inner]) => [key, reversed(inner)]));
  };
  const first = guideOf("study");
  assert.equal(guideOf("study"), first);
  assert.equal(guideOf("study", reversed), first);
  assert.ok(first.includes("Its navigation (rail): Learn (learn), Books (books), Progress (progress)."), "Study's navigation, in its order");
});

test("a guide longer than its limit lists only what acts on each screen first, then is cut with a note", () => {
  const long = (definition) => ({ ...definition, screens: Object.fromEntries(Array.from({ length: 30 }, (_, at) => [`page_${String(at).padStart(2, "0")}`, { content: Array.from({ length: 30 }, () => ({ type: "text", value: "A long paragraph. ".repeat(20) })) }])), home: "page_00" });
  const shortened = guideOf("todos", long);
  assert.ok(shortened.length <= GUIDE_LIMIT, `${shortened.length} characters`);
  assert.ok(shortened.includes("(The screens are shortened: only what acts on them is listed, as the whole guide is long.)"));
  assert.ok(!shortened.includes("A long paragraph."), "the screens' texts go first");
  const huge = (definition) => ({ ...definition, home: "page_000", screens: Object.fromEntries(Array.from({ length: 400 }, (_, at) => [`page_${String(at).padStart(3, "0")}`, { content: [{ type: "button", label: "Go on ".repeat(20), do: [{ go: { screen: "page_000" } }] }] }])) });
  const cut = guideOf("todos", huge);
  assert.equal(cut.length, GUIDE_LIMIT);
  assert.ok(cut.endsWith("\n(The rest of this guide is left out: it's longer than Mercbot keeps.)"));
});
