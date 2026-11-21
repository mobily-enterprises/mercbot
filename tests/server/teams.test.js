import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { TEAMS_FILE } from "../../packages/bots/src/server/templateResults.js";
import { GALLERY, templateFiles } from "../../packages/bots/src/server/templates.js";
import { TEAMS, checkTeams, teamProblems } from "../../packages/bots/src/server/teams.js";

// Mercbot's teams (D-105), as bot-templates/teams.json writes them: every team names only the library's templates, each
// once, and Mercbot refuses to start on a file that doesn't; the teams are the twelve decided, by situation; the file is
// no template; and no two of the library's bots share a name, so a team's bots are told apart (team-check-in's is Pulse,
// where it was Tuningfork beside brand-voice-editor's Tuning Fork).
const written = JSON.parse(readFileSync(TEAMS_FILE, "utf8")).teams;

test("every team names only the library's templates, each once", () => {
  assert.deepEqual(teamProblems(written, GALLERY), []);
});

test("a team naming a template the library hasn't got, or one twice, is refused, and Mercbot doesn't start on it", () => {
  const family = written.find((team) => team.id === "family-home");
  const missing = [{ ...family, templates: [...family.templates, "dog-walker"] }];
  const twice = [{ ...family, templates: [...family.templates, family.templates[0]] }];
  assert.deepEqual(teamProblems(missing, GALLERY), ['family-home: no template "dog-walker" in the library']);
  assert.deepEqual(teamProblems(twice, GALLERY), ["family-home: family-chores-rota is in it twice"]);
  assert.throws(() => checkTeams(missing), /bot-templates\/teams\.json\): family-home: no template "dog-walker"/u);
  assert.deepEqual(teamProblems([family, { ...family, templates: ["habit-tracker"] }], GALLERY), [
    "family-home: another team has its id",
    "family-home: another team has its name"
  ]);
  assert.deepEqual(teamProblems([{ id: "Shop!", for: "play", name: "", description: "Two\nlines", templates: [] }], GALLERY), [
    "Shop!: id, lowercase words joined by -",
    "Shop!: for, one of home or work",
    "Shop!: name, up to 40 characters",
    "Shop!: description, one line of up to 160 characters",
    "Shop!: templates, one or more of the library's"
  ]);
});

test("the teams are the twelve decided, each named for its situation, in order, two for home and life (D-109)", () => {
  assert.deepEqual(TEAMS.map((team) => [team.id, team.for, team.name, team.templates.length]), [
    ["family-home", "home", "Busy household", 6],
    ["just-me", "home", "Personal life", 5],
    ["front-desk", "work", "Local service business", 6],
    ["shop", "work", "Small shop", 5],
    ["marketing", "work", "Marketing team", 6],
    ["sales", "work", "Sales team", 5],
    ["software", "work", "Software company", 5],
    ["product-design", "work", "Design studio", 5],
    ["people", "work", "Growing team (hiring)", 5],
    ["back-office", "work", "Office manager", 5],
    ["founder", "work", "Startup founder", 6],
    ["consultancy", "work", "Consultancy", 7]
  ]);
  assert.deepEqual(TEAMS.find((team) => team.id === "consultancy").templates, [
    "prospect-research", "sales-call-prep", "proposal-writer", "meeting-recap-writer", "presentation-polisher", "deal-follow-ups",
    "receipts-and-invoices"
  ]);
  assert.match(TEAMS.find((team) => team.id === "front-desk").description, /^For a salon, a plumber, a clinic…/u);
});

test("the teams' file is no template, and no two of the library's bots share a name", () => {
  assert.equal(templateFiles().includes("teams.json"), false);
  assert.equal(GALLERY.some((template) => template.slug === "teams"), false);
  const plain = (name) => name.toLowerCase().replace(/[^a-z0-9]/gu, "");
  const byName = Map.groupBy(GALLERY, (template) => plain(template.name));
  assert.deepEqual([...byName].filter(([, same]) => same.length > 1).map(([, same]) => same.map((template) => template.slug)), []);
  const checkIn = GALLERY.find((template) => template.slug === "team-check-in");
  assert.equal(checkIn.name, "Pulse");
  assert.match(checkIn.greeting, /I'm Pulse\./u);
});
