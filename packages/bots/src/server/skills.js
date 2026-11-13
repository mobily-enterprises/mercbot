import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The skill library: guidance a bot loads when a topic comes up. Mercbot's own
// skills live in packages/bots/skills, one Markdown file each: a `name:`, a one-line
// `description:` and `pickable: yes|no` (shown in the "/" picker or background only), then `---`
// and the guidance. A copy built on Mercbot adds skill files of its own in the same form
// (`mercbot.added-skills`, which its bots hand to useAddedSkills at start); the library lists them
// with Mercbot's, by file name. The person's own skills (taught or saved by a bot) sit beside them.
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../skills");
const OWN_FILES = readdirSync(DIR).filter((file) => file.endsWith(".md")).map((file) => path.join(DIR, file));

function parse(file) {
  const text = readFileSync(file, "utf8");
  const [head, ...body] = text.split(/^---$/mu);
  const field = (name) => new RegExp(`^${name}:\\s*(.*)$`, "mu").exec(head)?.[1].trim() || "";
  return {
    id: `b-${path.basename(file, ".md")}`,
    name: field("name"),
    description: field("description"),
    pickable: field("pickable") === "yes",
    instructions: body.join("---").trim()
  };
}

/** The skills in these files, in file-name order. */
function libraryOf(files) {
  return [...files].sort((a, b) => (path.basename(a) < path.basename(b) ? -1 : 1)).map(parse);
}

// readable-check: allow module-state - shared resource: a server runs one copy of Mercbot, whose bots all read one library, Mercbot's own skills and those the copy adds at start
let library = libraryOf(OWN_FILES);

/**
 * The skills a copy built on Mercbot adds (`mercbot.added-skills`), each `{ file }`, a Markdown file in the form of
 * Mercbot's own: from now on the library is Mercbot's skills and these, by file name, and `[]` leaves Mercbot's alone.
 * A file named like one already listed is refused, since its id (`b-<file name>`) would stand for two skills.
 * @param {ReadonlyArray<{ file: string }>} added
 */
export function useAddedSkills(added) {
  const names = new Set(OWN_FILES.map((file) => path.basename(file)));
  for (const { file } of added) {
    if (names.has(path.basename(file))) throw new Error(`The added skill ${file} has the file name of a skill already listed.`);
    names.add(path.basename(file));
  }
  library = libraryOf([...OWN_FILES, ...added.map(({ file }) => file)]);
}

/** One line per skill, for the bot's standing instructions (stable, so the prompt cache holds). */
export function catalogue() {
  return library.map((skill) => `- ${skill.name}: ${skill.description}`).join("\n");
}

/** A skill by id (b-… for Mercbot's, u-… for the person's) or by name. */
export function findSkill(key, own = []) {
  const wanted = String(key || "").trim().toLowerCase();
  const mine = own.map((skill) => ({ ...skill, id: `u-${skill.id}` }));
  return [...library, ...mine].find((skill) => skill.id === key || skill.name.toLowerCase() === wanted) || null;
}

/** What the "/" picker offers: Mercbot's pickable skills and all of the person's own. */
export function pickable(own = []) {
  return [
    ...own.map((skill) => ({ id: `u-${skill.id}`, name: skill.name, description: skill.description, own: true })),
    ...library.filter((skill) => skill.pickable).map(({ id, name, description }) => ({ id, name, description, own: false }))
  ];
}

/** Pure helpers and data the tests reach directly (rule 64): the library as it is now. */
export const __testables = Object.freeze({ library: () => library });
