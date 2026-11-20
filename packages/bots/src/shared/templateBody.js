// A bot template's body (D-98): its tag, one-line description, greeting, instructions and skills, and the rules for
// each. Mercbot's library files are checked by them when Mercbot starts (checkTemplate, server/templates.js); a home's
// template is checked by them on the server before it is kept, and on the draft screen as the person types, so both
// always agree.

/**
 * A template's tag: one short lowercase word, 2 to 10 letters or digits starting with a letter, unique across
 * Mercbot's library and a home's templates. A bot shows its template's tag beside its name.
 */
export const TAG = /^[a-z][a-z0-9]{1,9}$/u;

/** The most each part of a home's template may hold (a library template's description may be 240). */
export const TEMPLATE_LIMITS = Object.freeze({
  description: 120,
  greeting: 600,
  instructions: 8000,
  skills: 6,
  skillName: 60,
  skillDescription: 160,
  skillInstructions: 6000
});

/** A template's setup interview skill: the one its bot runs first, the questions it asks a new person. */
export const setupSkillOf = (template) =>
  (Array.isArray(template?.skills) ? template.skills : []).find((skill) => /set ?up|first[- ]run|interview/iu.test(String(skill?.name || "")));

const textOf = (value) => (typeof value === "string" ? value : "");

/**
 * A template body from whatever was sent or answered: its five parts as text, its skills as name, description and
 * instructions, and nothing else.
 * @param {unknown} value
 * @returns {{
 *   tag: string,
 *   description: string,
 *   greeting: string,
 *   instructions: string,
 *   skills: Array<{ name: string, description: string, instructions: string }>
 * }}
 */
export function templateBody(value) {
  const body = value && typeof value === "object" ? value : {};
  const skills = Array.isArray(body.skills) ? body.skills : [];
  return {
    tag: textOf(body.tag).trim(),
    description: textOf(body.description).trim(),
    greeting: textOf(body.greeting).trim(),
    instructions: textOf(body.instructions).trim(),
    skills: skills.map((skill) => ({
      name: textOf(skill?.name).trim(),
      description: textOf(skill?.description).trim(),
      instructions: textOf(skill?.instructions).trim()
    }))
  };
}

const counted = (number) => number.toLocaleString("en");
// Text of at most `max` characters, not only spaces.
const fits = (value, max) => typeof value === "string" && Boolean(value.trim()) && value.length <= max;

/**
 * What's wrong with a template's body, each at its part: `tag`, `description`, `greeting`, `instructions`, `skills`
 * (how many), `setup` (its setup interview) and `skills.<n>.name`, `.description` or `.instructions`. Empty when
 * nothing is.
 * @param {Record<string, unknown>} body
 * @param {{ description?: number, skills?: number, taken?: Set<string> | null }} [rules] the longest description and
 *   the most skills (a home's by default); `taken`, the tags already used, which the tag must not be
 * @returns {Array<{ field: string, text: string }>}
 */
export function templateProblems(body, { description = TEMPLATE_LIMITS.description, skills = TEMPLATE_LIMITS.skills, taken = null } = {}) {
  const problems = [];
  const add = (field, text) => problems.push({ field, text });
  if (!TAG.test(textOf(body.tag))) add("tag", "2 to 10 lowercase letters or digits, starting with a letter.");
  else if (taken?.has(body.tag)) add("tag", "Another template already has this tag.");
  if (!fits(body.description, description) || /\n/u.test(body.description)) add("description", `One line of at most ${counted(description)} characters.`);
  if (!fits(body.greeting, TEMPLATE_LIMITS.greeting) || !body.greeting.includes("{firstName}")) {
    add("greeting", `At most ${counted(TEMPLATE_LIMITS.greeting)} characters, with {firstName} where the person's name goes.`);
  }
  if (!fits(body.instructions, TEMPLATE_LIMITS.instructions)) add("instructions", `Up to ${counted(TEMPLATE_LIMITS.instructions)} characters.`);
  const list = Array.isArray(body.skills) ? body.skills : [];
  if (!list.length || list.length > skills) add("skills", Number.isFinite(skills) ? `1 to ${skills} skills.` : "At least one skill.");
  list.forEach((skill, index) => {
    if (!fits(skill?.name, TEMPLATE_LIMITS.skillName)) add(`skills.${index}.name`, `A name of up to ${TEMPLATE_LIMITS.skillName} characters.`);
    if (!fits(skill?.description, TEMPLATE_LIMITS.skillDescription)) {
      add(`skills.${index}.description`, `Up to ${TEMPLATE_LIMITS.skillDescription} characters.`);
    }
    if (!fits(skill?.instructions, TEMPLATE_LIMITS.skillInstructions)) {
      add(`skills.${index}.instructions`, `Up to ${counted(TEMPLATE_LIMITS.skillInstructions)} characters.`);
    }
  });
  if (!setupSkillOf(body)) add("setup", "The setup questions are missing: a skill named Setup interview.");
  return problems;
}
