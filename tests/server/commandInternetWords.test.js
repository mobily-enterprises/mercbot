import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { instructionsFor } from "../../packages/bots/src/server/botAgent.js";
import { buildCommandTools } from "../../packages/bots/src/server/commandTools.js";
import { TEMPLATES_DIR } from "../../packages/bots/src/server/templateResults.js";
import { templateFiles } from "../../packages/bots/src/server/templates.js";

// A bot's command line reaches the public internet through Mercbot's gateway (D-126), so nothing a bot reads may tell
// it otherwise: its standing rules, the run_command tool, Mercbot's skills, the connected apps' skills and the
// templates. A bot told its commands had no internet told a person it couldn't clone their website's repository.

const APP = path.dirname(TEMPLATES_DIR);

// Each way of telling a bot its commands can't reach the internet or install anything.
const NO_INTERNET = [
  /\bno internet\b/iu,
  /\bwithout (?:the )?internet\b/iu,
  /\bno network\b/iu,
  /\bnothing (?:can be|to) install/iu,
  /\bcan(?:'|no)t (?:be )?install/iu,
  /\bdownload it with your browser\b/iu
];

/**
 * The run_command tool as a bot in a chat gets it, in a public chat or a private one, on a copy without its GitHub App
 * or, with `github`, with one (D-128); `viaBot` for work another bot asked for.
 */
const runCommandOf = (privateChat, github = false, viaBot = false) => buildCommandTools({
  files: { shell: {} }, place: {}, homeId: "1", botId: "2", chatBotId: "3", userId: "4", privateChat, viaBot,
  before: [], attempted: [], saved: new Set(), call: {},
  integrations: { connections: { github: { ready: () => github } } }, githubRepos: {}, botName: "Ada", after: []
}).runCommand;

/** Every skill a bot reads: Mercbot's own and each connected app's. */
const skillFiles = () => [
  ...readdirSync(path.join(APP, "packages/bots/skills")).filter((name) => name.endsWith(".md")).map((name) => `packages/bots/skills/${name}`),
  ...readdirSync(path.join(APP, "plugins"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && readdirSync(path.join(APP, "plugins", entry.name)).includes("skill.md"))
    .map((entry) => `plugins/${entry.name}/skill.md`)
];

test("nothing a bot reads says its command line has no internet or can't install anything", () => {
  const said = [
    { file: "botAgent.js (instructionsFor)", text: instructionsFor({ id: "1", name: "Ada" }) },
    { file: "commandTools.js (run_command)", text: runCommandOf(false).description },
    { file: "commandTools.js (run_command, private chat)", text: runCommandOf(true).description },
    ...skillFiles().map((file) => ({ file, text: readFileSync(path.join(APP, file), "utf8") })),
    ...templateFiles().map((file) => ({ file, text: readFileSync(path.join(TEMPLATES_DIR, file), "utf8") }))
  ];
  assert.ok(said.length > 60, "the rules, the tool, every skill and every template are read");
  for (const { file, text } of said) {
    for (const pattern of NO_INTERNET) assert.doesNotMatch(text, pattern, file);
  }
});

test("the run_command tool and a bot's rules say what its commands reach, and that installs last one command", () => {
  for (const text of [runCommandOf(false).description, instructionsFor({ id: "1", name: "Ada" })]) {
    assert.match(text, /reaches the public internet through Mercbot's gateway/u);
    assert.match(text, /git clone over https/u);
    assert.match(text, /npm or pip/u);
    assert.match(text, /same clean toolbox/u);
    assert.match(text, /no ssh/u);
    assert.match(text, /can't push/u);
  }
  assert.match(readFileSync(path.join(APP, "packages/bots/skills/command-line.md"), "utf8"), /reaches the public internet through Mercbot's gateway/u);
});

test("with the copy's GitHub App, run_command names a repository to push to, and says to open pull requests (D-128)", () => {
  const tool = runCommandOf(false, true);
  assert.ok(tool.inputSchema.shape.github, "run_command takes the repository");
  assert.equal(runCommandOf(false).inputSchema.shape.github, undefined, "without the app it has no github field");
  for (const text of [tool.description, instructionsFor({ id: "1", name: "Ada" }), readFileSync(path.join(APP, "packages/bots/skills/command-line.md"), "utf8")]) {
    assert.match(text, /clone a private one, push a branch/u);
    assert.match(text, /gh pr create/u);
    assert.match(text, /branch rule/u);
    assert.match(text, /default branch only when they ask/u);
  }
  assert.doesNotMatch(tool.description, /can't push/u);
});

test("work another bot asked for never signs in to GitHub, even on a copy with its GitHub App (D-128)", async () => {
  const tool = runCommandOf(false, true, true);
  assert.equal(tool.inputSchema.shape.github, undefined);
  assert.match(tool.description, /can't push/u);
  assert.deepEqual(await tool.execute({ why: "Pushing", script: "git push", github: "pat/site" }), { error: "Commands can't sign in to GitHub here." });
});
