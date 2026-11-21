import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { TEMPLATES_DIR } from "../../packages/bots/src/server/templateResults.js";
import { setupSkillOf, templateFiles } from "../../packages/bots/src/server/templates.js";

// What bots read about how Mercbot works, in their templates, teams and skills, speaks of chats (D-112): a bot is a
// member of the home that people talk to in chats, Public or Private, and what it makes in a chat belongs to that chat,
// in its folder, /files/chat. These checks read only the files, so they run whatever the rest of the bots' code does.

const APP = path.dirname(TEMPLATES_DIR);
const templates = templateFiles().map((file) => ({ file, template: JSON.parse(readFileSync(path.join(TEMPLATES_DIR, file), "utf8")) }));

/** Everything a template says: its greeting, job, every skill and every routine. */
const wordsOf = (template) => [
  template.name,
  template.description,
  template.greeting,
  template.instructions,
  ...template.skills.flatMap((skill) => [skill.name, skill.description, skill.instructions]),
  ...template.routines.flatMap((routine) => [routine.name, routine.when, routine.what])
].join("\n");

/** Mercbot's own skills, and the skill of every connected app that has one. */
const skillFiles = () => [
  ...readdirSync(path.join(APP, "packages/bots/skills")).filter((name) => name.endsWith(".md")).map((name) => `packages/bots/skills/${name}`),
  ...readdirSync(path.join(APP, "plugins"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && readdirSync(path.join(APP, "plugins", entry.name)).includes("skill.md"))
    .map((entry) => `plugins/${entry.name}/skill.md`)
];

// The chat model chats replaced, in the words a bot would take for real.
const OLD_MODEL = [
  [/\/files\/mine\b/u, "/files/mine (a chat's folder is /files/chat)"],
  [/\bnotebook\b/iu, "the home notebook"],
  [/\bas (?:a )?memor(?:y|ies)\b|\bSettings → Memory\b|\bwith remember\b/iu, "memories saved with remember"],
  [/\b(?:private|mixed|shared) (?:bots?|modes?)\b/iu, "a bot's mode"],
  [/\bShared tabs?\b|"You only"|\bYou only tab\b/u, "Shared tabs and You only"],
  [/\bgroup chats?\b|\bin a (?:room|group)\b/iu, "rooms and group chats"],
  [/\b(?:their|your) own chat\b/iu, "a person's own chat"]
];

test("no template, team or skill speaks of the chat model chats replaced", () => {
  const said = [
    ...templates.map(({ file, template }) => ({ file, text: wordsOf(template) })),
    { file: "teams.json", text: readFileSync(path.join(TEMPLATES_DIR, "teams.json"), "utf8") },
    ...skillFiles().map((file) => ({ file, text: readFileSync(path.join(APP, file), "utf8") }))
  ];
  assert.ok(templates.length >= 40, "every template is read");
  assert.ok(said.filter(({ file }) => file.startsWith("packages/bots/skills/")).length >= 20, "and Mercbot's skills");
  assert.ok(said.some(({ file }) => file === "plugins/sedna/skill.md"), "and the connected apps' skills");
  for (const { file, text } of said) {
    for (const [pattern, what] of OLD_MODEL) assert.doesNotMatch(text, pattern, `${file}: ${what}`);
  }
});

// A template's lasting facts (its setup answers, and preferences the person adds later) go in a document in the chat's
// folder named for its job, which the bot reads before every piece of work: it belongs to the chat (D-112), anyone who
// can open the chat can read and correct it, and it survives the chat's summary.
test("every template keeps its setup answers in a notes document of its own in the chat's folder, and reads it first", () => {
  const names = new Map();
  for (const { file, template } of templates) {
    const steps = setupSkillOf(template).instructions.split("\n").filter((line) => /^\d+\.\s/u.test(line));
    const written = steps.map((step) => /\bin the "([^"]+ notes)" document in \/files\/chat\b/u.exec(step)?.[1]).find(Boolean);
    assert.ok(written, `${file}: its setup interview writes the answers in its notes document in /files/chat`);
    assert.match(template.instructions, /\bRead the notes before every piece of work, routine runs included\./u, `${file}: it reads them before working`);
    assert.ok(template.instructions.includes(`"${written}" document`), `${file}: its job names the same document, "${written}"`);
    assert.ok(!names.has(written), `${file}: "${written}" is ${names.get(written)}'s too, and two bots in one chat would share it`);
    names.set(written, file);
  }
});
