import assert from "node:assert/strict";
import test from "node:test";
import upgrade from "../../migrations/20261120120000_bot_templates_and_additions.cjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";

// The one-time template upgrade (D-98), on this file's own copy of the test database, inside a transaction that is
// rolled back: the migration is taken back down, bots are written as the release before kept them (instructions,
// skills, label and origin of their own), and it runs up again. Every bot then points at one template, and what each
// had is kept in bots_before_templates.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

/** Runs `work` with a transaction holding the schema as it was before the upgrade; nothing it does stays. */
async function beforeTheUpgrade(context, work) {
  const knex = await connectTestDatabase();
  context.after(() => knex.destroy());
  const trx = await knex.transaction();
  try {
    await upgrade.down(trx);
    const stamp = `upgrade-${Date.now()}`;
    const person = async (name) => (await trx("users")
      .insert({ auth_provider: "test", auth_provider_user_sid: `${name}-${stamp}`, email: `${name}-${stamp}@example.com`, username: `${name}${stamp}`.replace(/-/gu, ""), display_name: name })
      .returning("id"))[0].id;
    const home = async (owner, name) => (await trx("workspaces")
      .insert({ slug: `${name}-${stamp}`.toLowerCase(), name, owner_user_id: owner, is_personal: false })
      .returning("id"))[0].id;
    await work({ trx, person, home });
  } finally {
    await trx.rollback();
  }
}

const PANTRY = { slug: "weekly-meal-planner", name: "Pantry", creator: "the Mercbot team", kind: "gallery", addedAt: "2026-11-02T09:00:00.000Z" };

test("the upgrade points every bot at one template, makes home templates from bots' own words, and keeps what each had", async (context) => {
  await beforeTheUpgrade(context, async ({ trx, person, home }) => {
    const pat = await person("pat");
    const ours = await home(pat, "Ours");
    const theirs = await home(pat, "Theirs");
    const bot = async (fields) => (await trx("bots").insert({ user_id: pat, workspace_id: ours, color: "#1E86FC", ...fields }).returning("*"))[0];
    const added = await bot({ name: "Pantry", label: "Dinners for the week", instructions: "The template's words.", skills: JSON.stringify([{ name: "Setup interview" }]), origin: PANTRY });
    const changed = await bot({ name: "Pantry two", label: "Kitchen", instructions: "Plan for four.", skills: "[]", origin: { ...PANTRY, instructionsChanged: true } });
    const same = await bot({ name: "Cook", instructions: "  Plan for four.  ", skills: "[]" });
    const main = await bot({ name: "Mercbot", is_main: true });
    const empty = await bot({ name: "Blank", instructions: "   " });
    const named = await bot({ name: "Meals", label: "Two words", instructions: "Be terse." });
    const linked = await bot({ name: "Sharer", instructions: "Linked rules.", origin: { slug: "a1b2c3", name: "Sharer", creator: "Kim", kind: "link", addedAt: "2026-11-03T00:00:00.000Z" } });
    const group = await bot({ name: "Family", kind: "group" });
    const elsewhere = (await trx("bots").insert({ user_id: pat, workspace_id: theirs, color: "#1E86FC", name: "Pantry", label: "Kitchen", instructions: "Plan for four." }).returning("*"))[0];

    await upgrade.up(trx);

    const after = new Map((await trx("bots").whereIn("workspace_id", [ours, theirs]).select("id", "library_template", "home_template_id", "additions", "template_since"))
      .map((row) => [String(row.id), row]));
    const of = (row) => after.get(String(row.id));
    const templates = new Map((await trx("home_templates").whereIn("workspace_id", [ours, theirs])).map((row) => [String(row.id), row]));
    const homeOf = (row) => templates.get(String(of(row).home_template_id));

    assert.deepEqual([of(added).library_template, of(added).home_template_id], ["weekly-meal-planner", null], "an unchanged library bot points at the library");
    assert.equal(new Date(of(added).template_since).toISOString(), PANTRY.addedAt, "since it was added");
    for (const row of [main, empty]) assert.deepEqual([of(row).library_template, of(row).home_template_id], ["general", null], `${row.name}: no job, general`);
    assert.deepEqual([of(group).library_template, of(group).home_template_id], [null, null], "a group chat has no template");
    for (const row of after.values()) assert.equal(row.additions, "", "nobody has additions yet");

    const kitchen = homeOf(changed);
    assert.deepEqual([kitchen.tag, kitchen.instructions, kitchen.skills, String(kitchen.created_by)], ["kitchen", "Plan for four.", [], String(pat)], "its one-word label is its tag");
    assert.match(kitchen.description, /dinners/iu, "a changed library bot's template keeps the library's description");
    assert.match(kitchen.greeting, /^Hi \{firstName\}, I'm Pantry\./u);
    assert.equal(String(of(same).home_template_id), String(kitchen.id), "the same words and skills in a home make one template");
    assert.equal(homeOf(named).tag, "meals2", "a label of two words isn't a tag; its name is, made free of the library's meals");
    assert.equal(homeOf(named).description, "Made from Meals's own instructions.");
    assert.deepEqual([homeOf(linked).tag, homeOf(linked).instructions], ["sharer", "Linked rules."], "a bot added from a link gets its home's template");
    assert.equal(homeOf(elsewhere).tag, "kitchen", "another home has tags of its own");
    assert.equal(String(homeOf(elsewhere).workspace_id), String(theirs));
    assert.equal(templates.size, 4);

    const kept = new Map((await trx("bots_before_templates").whereIn("workspace_id", [ours, theirs])).map((row) => [String(row.bot_id), row]));
    assert.equal(kept.size, 9, "every bot, the group too, is copied first");
    assert.deepEqual([kept.get(String(changed.id)).label, kept.get(String(changed.id)).instructions, kept.get(String(changed.id)).origin.instructionsChanged], ["Kitchen", "Plan for four.", true]);
    assert.equal(kept.get(String(added.id)).skills[0].name, "Setup interview");
    // The old columns stay, unread, for the release before; a later release drops them.
    assert.equal((await trx("bots").where({ id: changed.id }).first("label")).label, "Kitchen");
  });
});

test("a bot the upgrade can't place stops it, loudly, naming the bot and its home", async (context) => {
  await beforeTheUpgrade(context, async ({ trx, person, home }) => {
    const pat = await person("pat");
    const ours = await home(pat, "Ours");
    const [bad] = await trx("bots")
      .insert({ user_id: pat, workspace_id: ours, color: "#1E86FC", name: "Odd", instructions: "Do things.", skills: JSON.stringify({ name: "not a list" }) })
      .returning("id");
    await assert.rejects(upgrade.up(trx), (error) => {
      assert.equal(error.message, `The template upgrade (D-98) can't place bot ${bad.id} ("Odd") of home ${ours}: its skills aren't a list`);
      return true;
    });
  });
});
