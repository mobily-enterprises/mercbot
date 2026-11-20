const fs = require("node:fs");
const path = require("node:path");

/**
 * Every bot is a template plus its own additions (D-98). A bot points at one template, from Mercbot's library
 * (`library_template`, a file in bot-templates/ or `general`) or its home's own (`home_template_id`, a row of
 * `home_templates`, never another home's: the key includes the home), plus `additions`, its own text for it alone. A
 * home's template can't be deleted while a bot uses it (ON DELETE RESTRICT). `home_template_changes` is each home
 * template's dated list of what changed.
 *
 * The upgrade, once, in this migration's transaction, so nothing is half-moved: every bot's label, instructions, skills
 * and origin are first copied to `bots_before_templates`. Then a bot added from a library template whose instructions
 * weren't changed points at that template; a bot with instructions of its own (changed, added from a shared link, or
 * written in Details) points at a home template made from them and its skills, one per distinct text in a home, tagged
 * from its one-word label or else its name; a bot with none, the main bot among them, points at `general`. A bot it
 * can't place stops it with an error naming the bot. Labels go: the tag replaces them. The old columns stay, unread,
 * while the release before may still run beside this one; a later release drops them (expand, then contract).
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw(`
    CREATE TABLE home_templates (
      id bigserial PRIMARY KEY,
      workspace_id bigint NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
      tag character varying(10) NOT NULL,
      description character varying(120) NOT NULL,
      instructions text NOT NULL,
      skills jsonb DEFAULT '[]'::jsonb NOT NULL,
      greeting text,
      created_by bigint REFERENCES users (id) ON DELETE SET NULL,
      created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
      CONSTRAINT home_templates_tag_check CHECK ((tag ~ '^[a-z][a-z0-9]{1,9}$')),
      CONSTRAINT home_templates_workspace_tag_unique UNIQUE (workspace_id, tag),
      CONSTRAINT home_templates_id_workspace_unique UNIQUE (id, workspace_id)
    )
  `);
  await knex.raw(`
    CREATE TABLE home_template_changes (
      id bigserial PRIMARY KEY,
      workspace_id bigint NOT NULL,
      home_template_id bigint NOT NULL,
      changed_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
      changed_by bigint REFERENCES users (id) ON DELETE SET NULL,
      summary character varying(200) NOT NULL,
      CONSTRAINT home_template_changes_template_foreign FOREIGN KEY (home_template_id, workspace_id)
        REFERENCES home_templates (id, workspace_id) ON DELETE CASCADE
    )
  `);
  await knex.raw("CREATE INDEX ix_home_template_changes_template ON home_template_changes (home_template_id, changed_at DESC)");
  await knex.raw(`
    ALTER TABLE bots
      ADD COLUMN library_template character varying(40),
      ADD COLUMN home_template_id bigint,
      ADD COLUMN additions text DEFAULT '' NOT NULL,
      ADD COLUMN template_since timestamp with time zone,
      ADD CONSTRAINT bots_home_template_foreign FOREIGN KEY (home_template_id, workspace_id)
        REFERENCES home_templates (id, workspace_id) ON DELETE RESTRICT,
      ADD CONSTRAINT bots_one_template_check CHECK ((library_template IS NULL OR home_template_id IS NULL))
  `);
  await knex.raw("CREATE INDEX ix_bots_home_template ON bots (home_template_id) WHERE home_template_id IS NOT NULL");

  await knex.raw(`
    CREATE TABLE bots_before_templates AS
      SELECT id AS bot_id, workspace_id, name, label, instructions, skills, origin, CURRENT_TIMESTAMP AS copied_at FROM bots
  `);
  const library = libraryTemplates();
  const bots = await knex("bots")
    .where({ kind: "bot" })
    .select("id", "workspace_id", "user_id", "name", "label", "instructions", "skills", "origin", "created_at")
    .orderBy(["workspace_id", "id"]);
  const homes = new Map();
  for (const bot of bots) {
    if (!homes.has(String(bot.workspace_id))) homes.set(String(bot.workspace_id), { tags: new Set(library.tags), made: new Map() });
    const home = homes.get(String(bot.workspace_id));
    const placed = await place(knex, bot, library, home).catch((error) => {
      throw new Error(`The template upgrade (D-98) can't place bot ${bot.id} ("${bot.name}") of home ${bot.workspace_id}: ${error.message}`);
    });
    await knex("bots").where({ id: bot.id }).update(placed);
  }
};

/** Mercbot's library as this release has it: each file's slug and tag, and `general`, which isn't a file. */
function libraryTemplates() {
  const folder = path.resolve(__dirname, "..", "bot-templates");
  const templates = fs.readdirSync(folder)
    .filter((file) => file.endsWith(".json"))
    .map((file) => JSON.parse(fs.readFileSync(path.join(folder, file), "utf8")));
  return {
    bySlug: new Map(templates.map((template) => [template.slug, template])),
    tags: new Set([...templates.map((template) => template.tag), "general"])
  };
}

