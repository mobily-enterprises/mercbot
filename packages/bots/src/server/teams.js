import { readFileSync } from "node:fs";
import { TEAMS_FILE } from "./templateResults.js";
import { GALLERY } from "./templates.js";

// Mercbot's teams (D-105): a set of the library's templates for one purpose, such as a family home or a shop, which Add
// a team makes into bots together. They are data, in bot-templates/teams.json, written by the Mercbot team like the
// templates, and checked when Mercbot starts: a team naming a template the library hasn't got, or one twice, stops it.

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
// What a team is for (D-109): Add bots lists the teams for home and life, then those for work.
export const TEAM_FOR = Object.freeze(["home", "work"]);
const LIMITS = Object.freeze({ id: 40, name: 40, description: 160 });

/** One line of text, trimmed, of 1 to `max` characters. */
const oneLineOf = (value, max) =>
  typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= max && !value.includes("\n");

/**
 * What's wrong with a list of teams, each problem naming its team: empty when every team has an id (lowercase words
 * joined by -), what it's for (TEAM_FOR), a name and a one-line description, all its own, and one or more of
 * `library`'s templates, each once.
 * @param {unknown} teams
 * @param {ReadonlyArray<{ slug: string }>} library the templates a team may name
 * @returns {string[]}
 */
export function teamProblems(teams, library) {
  if (!Array.isArray(teams) || !teams.length) return ["teams: a list of one or more teams"];
  const slugs = new Set(library.map((template) => template.slug));
  const problems = [];
  const seen = { id: new Set(), name: new Set() };
  for (const [index, team] of teams.entries()) {
    const label = typeof team?.id === "string" && team.id ? team.id : `team ${index + 1}`;
    if (!ID.test(String(team?.id || "")) || team.id.length > LIMITS.id) problems.push(`${label}: id, lowercase words joined by -`);
    if (!TEAM_FOR.includes(team?.for)) problems.push(`${label}: for, one of ${TEAM_FOR.join(" or ")}`);
    if (!oneLineOf(team?.name, LIMITS.name)) problems.push(`${label}: name, up to ${LIMITS.name} characters`);
    if (!oneLineOf(team?.description, LIMITS.description)) {
      problems.push(`${label}: description, one line of up to ${LIMITS.description} characters`);
    }
    for (const key of ["id", "name"]) {
      if (typeof team?.[key] === "string" && seen[key].has(team[key].toLowerCase())) problems.push(`${label}: another team has its ${key}`);
      if (typeof team?.[key] === "string") seen[key].add(team[key].toLowerCase());
    }
    const templates = Array.isArray(team?.templates) ? team.templates : null;
    if (!templates?.length) {
      problems.push(`${label}: templates, one or more of the library's`);
      continue;
    }
    for (const [at, slug] of templates.entries()) {
      if (!slugs.has(slug)) problems.push(`${label}: no template ${JSON.stringify(slug)} in the library`);
      else if (templates.indexOf(slug) !== at) problems.push(`${label}: ${slug} is in it twice`);
    }
  }
  return problems;
}

/**
 * The teams, checked against `library` (teamProblems), as frozen records; throws naming every problem otherwise.
 * @param {unknown} teams
 * @param {ReadonlyArray<{ slug: string }>} [library]
 */
export function checkTeams(teams, library = GALLERY) {
  const problems = teamProblems(teams, library);
  if (problems.length) throw new Error(`Bot teams (bot-templates/teams.json): ${problems.join("; ")}`);
  return Object.freeze(teams.map(({ id, for: forWhat, name, description, templates }) =>
    Object.freeze({ id, for: forWhat, name, description, templates: Object.freeze([...templates]) })));
}

/** Mercbot's teams, in the order they are offered. */
export const TEAMS = checkTeams(JSON.parse(readFileSync(TEAMS_FILE, "utf8")).teams);

/** A team by its id, or null. @param {unknown} teamId */
export const teamById = (teamId) => TEAMS.find((team) => team.id === teamId) || null;

/** A team as the gallery lists it: its id, what it's for, name, line and templates' slugs, in order. */
export const teamSummary = (team) => ({
  id: team.id,
  for: team.for,
  name: team.name,
  description: team.description,
  templates: [...team.templates]
});