/** The template columns one bot gets, making its home's template from its own text when it has some. */
async function place(knex, bot, library, home) {
  const origin = bot.origin || null;
  const fromLibrary = origin && origin.kind === "gallery" && library.bySlug.get(origin.slug);
  const since = validDate(origin && origin.addedAt) || bot.created_at;
  if (fromLibrary && !origin.instructionsChanged) return { library_template: fromLibrary.slug, template_since: since };
  const instructions = String(bot.instructions || "").trim();
  if (!instructions) return { library_template: "general", template_since: bot.created_at };
  if (!Array.isArray(bot.skills)) throw new Error("its skills aren't a list");
  const key = JSON.stringify([instructions, bot.skills]);
  if (!home.made.has(key)) {
    const tag = freeTag(oneWord(bot.label) || bot.name, home.tags);
    home.tags.add(tag);
    const description = fromLibrary ? fromLibrary.description : `Made from ${bot.name}'s own instructions.`;
    const [made] = await knex("home_templates")
      .insert({
        workspace_id: bot.workspace_id,
        tag,
        description: oneLine(description, 120),
        instructions,
        skills: JSON.stringify(bot.skills),
        greeting: fromLibrary ? fromLibrary.greeting : null,
        created_by: bot.user_id
      })
      .returning("id");
    home.made.set(key, made.id ?? made);
  }
  return { home_template_id: home.made.get(key), template_since: new Date() };
}

/** A label that is one word, or "". */
function oneWord(label) {
  const text = String(label || "").trim();
  return /^\S+$/u.test(text) ? text : "";
}

/**
 * A tag from a word or a name: its letters and digits, lowercase, starting with a letter, at most 10; "bot" when
 * that leaves fewer than 2. Taken already, it gets the first free number: pantry2, pantry3…
 */
function freeTag(words, taken) {
  const base = String(words || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/gu, "").replace(/^[0-9]+/u, "").slice(0, 10);
  const tag = base.length >= 2 ? base : "bot";
  if (!taken.has(tag)) return tag;
  for (let number = 2; ; number += 1) {
    const candidate = `${tag.slice(0, 10 - String(number).length)}${number}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Text as one line of at most `max` characters, cut at a word with "…" when longer. */
function oneLine(text, max) {
  const line = String(text || "").replace(/\s+/gu, " ").trim();
  if (line.length <= max) return line;
  const cut = line.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(" ") > max / 2 ? cut.lastIndexOf(" ") : cut.length)}…`;
}

function validDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

exports.down = async function down(knex) {
  await knex.raw("DROP TABLE IF EXISTS bots_before_templates");
  await knex.raw(`
    ALTER TABLE bots
      DROP CONSTRAINT IF EXISTS bots_one_template_check,
      DROP CONSTRAINT IF EXISTS bots_home_template_foreign,
      DROP COLUMN IF EXISTS template_since,
      DROP COLUMN IF EXISTS additions,
      DROP COLUMN IF EXISTS home_template_id,
      DROP COLUMN IF EXISTS library_template
  `);
  await knex.raw("DROP TABLE IF EXISTS home_template_changes");
  await knex.raw("DROP TABLE IF EXISTS home_templates");
};
